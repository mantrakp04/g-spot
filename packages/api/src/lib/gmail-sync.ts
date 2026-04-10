/**
 * Gmail sync orchestrator.
 *
 * Two-queue architecture:
 * - Queue 1 (Fetcher): fetches threads from Gmail API, stores in DB
 * - Queue 2 (Processor): runs LLM extraction + memory ingestion
 *
 * Backpressure: Queue 1 pauses when Queue 2 has too many pending items.
 * Circuit breaker: 429s pause all fetching.
 */

import { AsyncQueuer } from "@tanstack/pacer";

import {
  getGmailAccount,
  incrementSyncProgress,
  markThreadProcessed,
  recordSyncFailure,
  syncLabels,
  upsertAttachments,
  upsertGmailAccount,
  upsertMessages,
  upsertSyncState,
  upsertThread,
} from "@g-spot/db/gmail";

import {
  getProfile,
  getThreadDetail,
  getHistory,
  listAllThreadIds,
  listLabels,
  parseGmailMessage,
  parseAttachments,
  threadToText,
  GmailApiError,
  type ParsedMessage,
} from "./gmail-client";
import { extractAndIngestThread } from "./memory-extractor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncMode = "full" | "incremental";
type CircuitState = "closed" | "open";

export interface SyncProgress {
  status: "idle" | "running" | "paused" | "completed" | "error";
  mode: SyncMode | null;
  totalThreads: number;
  fetchedThreads: number;
  processedThreads: number;
  failedThreads: number;
  startedAt: string | null;
  error: string | null;
}

interface FetchItem {
  gmailThreadId: string;
}

interface ProcessItem {
  dbThreadId: string;
  gmailThreadId: string;
  subject: string;
  messages: ParsedMessage[];
}

// ---------------------------------------------------------------------------
// Config from env
// ---------------------------------------------------------------------------

