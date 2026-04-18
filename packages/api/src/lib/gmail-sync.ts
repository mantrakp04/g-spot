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
import { env } from "@g-spot/env/server";

import {
  deleteMissingThreadMessages,
  getFetchedGmailThreadIds,
  getGmailAccountById,
  getRunningSyncStates,
  getSyncState,
  getThread,
  getThreadMessages,
  getRetryableFailureThreadIds,
  getUnprocessedInboxGmailThreadIds,
  incrementSyncProgress,
  markThreadProcessed,
  recordSyncFailure,
  resolveFailuresForThread,
  setGmailAccountNeedsFullResync,
  syncLabels,
  updateGmailAccountHistoryId,
  updateGmailAccountSyncTimestamp,
  upsertAttachments,
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

export const syncModes = ["full", "incremental"] as const;
export type SyncMode = (typeof syncModes)[number];
export const syncStartIntents = [
  ...syncModes,
  "auto",
  "push",
  "resume",
  "retry_failed",
] as const;
export type SyncStartIntent = (typeof syncStartIntents)[number];
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

const GMAIL_INBOX_LABEL = "INBOX";

interface FetchItem {
  gmailThreadId: string;
}

interface ProcessItem {
  dbThreadId: string;
  gmailThreadId: string;
  subject: string;
  messages: ParsedMessage[];
}

type ProgressSnapshot = Pick<
  SyncProgress,
  "totalThreads" | "fetchedThreads" | "processedThreads" | "failedThreads"
>;

type SyncScope = ProgressSnapshot & {
  toFetch: string[];
  unprocessedInScope: string[];
};

type SyncExecutionPlan = {
  bootstrapProgress: ProgressSnapshot | null;
  intent: SyncStartIntent;
  mode: SyncMode;
  scopeStrategy: SyncMode | "failed_only";
  updatesAccountCheckpoint: boolean;
};

type SyncStartPlanAccount = Pick<
  NonNullable<Awaited<ReturnType<typeof getGmailAccountById>>>,
  "lastFullSyncAt" | "lastIncrementalSyncAt" | "needsFullResync"
>;

type SyncStartPlanState = Pick<
  NonNullable<Awaited<ReturnType<typeof getSyncState>>>,
  "failedThreads"
  | "fetchedThreads"
  | "mode"
  | "processedThreads"
  | "status"
  | "totalThreads"
>;

type SyncThreadResolution = {
  completedMode: SyncMode | null;
  finalHistoryId: string | null;
  threadIds: string[];
};

type SyncStateWrite = Parameters<typeof upsertSyncState>[1];

type StoredThreadMessage = Awaited<ReturnType<typeof getThreadMessages>>[number];

function getBootstrapProgress(
  syncState: SyncStartPlanState | null,
): ProgressSnapshot | null {
  if (!syncState) return null;
  return {
    totalThreads: syncState.totalThreads,
    fetchedThreads: syncState.fetchedThreads,
    processedThreads: syncState.processedThreads,
    failedThreads: syncState.failedThreads,
  };
}

function hasCompletedSync(account: SyncStartPlanAccount | null): boolean {
  return Boolean(account?.lastFullSyncAt || account?.lastIncrementalSyncAt);
}

function resolveModeFromSyncState(syncState: SyncStartPlanState | null): SyncMode {
  return syncState?.mode === "incremental" ? "incremental" : "full";
}

function resolveModeFromAccount(account: SyncStartPlanAccount | null): SyncMode {
  return hasCompletedSync(account) && !account?.needsFullResync
    ? "incremental"
    : "full";
}

function resolveModeForRetry(input: {
  account: SyncStartPlanAccount | null;
  syncState: SyncStartPlanState | null;
}): SyncMode {
  return input.syncState
    ? resolveModeFromSyncState(input.syncState)
    : resolveModeFromAccount(input.account);
}

function getFailureRetryBootstrapProgress(
  syncState: SyncStartPlanState | null,
): ProgressSnapshot | null {
  if (!syncState || syncState.failedThreads === 0) return null;

  return {
    totalThreads: syncState.failedThreads,
    fetchedThreads: 0,
    processedThreads: 0,
    failedThreads: syncState.failedThreads,
  };
}

export function resolveSyncStartPlan(
  intent: SyncStartIntent,
  input: {
    account: SyncStartPlanAccount | null;
    syncState: SyncStartPlanState | null;
  },
): SyncExecutionPlan {
  if (intent === "full" || intent === "incremental") {
    return {
      bootstrapProgress: null,
      intent,
      mode: intent,
      scopeStrategy: intent,
      updatesAccountCheckpoint: true,
    };
  }

  if (
    intent === "resume"
    || (intent === "auto" && input.syncState?.status === "paused")
    || (intent === "retry_failed" && input.syncState?.status === "paused")
  ) {
    const mode = resolveModeFromSyncState(input.syncState);
    return {
      bootstrapProgress: getBootstrapProgress(input.syncState),
      intent,
      mode,
      scopeStrategy: mode,
      updatesAccountCheckpoint: true,
    };
  }

  if (intent === "retry_failed") {
    return {
      bootstrapProgress: getFailureRetryBootstrapProgress(input.syncState),
      intent,
      mode: resolveModeForRetry(input),
      scopeStrategy: "failed_only",
      updatesAccountCheckpoint: false,
    };
  }

  const mode = resolveModeFromAccount(input.account);
  return {
    bootstrapProgress: null,
    intent,
    mode,
    scopeStrategy: mode,
    updatesAccountCheckpoint: true,
  };
}

async function resolveSyncExecutionPlan(
  accountId: string,
  intent: SyncStartIntent,
): Promise<SyncExecutionPlan> {
  const [account, syncState] = await Promise.all([
    getGmailAccountById(accountId),
    getSyncState(accountId),
  ]);

  return resolveSyncStartPlan(intent, {
    account: account
      ? {
        lastFullSyncAt: account.lastFullSyncAt,
        lastIncrementalSyncAt: account.lastIncrementalSyncAt,
        needsFullResync: account.needsFullResync,
      }
      : null,
    syncState: syncState
      ? {
        failedThreads: syncState.failedThreads,
        fetchedThreads: syncState.fetchedThreads,
        mode: syncState.mode,
        processedThreads: syncState.processedThreads,
        status: syncState.status,
        totalThreads: syncState.totalThreads,
      }
      : null,
  });
}

export function getScopedSyncResumeState(
  threadIds: string[],
  alreadyFetched: ReadonlySet<string>,
  unprocessed: string[],
): {
  fetchedInScope: Set<string>;
  processedThreads: number;
  toFetch: string[];
  totalThreads: number;
  unprocessedInScope: string[];
} {
  const threadIdSet = new Set(threadIds);
  const fetchedInScope = new Set(
    threadIds.filter((id) => alreadyFetched.has(id)),
  );
  const unprocessedInScope = unprocessed.filter((id) => threadIdSet.has(id));

  return {
    fetchedInScope,
    processedThreads: Math.max(
      0,
      fetchedInScope.size - unprocessedInScope.length,
    ),
    toFetch: threadIds.filter((id) => !fetchedInScope.has(id)),
    totalThreads: threadIds.length,
    unprocessedInScope,
  };
}

export function threadHasInboxLabel(labels: readonly string[]): boolean {
  return labels.includes(GMAIL_INBOX_LABEL);
}

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

export async function upsertRemoteGmailThread(
  accountId: string,
  token: string,
  gmailThreadId: string,
): Promise<{
  dbThreadId: string;
  subject: string;
  messages: ParsedMessage[];
  shouldExtract: boolean;
}> {
  const detail = await getThreadDetail(token, gmailThreadId);
  const messages = detail.messages.map(parseGmailMessage);

  const subject = messages[0]?.subject ?? "(no subject)";
  const lastMsg = messages[messages.length - 1];
  const lastMessageAt = lastMsg?.date ?? new Date().toISOString();
  const allLabels = new Set<string>();
  for (const msg of messages) {
    for (const label of msg.labels) allLabels.add(label);
  }

  const { id: dbThreadId } = await upsertThread(accountId, {
    gmailThreadId,
    subject,
    snippet: messages[0]?.snippet ?? "",
    lastMessageAt,
    messageCount: messages.length,
    labels: Array.from(allLabels),
    historyId: detail.historyId ?? undefined,
  });

  await deleteMissingThreadMessages(
    dbThreadId,
    detail.messages.map((message) => message.id),
  );

  const msgIds = await upsertMessages(dbThreadId, accountId, messages);

  for (let i = 0; i < detail.messages.length; i++) {
    if (!msgIds[i]) continue;
    await upsertAttachments(msgIds[i]!, parseAttachments(detail.messages[i]!));
  }

  const labels = Array.from(allLabels);

  return {
    dbThreadId,
    subject,
    messages,
    shouldExtract: threadHasInboxLabel(labels),
  };
}

// ---------------------------------------------------------------------------
// Config from env
// ---------------------------------------------------------------------------

const FETCH_CONCURRENCY = env.GMAIL_SYNC_CONCURRENCY;
const PROCESS_CONCURRENCY = env.MEMORY_WORKER_CONCURRENCY;

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

const MAX_CIRCUIT_BACKOFF_SEC = 600;

export class GmailSyncOrchestrator {
  private fetchQueue: AsyncQueuer<FetchItem>;
  private processQueue: AsyncQueuer<ProcessItem>;
  private circuitState: CircuitState = "closed";
  private rateLimitStreak = 0;
  private cancelled = false;
  private progress: SyncProgress;
  private accountId: string;
  private token: string;

  constructor(
    accountId: string,
    token: string,
  ) {
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
        onSuccess: (_result, item) => this.handleStageSuccess("fetch", item.gmailThreadId),
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
        onSuccess: (_result, item) => this.handleStageSuccess("process", item.gmailThreadId),
      },
    );
  }

  private clearFailureFor(
    gmailThreadId: string,
    source: "fetch" | "process",
  ): void {
    resolveFailuresForThread(this.accountId, gmailThreadId)
      .then(async (cleared) => {
        if (cleared > 0) {
          this.progress.failedThreads = Math.max(
            0,
            this.progress.failedThreads - cleared,
          );
          await incrementSyncProgress(
            this.accountId,
            "failedThreads",
            -cleared,
          );
        }
      })
      .catch((err) => {
        console.error(
          `[gmail-sync] resolveFailuresForThread (${source}) failed for ${gmailThreadId}:`,
          err,
        );
      });
  }

  // ----- Public API -----

  async startSync(plan: SyncExecutionPlan): Promise<void> {
    await this.beginRun(plan);

    try {
      const resolution = await this.resolveThreadIdsForPlan(plan);
      if (this.cancelled) return;

      const scope = await this.resolveSyncScope(plan, resolution);

      await this.setRunningScope(scope);

      this.enqueueFetchItems(scope.toFetch);
      await this.enqueueStoredThreadsForProcessing(scope.unprocessedInScope);

      this.fetchQueue.start();
      this.processQueue.start();

      await this.waitForCompletion();

      if (this.cancelled) return;

      await this.finishSuccessfulSync(plan, resolution);
    } catch (error) {
      if (this.cancelled) {
        // Cancellation that surfaced as a thrown error from an in-flight call —
        // treat as paused, not an error.
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        await this.markErrored(msg);
        console.error("[gmail-sync] Sync failed:", error);
      }
    } finally {
      this.fetchQueue.stop();
      this.processQueue.stop();
      if (this.cancelled) {
        await this.markPaused().catch((err) =>
          console.error("[gmail-sync] Failed to persist paused state:", err)
        );
      }
    }
  }

  getProgress(): SyncProgress {
    return { ...this.progress };
  }

  cancel(): void {
    this.cancelled = true;
    this.fetchQueue.stop();
    this.processQueue.stop();
    this.fetchQueue.clear();
    this.processQueue.clear();
    this.progress.status = "paused";
  }

  // ----- Internal: Lifecycle -----

  private async beginRun(plan: SyncExecutionPlan): Promise<void> {
    this.progress.status = "running";
    this.progress.mode = plan.mode;
    this.progress.startedAt = new Date().toISOString();
    this.progress.error = null;
    this.progress.totalThreads = plan.bootstrapProgress?.totalThreads ?? 0;
    this.progress.fetchedThreads = plan.bootstrapProgress?.fetchedThreads ?? 0;
    this.progress.processedThreads =
      plan.bootstrapProgress?.processedThreads ?? 0;
    this.progress.failedThreads = plan.bootstrapProgress?.failedThreads ?? 0;
    this.cancelled = false;
    this.rateLimitStreak = 0;
    this.circuitState = "closed";

    await this.persistSyncState({
      completedAt: null,
      lastError: null,
      status: "running",
    });
  }

  private async resolveThreadIdsForPlan(
    plan: SyncExecutionPlan,
  ): Promise<SyncThreadResolution> {
    if (plan.scopeStrategy === "failed_only") {
      return {
        completedMode: null,
        finalHistoryId: null,
        threadIds: await getRetryableFailureThreadIds(this.accountId),
      };
    }

    return this.resolveThreadIdsForMode(plan.scopeStrategy);
  }

  private async resolveThreadIdsForMode(mode: SyncMode): Promise<{
    completedMode: SyncMode;
    finalHistoryId: string;
    threadIds: string[];
  }> {
    let completedMode: SyncMode = mode;
    const profile = await getProfile(this.token);
    const labels = await listLabels(this.token);
    let finalHistoryId = profile.historyId;
    await syncLabels(
      this.accountId,
      labels.map((l) => ({
        gmailId: l.id,
        name: l.name,
        type: l.type,
        color: l.color ? JSON.stringify(l.color) : null,
      })),
    );

    if (mode === "full") {
      return {
        completedMode,
        finalHistoryId,
        threadIds: await listAllThreadIds(this.token),
      };
    }

    const account = await getGmailAccountById(this.accountId);
    const lastHistoryId = account?.historyId;
    if (!lastHistoryId) {
      completedMode = "full";
      return {
        completedMode,
        finalHistoryId,
        threadIds: await listAllThreadIds(this.token),
      };
    }

    const history = await getHistory(this.token, lastHistoryId);
    if (!history.expired) {
      return {
        completedMode,
        finalHistoryId: history.newHistoryId,
        threadIds: history.threadIds,
      };
    }

    completedMode = "full";
    await setGmailAccountNeedsFullResync(this.accountId, true);

    return {
      completedMode,
      finalHistoryId,
      threadIds: await listAllThreadIds(this.token),
    };
  }

  private async resolveSyncScope(
    plan: SyncExecutionPlan,
    resolution: SyncThreadResolution,
  ): Promise<SyncScope> {
    const failedThreadIds = plan.scopeStrategy === "failed_only"
      ? resolution.threadIds
      : await getRetryableFailureThreadIds(this.accountId);
    const scopedThreadIds =
      plan.scopeStrategy === "failed_only" || failedThreadIds.length === 0
        ? resolution.threadIds
        : Array.from(new Set([...resolution.threadIds, ...failedThreadIds]));

    return this.buildSyncScope(scopedThreadIds, failedThreadIds.length);
  }

  private async buildSyncScope(
    threadIds: string[],
    failedThreads: number,
  ): Promise<SyncScope> {
    const alreadyFetched = await getFetchedGmailThreadIds(this.accountId);
    const unprocessed = await getUnprocessedInboxGmailThreadIds(this.accountId);
    const {
      fetchedInScope,
      processedThreads,
      toFetch,
      totalThreads,
      unprocessedInScope,
    } = getScopedSyncResumeState(
      threadIds,
      alreadyFetched,
      unprocessed,
    );

    return {
      failedThreads,
      fetchedThreads: fetchedInScope.size,
      processedThreads,
      toFetch,
      totalThreads,
      unprocessedInScope,
    };
  }

  private async setRunningScope(scope: ProgressSnapshot): Promise<void> {
    this.progress.totalThreads = scope.totalThreads;
    this.progress.fetchedThreads = scope.fetchedThreads;
    this.progress.processedThreads = scope.processedThreads;
    this.progress.failedThreads = scope.failedThreads;

    await this.persistSyncState({
      completedAt: null,
      lastError: null,
      status: "running",
    });
  }

  private async finishSuccessfulSync(
    plan: SyncExecutionPlan,
    resolution: Pick<SyncThreadResolution, "completedMode" | "finalHistoryId">,
  ): Promise<void> {
    if (plan.updatesAccountCheckpoint) {
      if (!resolution.completedMode || !resolution.finalHistoryId) {
        throw new Error("Missing Gmail sync checkpoint for completed sync");
      }

      await updateGmailAccountHistoryId(this.accountId, resolution.finalHistoryId);
      await updateGmailAccountSyncTimestamp(this.accountId, resolution.completedMode);
    }

    await this.markCompleted();
  }

  private async persistSyncState(
    overrides: SyncStateWrite = {},
  ): Promise<void> {
    await upsertSyncState(this.accountId, {
      status: this.progress.status,
      totalThreads: this.progress.totalThreads,
      fetchedThreads: this.progress.fetchedThreads,
      processedThreads: this.progress.processedThreads,
      failedThreads: this.progress.failedThreads,
      lastError: this.progress.error,
      ...(this.progress.mode ? { mode: this.progress.mode } : {}),
      ...(this.progress.startedAt ? { startedAt: this.progress.startedAt } : {}),
      ...overrides,
    });
  }

  private async markCompleted(): Promise<void> {
    this.progress.status = "completed";
    this.progress.error = null;
    await this.persistSyncState({
      completedAt: new Date().toISOString(),
      lastError: null,
      status: "completed",
    });
  }

  private async markPaused(): Promise<void> {
    this.progress.status = "paused";
    this.progress.error = null;
    await this.persistSyncState({
      completedAt: null,
      lastError: null,
      status: "paused",
    });
  }

  private async markErrored(message: string): Promise<void> {
    this.progress.status = "error";
    this.progress.error = message;
    await this.persistSyncState({
      completedAt: null,
      lastError: message,
      status: "error",
    });
  }

  private enqueueFetchItems(threadIds: string[]): void {
    for (const gmailThreadId of threadIds) {
      if (this.cancelled) break;
      this.fetchQueue.addItem({ gmailThreadId });
    }
  }

  private async enqueueStoredThreadsForProcessing(
    gmailThreadIds: string[],
  ): Promise<void> {
    for (const gmailThreadId of gmailThreadIds) {
      if (this.cancelled) break;
      const item = await this.getStoredProcessItem(gmailThreadId);
      if (item) {
        this.processQueue.addItem(item);
      }
    }
  }

  private async getStoredProcessItem(
    gmailThreadId: string,
  ): Promise<ProcessItem | null> {
    const thread = await getThread(this.accountId, gmailThreadId);
    if (!thread) return null;
    if (!threadHasInboxLabel(JSON.parse(thread.labels) as string[])) {
      return null;
    }

    return {
      dbThreadId: thread.id,
      gmailThreadId,
      subject: thread.subject,
      messages: (await getThreadMessages(thread.id)).map(storedMessageToParsedMessage),
    };
  }

  private bumpProgress(
    field: "fetchedThreads" | "processedThreads" | "failedThreads",
    amount = 1,
  ): void {
    this.progress[field] = Math.max(0, this.progress[field] + amount);
    incrementSyncProgress(this.accountId, field, amount).catch(() => {});
  }

  private handleStageSuccess(
    stage: "fetch" | "process",
    gmailThreadId: string,
  ): void {
    if (stage === "fetch") {
      this.rateLimitStreak = 0;
      this.bumpProgress("fetchedThreads");
    } else {
      this.bumpProgress("processedThreads");
    }
    this.clearFailureFor(gmailThreadId, stage);
  }

  private recordStageFailure(
    item: Pick<FetchItem | ProcessItem, "gmailThreadId">,
    data: {
      error: Error;
      errorCode: string;
      logLabel: "Fetch" | "Process";
      stage: "fetch" | "extract";
    },
  ): void {
    recordSyncFailure(this.accountId, {
      gmailThreadId: item.gmailThreadId,
      stage: data.stage,
      errorMessage: data.error.message,
      errorCode: data.errorCode,
    })
      .then((created) => {
        if (created) {
          this.bumpProgress("failedThreads");
        }
      })
      .catch(() => {});

    console.error(
      `[gmail-sync] ${data.logLabel} failed for ${item.gmailThreadId}:`,
      data.error.message,
    );
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

    const { dbThreadId, subject, messages, shouldExtract } = await upsertRemoteGmailThread(
      this.accountId,
      this.token,
      item.gmailThreadId,
    );

    if (!shouldExtract) return;

    // Enqueue for memory processing
    this.processQueue.addItem({
      dbThreadId,
      gmailThreadId: item.gmailThreadId,
      subject,
      messages,
    });
  }

  private handleFetchError(error: Error, item: FetchItem): void {
    if (this.cancelled) return;

    if (error instanceof GmailApiError && error.isRateLimit) {
      this.openCircuit(error.retryAfter ?? 60);
      // Re-enqueue
      this.fetchQueue.addItem(item);
      return;
    }

    this.recordStageFailure(item, {
      error,
      errorCode: error instanceof GmailApiError ? String(error.status) : "UNKNOWN",
      logLabel: "Fetch",
      stage: "fetch",
    });
  }

  // ----- Internal: Process -----

  private async processThread(item: ProcessItem): Promise<void> {
    if (this.cancelled) return;

    const content = threadToText(item.subject, item.messages);

    await extractAndIngestThread(content, item.gmailThreadId);
    await markThreadProcessed(item.dbThreadId);
  }

  private handleProcessError(error: Error, item: ProcessItem): void {
    if (this.cancelled) return;

    this.recordStageFailure(item, {
      error,
      errorCode: "LLM_ERROR",
      logLabel: "Process",
      stage: "extract",
    });
  }

  // ----- Internal: Circuit Breaker -----

  private openCircuit(retryAfterSec: number): void {
    if (this.circuitState === "open") return;
    this.circuitState = "open";
    this.rateLimitStreak += 1;

    const backoffSec = Math.min(
      retryAfterSec * 2 ** (this.rateLimitStreak - 1),
      MAX_CIRCUIT_BACKOFF_SEC,
    );

    // Actually pause the queue. Without stop(), workers keep pulling items
    // and the open-circuit guard re-enqueues them in a tight loop, piling
    // up re-attempts while the circuit is "open".
    this.fetchQueue.stop();

    setTimeout(() => {
      if (this.cancelled || this.circuitState !== "open") return;
      this.circuitState = "closed";
      this.fetchQueue.start();
    }, backoffSec * 1000);
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

export async function startSync(
  accountId: string,
  token: string,
  intent: SyncStartIntent,
): Promise<GmailSyncOrchestrator> {
  const existing = activeSyncs.get(accountId);
  if (existing && existing.getProgress().status === "running") {
    throw new Error("Sync already in progress for this account");
  }

  const orch = new GmailSyncOrchestrator(accountId, token);
  activeSyncs.set(accountId, orch);

  try {
    const plan = await resolveSyncExecutionPlan(accountId, intent);
    void orch.startSync(plan).finally(() => {
      const current = activeSyncs.get(accountId);
      if (current === orch) activeSyncs.delete(accountId);
    });
    return orch;
  } catch (error) {
    const current = activeSyncs.get(accountId);
    if (current === orch) activeSyncs.delete(accountId);
    throw error;
  }
}

export function getActiveSync(
  accountId: string,
): GmailSyncOrchestrator | undefined {
  return activeSyncs.get(accountId);
}

export async function cancelSync(accountId: string): Promise<boolean> {
  const orch = activeSyncs.get(accountId);
  if (orch) {
    orch.cancel();
    return true;
  }

  // Orphaned "running" state in DB (likely from a previous server process).
  // Force-reconcile so the UI stops showing it as active.
  const state = await getSyncState(accountId);
  if (state && (state.status === "running" || state.status === "paused")) {
    await upsertSyncState(accountId, {
      status: "paused",
      completedAt: null,
      lastError: null,
    });
    return true;
  }

  return false;
}

/**
 * Reconcile orphaned "running" syncs left over from a previous server
 * process. Called once at module load.
 */
async function reconcileOrphanedSyncs(): Promise<void> {
  try {
    const stuck = await getRunningSyncStates();
    if (stuck.length === 0) return;
    for (const state of stuck) {
      await upsertSyncState(state.accountId, {
        status: "paused",
        completedAt: null,
        lastError: null,
      });
    }
  } catch (err) {
    console.error("[gmail-sync] Failed to reconcile orphaned syncs:", err);
  }
}

void reconcileOrphanedSyncs();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
