/**
 * Gmail sync orchestrator.
 *
 * Two-queue architecture:
 * - Queue 1 (Fetcher): fetches threads from Gmail API, stores in DB
 * - Queue 2 (Processor): runs LLM extraction + memory ingestion
 *
 * Circuit breaker: 429s pause all fetching.
 */

import { AsyncQueuer } from "@tanstack/pacer";

import {
  getFailuresByIds,
  getFetchedGmailThreadIds,
  getGmailAccount,
  getThread,
  getThreadMessages,
  getUnprocessedGmailThreadIds,
  getUnresolvedFailures,
  incrementSyncProgress,
  markThreadProcessed,
  recordSyncFailure,
  resolveFailure,
  syncLabels,
  upsertAttachments,
  upsertGmailAccount,
  upsertMessages,
  upsertSyncState,
  upsertThread,
} from "@g-spot/db/gmail";
import type { GmailSyncFailureRow } from "@g-spot/db/schema/gmail";

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

      // 2b. Filter out already-handled threads for resume
      const alreadyFetched = await getFetchedGmailThreadIds(this.accountId);
      const toFetch = threadIds.filter((id) => !alreadyFetched.has(id));
      const unprocessed = await getUnprocessedGmailThreadIds(this.accountId);

      this.progress.totalThreads = threadIds.length;
      this.progress.fetchedThreads = alreadyFetched.size;
      this.progress.processedThreads = alreadyFetched.size - unprocessed.length;

      if (unprocessed.length > 0 || alreadyFetched.size > 0) {
        console.log(
          `[gmail-sync] Resuming: ${alreadyFetched.size} already fetched, ${unprocessed.length} need processing, ${toFetch.length} need fetching`,
        );
      }

      await upsertSyncState(this.accountId, {
        status: "running",
        mode,
        totalThreads: threadIds.length,
        fetchedThreads: alreadyFetched.size,
        processedThreads: alreadyFetched.size - unprocessed.length,
        failedThreads: 0,
        startedAt: this.progress.startedAt,
        completedAt: null,
        lastError: null,
      });

      // 3a. Enqueue threads that need fetching
      for (const id of toFetch) {
        if (this.cancelled) break;
        this.fetchQueue.addItem({ gmailThreadId: id });
      }

      // 3b. Enqueue threads that only need processing (already fetched but not processed)
      for (const gmailThreadId of unprocessed) {
        if (this.cancelled) break;
        const thread = await getThread(this.accountId, gmailThreadId);
        if (!thread) continue;
        const dbMessages = await getThreadMessages(thread.id);
        const parsedMessages: ParsedMessage[] = dbMessages.map((m) => ({
          gmailMessageId: m.gmailMessageId,
          gmailThreadId: m.gmailThreadId,
          fromName: m.fromName,
          fromEmail: m.fromEmail,
          toHeader: m.toHeader,
          ccHeader: m.ccHeader,
          subject: m.subject,
          date: m.date,
          bodyHtml: m.bodyHtml,
          bodyText: m.bodyText,
          snippet: m.snippet,
          labels: JSON.parse(m.labels) as string[],
          messageIdHeader: m.messageIdHeader,
          inReplyTo: m.inReplyTo,
          referencesHeader: m.referencesHeader,
          isDraft: m.isDraft,
          historyId: m.historyId,
          rawSizeEstimate: m.rawSizeEstimate,
        }));
        this.processQueue.addItem({
          dbThreadId: thread.id,
          gmailThreadId,
          subject: thread.subject,
          messages: parsedMessages,
        });
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
// Retry failed threads
// ---------------------------------------------------------------------------

const RETRY_CONCURRENCY = 4;

export async function retryFailedThreads(
  userId: string,
  accountId: string,
  token: string,
  failureIds?: string[],
): Promise<{ retried: number; succeeded: number; failed: number }> {
  // 1. Get failures to retry
  const toRetry: GmailSyncFailureRow[] = failureIds?.length
    ? await getFailuresByIds(failureIds)
    : await getUnresolvedFailures(accountId);

  if (toRetry.length === 0) {
    return { retried: 0, succeeded: 0, failed: 0 };
  }

  let succeeded = 0;
  let failed = 0;

  // 2. Process in batches for controlled concurrency
  const queue = new AsyncQueuer<GmailSyncFailureRow>(
    async (failure) => {
      await retryOneFailure(userId, accountId, token, failure);
    },
    {
      concurrency: RETRY_CONCURRENCY,
      started: false,
      throwOnError: false,
      onSuccess: async (_result, failure) => {
        succeeded++;
        await resolveFailure(failure.id);
        console.log(
          `[gmail-sync] Retry succeeded for ${failure.gmailThreadId} (stage: ${failure.stage})`,
        );
      },
      onError: async (error, failure) => {
        failed++;
        // Update the failure record with the new attempt
        await recordSyncFailure(accountId, {
          gmailThreadId: failure.gmailThreadId,
          stage: failure.stage,
          errorMessage:
            error instanceof Error ? error.message : String(error),
          errorCode: failure.errorCode ?? "RETRY_ERROR",
        });
        console.error(
          `[gmail-sync] Retry failed for ${failure.gmailThreadId}:`,
          error instanceof Error ? error.message : error,
        );
      },
    },
  );

  for (const failure of toRetry) {
    queue.addItem(failure);
  }

  queue.start();

  // Wait until queue drains
  while (true) {
    const state = queue.store.state;
    if (state.items.length === 0 && state.activeItems.length === 0) break;
    await sleep(200);
  }

  queue.stop();

  return { retried: toRetry.length, succeeded, failed };
}

/**
 * Retry a single failed thread based on which stage it failed at.
 */
async function retryOneFailure(
  userId: string,
  accountId: string,
  token: string,
  failure: GmailSyncFailureRow,
): Promise<void> {
  if (failure.stage === "fetch") {
    // Need to re-fetch from Gmail API and then process
    const detail = await getThreadDetail(token, failure.gmailThreadId);
    const messages = detail.messages.map(parseGmailMessage);

    const subject = messages[0]?.subject ?? "(no subject)";
    const lastMsg = messages[messages.length - 1];
    const lastMessageAt = lastMsg?.date ?? new Date().toISOString();
    const allLabels = new Set<string>();
    for (const msg of messages) {
      for (const label of msg.labels) allLabels.add(label);
    }

    const { id: dbThreadId } = await upsertThread(accountId, {
      gmailThreadId: failure.gmailThreadId,
      subject,
      snippet: messages[0]?.snippet ?? "",
      lastMessageAt,
      messageCount: messages.length,
      labels: Array.from(allLabels),
      historyId: detail.historyId ?? undefined,
    });

    const msgIds = await upsertMessages(dbThreadId, accountId, messages);

    for (let i = 0; i < detail.messages.length; i++) {
      const atts = parseAttachments(detail.messages[i]!);
      if (atts.length > 0 && msgIds[i]) {
        await upsertAttachments(msgIds[i]!, atts);
      }
    }

    // Also run memory extraction since fetch includes the full pipeline
    const content = threadToText(subject, messages);
    await extractAndIngestThread(userId, content, failure.gmailThreadId);
    await markThreadProcessed(dbThreadId);
  } else {
    // "extract" | "resolve" | "ingest" — thread data is already in DB,
    // just re-run the memory extraction pipeline
    const thread = await getThread(accountId, failure.gmailThreadId);
    if (!thread) {
      throw new Error(
        `Thread ${failure.gmailThreadId} not found in DB; cannot retry ${failure.stage} stage`,
      );
    }

    const dbMessages = await getThreadMessages(thread.id);
    if (dbMessages.length === 0) {
      throw new Error(
        `No messages found for thread ${failure.gmailThreadId}; cannot retry`,
      );
    }

    // Build ParsedMessage-compatible objects for threadToText
    const parsedMessages: ParsedMessage[] = dbMessages.map((m) => ({
      gmailMessageId: m.gmailMessageId,
      gmailThreadId: m.gmailThreadId,
      fromName: m.fromName,
      fromEmail: m.fromEmail,
      toHeader: m.toHeader,
      ccHeader: m.ccHeader,
      subject: m.subject,
      date: m.date,
      bodyHtml: m.bodyHtml,
      bodyText: m.bodyText,
      snippet: m.snippet,
      labels: JSON.parse(m.labels) as string[],
      messageIdHeader: m.messageIdHeader,
      inReplyTo: m.inReplyTo,
      referencesHeader: m.referencesHeader,
      isDraft: m.isDraft,
      historyId: m.historyId,
      rawSizeEstimate: m.rawSizeEstimate,
    }));

    const content = threadToText(thread.subject, parsedMessages);
    await extractAndIngestThread(userId, content, failure.gmailThreadId);
    await markThreadProcessed(thread.id);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