const FETCH_CONCURRENCY = Number(process.env.GMAIL_SYNC_CONCURRENCY ?? 20);
const PROCESS_CONCURRENCY = Number(process.env.MEMORY_WORKER_CONCURRENCY ?? 8);
const HIGH_WATERMARK = Number(process.env.MEMORY_QUEUE_HIGH_WATERMARK ?? 32);
const LOW_WATERMARK = Number(process.env.MEMORY_QUEUE_LOW_WATERMARK ?? 16);

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class GmailSyncOrchestrator {
  private fetchQueue: AsyncQueuer<FetchItem>;
  private processQueue: AsyncQueuer<ProcessItem>;
  private circuitState: CircuitState = "closed";
  private cancelled = false;
  private progress: SyncProgress;
  private userId: string;
  private accountId: string;
  private token: string;

  constructor(userId: string, accountId: string, token: string) {
    this.userId = userId;
    this.accountId = accountId;
    this.token = token;

    this.progress = {
      status: "idle",
      mode: null,
      totalThreads: 0,
      fetchedThreads: 0,
      processedThreads: 0,
      failedThreads: 0,
      startedAt: null,
      error: null,
    };

    // Queue 1: Gmail Fetcher
    this.fetchQueue = new AsyncQueuer<FetchItem>(
      async (item) => this.fetchThread(item),
      {
        concurrency: FETCH_CONCURRENCY,
        started: false,
        throwOnError: false,
        onError: (error, item) => this.handleFetchError(error, item),
        onSuccess: (_result, _item) => {
          this.progress.fetchedThreads++;
          incrementSyncProgress(this.accountId, "fetchedThreads").catch(() => {});
        },
      },
    );

    // Queue 2: Memory Processor
    this.processQueue = new AsyncQueuer<ProcessItem>(
      async (item) => this.processThread(item),
      {
        concurrency: PROCESS_CONCURRENCY,
        started: false,
        throwOnError: false,
        onError: (error, item) => this.handleProcessError(error, item),
        onSuccess: (_result, _item) => {
          this.progress.processedThreads++;
          incrementSyncProgress(this.accountId, "processedThreads").catch(() => {});
        },
      },
    );
  }

  // ----- Public API -----

  async startSync(mode: SyncMode): Promise<void> {
    this.progress.status = "running";
    this.progress.mode = mode;
    this.progress.startedAt = new Date().toISOString();
    this.cancelled = false;

    await upsertSyncState(this.accountId, {
      status: "running",
      mode,
      totalThreads: 0,
      fetchedThreads: 0,
      processedThreads: 0,
      failedThreads: 0,
      startedAt: this.progress.startedAt,
      completedAt: null,
      lastError: null,
    });

    try {
      // 1. Get profile + labels
      const profile = await getProfile(this.token);
      const labels = await listLabels(this.token);
      await syncLabels(
        this.accountId,
        labels.map((l) => ({
          gmailId: l.id,
          name: l.name,
          type: l.type,
          color: l.color ? JSON.stringify(l.color) : null,
        })),
      );

      // 2. Get thread IDs to sync
      let threadIds: string[];

      if (mode === "incremental") {
        const account = await getGmailAccount(this.userId, this.accountId);
        const lastHistoryId = account?.historyId;

        if (lastHistoryId) {
          const history = await getHistory(this.token, lastHistoryId);
          if (history.expired) {
            console.log("[gmail-sync] History expired, falling back to full sync");
            threadIds = await listAllThreadIds(this.token);
          } else {
            threadIds = history.threadIds;
          }
        } else {
          // No history ID yet, do full sync
          threadIds = await listAllThreadIds(this.token);
        }
      } else {
        threadIds = await listAllThreadIds(this.token);
      }

      if (this.cancelled) return;

      this.progress.totalThreads = threadIds.length;
      await upsertSyncState(this.accountId, {
        totalThreads: threadIds.length,
      });

      // 3. Enqueue all thread IDs
      for (const id of threadIds) {
        if (this.cancelled) break;
        this.fetchQueue.addItem({ gmailThreadId: id });
      }

      // 4. Start both queues
      this.fetchQueue.start();
      this.processQueue.start();

      // 5. Wait for completion
      await this.waitForCompletion();

      if (this.cancelled) {
        this.progress.status = "paused";
        await upsertSyncState(this.accountId, { status: "paused" });
        return;
      }

      // 6. Update history ID
      await upsertGmailAccount(this.userId, {
        email: profile.emailAddress,
        providerAccountId: this.accountId,
        historyId: profile.historyId,
      });

      this.progress.status = "completed";
      await upsertSyncState(this.accountId, {
        status: "completed",
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.progress.status = "error";
      this.progress.error = msg;
      await upsertSyncState(this.accountId, {
        status: "error",
        lastError: msg,
      });
      console.error("[gmail-sync] Sync failed:", error);
    } finally {
      this.fetchQueue.stop();
      this.processQueue.stop();
    }
  }

  getProgress(): SyncProgress {
    return { ...this.progress };
  }

  cancel(): void {
    this.cancelled = true;
    this.fetchQueue.stop();
    this.processQueue.stop();
    this.progress.status = "paused";
  }

  // ----- Internal: Fetch -----

  private async fetchThread(item: FetchItem): Promise<void> {
    if (this.cancelled) return;

    // Circuit breaker check
    if (this.circuitState === "open") {
      // Re-enqueue for later
      this.fetchQueue.addItem(item);
      return;
    }

    // Backpressure: wait if processor queue is too full
    await this.waitForBackpressure();
    if (this.cancelled) return;

    const detail = await getThreadDetail(this.token, item.gmailThreadId);
    const messages = detail.messages.map(parseGmailMessage);

    // Determine thread metadata
    const subject = messages[0]?.subject ?? "(no subject)";
    const lastMsg = messages[messages.length - 1];
    const lastMessageAt = lastMsg?.date ?? new Date().toISOString();
    const allLabels = new Set<string>();
    for (const msg of messages) {
      for (const label of msg.labels) allLabels.add(label);
    }

    // Upsert thread
    const { id: dbThreadId } = await upsertThread(this.accountId, {
      gmailThreadId: item.gmailThreadId,
      subject,
      snippet: messages[0]?.snippet ?? "",
      lastMessageAt,
      messageCount: messages.length,
      labels: Array.from(allLabels),
      historyId: detail.historyId ?? undefined,
    });

    // Upsert messages
    const msgIds = await upsertMessages(dbThreadId, this.accountId, messages);

    // Upsert attachments
    for (let i = 0; i < detail.messages.length; i++) {
      const atts = parseAttachments(detail.messages[i]!);
      if (atts.length > 0 && msgIds[i]) {
        await upsertAttachments(msgIds[i]!, atts);
      }
    }

    // Enqueue for memory processing
    this.processQueue.addItem({
      dbThreadId,
      gmailThreadId: item.gmailThreadId,
      subject,
      messages,
    });
  }

  private handleFetchError(error: Error, item: FetchItem): void {
    if (error instanceof GmailApiError && error.isRateLimit) {
      this.openCircuit(error.retryAfter ?? 60);
      // Re-enqueue
      this.fetchQueue.addItem(item);
      return;
    }

    this.progress.failedThreads++;
    incrementSyncProgress(this.accountId, "failedThreads").catch(() => {});
    recordSyncFailure(this.accountId, {
      gmailThreadId: item.gmailThreadId,
      stage: "fetch",
      errorMessage: error.message,
      errorCode: error instanceof GmailApiError ? String(error.status) : "UNKNOWN",
    }).catch(() => {});

    console.error(
      `[gmail-sync] Fetch failed for ${item.gmailThreadId}:`,
      error.message,
    );
  }

  // ----- Internal: Process -----

  private async processThread(item: ProcessItem): Promise<void> {
    if (this.cancelled) return;

    const content = threadToText(item.subject, item.messages);

    await extractAndIngestThread(this.userId, content, item.gmailThreadId);
    await markThreadProcessed(item.dbThreadId);
  }

  private handleProcessError(error: Error, item: ProcessItem): void {
    this.progress.failedThreads++;
    incrementSyncProgress(this.accountId, "failedThreads").catch(() => {});
    recordSyncFailure(this.accountId, {
      gmailThreadId: item.gmailThreadId,
      stage: "extract",
      errorMessage: error.message,
      errorCode: "LLM_ERROR",
    }).catch(() => {});

    console.error(
      `[gmail-sync] Process failed for ${item.gmailThreadId}:`,
      error.message,
    );
  }

  // ----- Internal: Backpressure -----

  private async waitForBackpressure(): Promise<void> {
    while (
      this.processQueue.store.state.items.length >= HIGH_WATERMARK &&
      !this.cancelled
    ) {
      await sleep(200);
      if (this.processQueue.store.state.items.length <= LOW_WATERMARK) break;
    }
  }

  // ----- Internal: Circuit Breaker -----

  private openCircuit(retryAfterSec: number): void {
    if (this.circuitState === "open") return;
    this.circuitState = "open";
    console.log(
      `[gmail-sync] Circuit OPEN — pausing fetches for ${retryAfterSec}s`,
    );

    setTimeout(() => {
      this.circuitState = "closed";
      console.log("[gmail-sync] Circuit CLOSED — resuming fetches");
    }, retryAfterSec * 1000);
  }

  // ----- Internal: Completion -----

  private async waitForCompletion(): Promise<void> {
    // Poll until both queues are idle
    while (!this.cancelled) {
      const fetchState = this.fetchQueue.store.state;
      const processState = this.processQueue.store.state;

      const fetchDone =
        fetchState.items.length === 0 && fetchState.activeItems.length === 0;
      const processDone =
        processState.items.length === 0 &&
        processState.activeItems.length === 0;

      if (fetchDone && processDone) break;
      await sleep(500);
    }
  }
}

// ---------------------------------------------------------------------------
// Sync manager — module-level singleton map
// ---------------------------------------------------------------------------

const activeSyncs = new Map<string, GmailSyncOrchestrator>();

function syncKey(userId: string, accountId: string): string {
  return `${userId}:${accountId}`;
}

export function startSync(
  userId: string,
  accountId: string,
  token: string,
  mode: SyncMode,
): GmailSyncOrchestrator {
  const key = syncKey(userId, accountId);
  const existing = activeSyncs.get(key);
  if (existing && existing.getProgress().status === "running") {
    throw new Error("Sync already in progress for this account");
  }

  const orch = new GmailSyncOrchestrator(userId, accountId, token);
  activeSyncs.set(key, orch);

  // Start async, don't await
  orch.startSync(mode).finally(() => {
    // Clean up on completion
    const current = activeSyncs.get(key);
    if (current === orch) activeSyncs.delete(key);
  });

  return orch;
}

export function getActiveSync(
  userId: string,
  accountId: string,
): GmailSyncOrchestrator | undefined {
  return activeSyncs.get(syncKey(userId, accountId));
}

export function cancelSync(userId: string, accountId: string): boolean {
  const orch = activeSyncs.get(syncKey(userId, accountId));
  if (!orch) return false;
  orch.cancel();
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
