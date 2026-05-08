/**
 * Gmail thread extraction.
 *
 * One orchestrator handles two scopes:
 *
 *   - mode: "all"     — manual/CLI full extraction. Persists status to
 *                       gmail_analysis_state and supports cancel/resume.
 *   - mode: "scoped"  — auto-triggered by incremental sync for the threads
 *                       it just fetched. No state writes. No-op when an
 *                       "all" run is already active for the same account
 *                       (that orchestrator will pick the freshly-stored
 *                       unprocessed inbox threads up on its next batch).
 */

import { env } from "@g-spot/env/server";
import {
  getGmailThreadStats,
  incrementAnalysisProgress,
  listMessagesByThreadIds,
  listUnprocessedInboxThreadsBatch,
  listUnprocessedInboxThreadsByGmailIds,
  getMessageLabelsByIds,
  markThreadProcessed,
  upsertAnalysisState,
} from "@g-spot/db/gmail";

import { threadToText, type ParsedMessage } from "./parse";
import { extractAndIngestThread } from "../memory-extractor";

const EXTRACTION_BATCH_SIZE = 100;

export interface GmailExtractionProgress {
  status: "idle" | "running" | "paused" | "completed" | "error";
  totalThreads: number;
  processedThreads: number;
  failedThreads: number;
  startedAt: string | null;
  error: string | null;
}

type BatchThread = Awaited<ReturnType<typeof listUnprocessedInboxThreadsBatch>>[number];
type StoredThreadMessage = Awaited<ReturnType<typeof listMessagesByThreadIds>>[number];

function storedMessageToParsedMessage(
  message: StoredThreadMessage,
  labels: string[],
): ParsedMessage {
  return {
    gmailMessageId: message.gmailMessageId,
    gmailThreadId: message.gmailThreadId,
    fromName: message.fromName,
    fromEmail: message.fromEmail,
    toHeader: message.toHeader,
    ccHeader: message.ccHeader,
    subject: message.subject,
    date: message.date,
    bodyHtml: message.bodyHtml,
    bodyText: message.bodyText,
    snippet: message.snippet,
    labels,
    messageIdHeader: message.messageIdHeader,
    inReplyTo: message.inReplyTo,
    referencesHeader: message.referencesHeader,
    isDraft: message.isDraft,
    historyId: message.historyId,
    rawSizeEstimate: message.rawSizeEstimate,
  };
}

function latestMessageTimestamp(messages: ParsedMessage[]): number | undefined {
  let latest: number | undefined;
  for (const message of messages) {
    const timestamp = Date.parse(message.date);
    if (!Number.isFinite(timestamp)) continue;
    latest = latest === undefined ? timestamp : Math.max(latest, timestamp);
  }
  return latest;
}

async function loadThreadMessages(
  threadIds: string[],
): Promise<Map<string, ParsedMessage[]>> {
  const stored = await listMessagesByThreadIds(threadIds);
  const labelsByMessageId = await getMessageLabelsByIds(stored.map((m) => m.id));
  const byThread = new Map<string, ParsedMessage[]>();
  for (const message of stored) {
    const parsed = storedMessageToParsedMessage(
      message,
      labelsByMessageId.get(message.id) ?? [],
    );
    const arr = byThread.get(message.threadId);
    if (arr) arr.push(parsed);
    else byThread.set(message.threadId, [parsed]);
  }
  return byThread;
}

async function processThread(
  thread: BatchThread,
  messages: ParsedMessage[],
): Promise<void> {
  const content = threadToText(thread.subject, messages);
  await extractAndIngestThread(
    content,
    thread.gmailThreadId,
    latestMessageTimestamp(messages),
  );
  await markThreadProcessed(thread.id);
}

class GmailExtractionOrchestrator {
  private cancelled = false;
  private skippedThreadIds = new Set<string>();
  private progress: GmailExtractionProgress = {
    status: "idle",
    totalThreads: 0,
    processedThreads: 0,
    failedThreads: 0,
    startedAt: null,
    error: null,
  };

  constructor(private readonly accountId: string) {}

  async start(): Promise<void> {
    await this.beginRun();

    try {
      while (!this.cancelled) {
        const batch = await this.getNextBatch();
        if (batch.length === 0) break;
        await this.processBatch(batch);
      }
      if (!this.cancelled) await this.markCompleted();
    } catch (error) {
      if (!this.cancelled) {
        const message = error instanceof Error ? error.message : String(error);
        await this.markErrored(message);
        console.error("[gmail-extraction] Failed:", error);
      }
    } finally {
      if (this.cancelled) {
        await this.markPaused().catch((error) => {
          console.error("[gmail-extraction] Failed to persist paused state:", error);
        });
      }
    }
  }

  getProgress(): GmailExtractionProgress {
    return { ...this.progress };
  }

  cancel(): void {
    this.cancelled = true;
    this.progress.status = "paused";
  }

  private async beginRun(): Promise<void> {
    const stats = await getGmailThreadStats(this.accountId);
    this.cancelled = false;
    this.skippedThreadIds.clear();
    this.progress = {
      status: "running",
      totalThreads: stats.unprocessedInboxThreads,
      processedThreads: 0,
      failedThreads: 0,
      startedAt: new Date().toISOString(),
      error: null,
    };

    await upsertAnalysisState(this.accountId, {
      completedAt: null,
      failedThreads: 0,
      lastError: null,
      analyzedThreads: 0,
      startedAt: this.progress.startedAt ?? undefined,
      status: "running",
      totalThreads: this.progress.totalThreads,
    });
  }

