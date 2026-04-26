import { env } from "@g-spot/env/server";
import {
  getGmailThreadStats,
  incrementSyncProgress,
  listMessagesByThreadIds,
  listUnprocessedInboxThreadsBatch,
  markThreadProcessed,
  upsertSyncState,
} from "@g-spot/db/gmail";

import {
  threadToText,
  type ParsedMessage,
} from "./gmail-client";
import { extractAndIngestThread } from "./memory-extractor";

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

function storedMessageToParsedMessage(message: StoredThreadMessage): ParsedMessage {
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
    labels: JSON.parse(message.labels) as string[],
    messageIdHeader: message.messageIdHeader,
    inReplyTo: message.inReplyTo,
    referencesHeader: message.referencesHeader,
    isDraft: message.isDraft,
    historyId: message.historyId,
    rawSizeEstimate: message.rawSizeEstimate,
  };
}

export class GmailExtractionOrchestrator {
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

    await upsertSyncState(this.accountId, {
      completedAt: null,
      failedThreads: 0,
      fetchedThreads: 0,
      lastError: null,
      processableThreads: this.progress.totalThreads,
      processedThreads: 0,
      startedAt: this.progress.startedAt ?? undefined,
      status: "running",
      totalThreads: 0,
    });
  }

  private async processBatch(batch: BatchThread[]): Promise<void> {
    const messagesByThreadId = new Map<string, StoredThreadMessage[]>();
    const messages = await listMessagesByThreadIds(batch.map((thread) => thread.id));
    for (const message of messages) {
      const threadMessages = messagesByThreadId.get(message.threadId) ?? [];
      threadMessages.push(message);
      messagesByThreadId.set(message.threadId, threadMessages);
    }

    let nextIndex = 0;
    const workerCount = Math.min(env.MEMORY_WORKER_CONCURRENCY, batch.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (!this.cancelled) {
        const thread = batch[nextIndex++];
        if (!thread) return;
        await this.processThread(thread, messagesByThreadId.get(thread.id) ?? []);
      }
    });

    await Promise.all(workers);
  }

  private async getNextBatch(): Promise<BatchThread[]> {
    return listUnprocessedInboxThreadsBatch(
      this.accountId,
      EXTRACTION_BATCH_SIZE,
      [...this.skippedThreadIds],
    );
  }

  private async processThread(
    thread: BatchThread,
    storedMessages: StoredThreadMessage[],
  ): Promise<void> {
    try {
      const messages = storedMessages.map(storedMessageToParsedMessage);
      const content = threadToText(thread.subject, messages);
      await extractAndIngestThread(content, thread.gmailThreadId);
      await markThreadProcessed(thread.id);
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

  private async bumpProgress(field: "processedThreads" | "failedThreads"): Promise<void> {
    this.progress[field] += 1;
    await incrementSyncProgress(this.accountId, field, 1);
  }

  private async markCompleted(): Promise<void> {
    this.progress.status = "completed";
    this.progress.error = null;
    await upsertSyncState(this.accountId, {
      completedAt: new Date().toISOString(),
      lastError: null,
      status: "completed",
    });
  }

  private async markPaused(): Promise<void> {
    this.progress.status = "paused";
    this.progress.error = null;
    await upsertSyncState(this.accountId, {
      completedAt: null,
      lastError: null,
      status: "paused",
    });
  }

  private async markErrored(message: string): Promise<void> {
    this.progress.status = "error";
    this.progress.error = message;
    await upsertSyncState(this.accountId, {
      completedAt: null,
      lastError: message,
      status: "error",
    });
  }
}

const activeExtractions = new Map<string, GmailExtractionOrchestrator>();

export async function startGmailExtraction(
  accountId: string,
): Promise<GmailExtractionOrchestrator> {
  const existing = activeExtractions.get(accountId);
  if (existing) {
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