  private async getNextBatch(): Promise<BatchThread[]> {
    return listUnprocessedInboxThreadsBatch(
      this.accountId,
      EXTRACTION_BATCH_SIZE,
      [...this.skippedThreadIds],
    );
  }

  private async processBatch(batch: BatchThread[]): Promise<void> {
    const messagesByThreadId = await loadThreadMessages(batch.map((t) => t.id));

    let nextIndex = 0;
    const workerCount = Math.min(env.MEMORY_WORKER_CONCURRENCY, batch.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (!this.cancelled) {
        const thread = batch[nextIndex++];
        if (!thread) return;
        try {
          await processThread(thread, messagesByThreadId.get(thread.id) ?? []);
          await this.bumpProgress("processedThreads");
        } catch (error) {
          this.skippedThreadIds.add(thread.id);
          await this.bumpProgress("failedThreads");
          console.error(
            `[gmail-extraction] Skipped ${thread.gmailThreadId}:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
    });

    await Promise.all(workers);
  }

  private async bumpProgress(field: "processedThreads" | "failedThreads"): Promise<void> {
    this.progress[field] += 1;
    await incrementAnalysisProgress(
      this.accountId,
      field === "processedThreads" ? "analyzedThreads" : "failedThreads",
      1,
    );
  }

  private async markCompleted(): Promise<void> {
    this.progress.status = "completed";
    this.progress.error = null;
    await upsertAnalysisState(this.accountId, {
      completedAt: new Date().toISOString(),
      lastError: null,
      status: "completed",
    });
  }

  private async markPaused(): Promise<void> {
    this.progress.status = "paused";
    this.progress.error = null;
    await upsertAnalysisState(this.accountId, {
      completedAt: null,
      lastError: null,
      status: "paused",
    });
  }

  private async markErrored(message: string): Promise<void> {
    this.progress.status = "error";
    this.progress.error = message;
    await upsertAnalysisState(this.accountId, {
      completedAt: null,
      lastError: message,
      status: "error",
    });
  }
}

const activeExtractions = new Map<string, GmailExtractionOrchestrator>();
const activeScopedExtractions = new Map<string, Promise<void>>();

async function runScopedThreads(
  accountId: string,
  gmailThreadIds: string[],
): Promise<void> {
  const batch = await listUnprocessedInboxThreadsByGmailIds(
    accountId,
    gmailThreadIds,
  );
  if (batch.length === 0) return;

  const messagesByThreadId = await loadThreadMessages(batch.map((t) => t.id));

  let nextIndex = 0;
  const workerCount = Math.min(env.MEMORY_WORKER_CONCURRENCY, batch.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const thread = batch[nextIndex++];
      if (!thread) return;
      try {
        await processThread(thread, messagesByThreadId.get(thread.id) ?? []);
      } catch (error) {
        console.error(
          `[gmail-extraction:scoped] Skipped ${thread.gmailThreadId}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  });

  await Promise.all(workers);
}

export type ExtractionScope =
  | { accountId: string; mode: "all" }
  | { accountId: string; mode: "scoped"; gmailThreadIds: string[] };

/**
 * Single entry-point for kicking off extraction.
 *
 *   - `mode: "all"`    — returns the orchestrator (for status/cancel hooks).
 *                        Throws if one is already running for this account.
 *   - `mode: "scoped"` — fire-and-forget; returns null. No-op if any "all"
 *                        run is already in progress for this account.
 */
export function runExtraction(
  scope: ExtractionScope,
): GmailExtractionOrchestrator | null {
  const { accountId } = scope;
  if (scope.mode === "all") {
    if (activeExtractions.has(accountId)) {
      throw new Error("Extraction already in progress for this account");
    }
    const orch = new GmailExtractionOrchestrator(accountId);
    activeExtractions.set(accountId, orch);
    void orch.start().finally(() => {
      if (activeExtractions.get(accountId) === orch) {
        activeExtractions.delete(accountId);
      }
    });
    return orch;
  }

  if (scope.gmailThreadIds.length === 0) return null;
  if (activeExtractions.has(accountId)) return null;
  if (activeScopedExtractions.has(accountId)) return null;

  const run = runScopedThreads(accountId, scope.gmailThreadIds)
    .catch((error) => {
      console.error("[gmail-extraction:scoped] Run failed:", error);
    })
    .finally(() => {
      if (activeScopedExtractions.get(accountId) === run) {
        activeScopedExtractions.delete(accountId);
      }
    });
  activeScopedExtractions.set(accountId, run);
  return null;
}

export function getActiveGmailExtraction(
  accountId: string,
): GmailExtractionOrchestrator | undefined {
  return activeExtractions.get(accountId);
}

export async function cancelGmailExtraction(accountId: string): Promise<boolean> {
  const orch = activeExtractions.get(accountId);
  if (!orch) return false;
  orch.cancel();
  return true;
}

export type { GmailExtractionOrchestrator };
