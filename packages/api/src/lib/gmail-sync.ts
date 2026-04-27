/**
 * Gmail sync orchestrator.
 *
 * Fetches threads from Gmail API and stores them in the local DB.
 *
 * Analysis policy:
 * - Full sync: never auto-runs analysis. Manual extraction only.
 * - Incremental sync: on successful completion, auto-runs a scoped extraction
 *   (`runScopedGmailExtraction`) for *only* the threads it just fetched. The
 *   scoped runner is decoupled from `syncState` and skips itself if a manual
 *   full extraction is already active (that orchestrator's batch loop will
 *   pick the freshly-stored unprocessed inbox threads up on its own).
 *
 * Circuit breaker: 429s pause all fetching.
 */

import { AsyncQueuer } from "@tanstack/pacer";
import { env } from "@g-spot/env/server";

import { runScopedGmailExtraction } from "./gmail-extraction";

import {
  deleteMissingThreadMessages,
  getFetchState,
  getFetchedGmailThreadIds,
  getFetchedInboxGmailThreadIds,
  getGmailAccountById,
  getRunningFetchStates,
  getUnprocessedInboxGmailThreadIds,
  incrementFetchProgress,
  listFetchStates,
  markThreadUnprocessed,
  recordSyncFailure,
  resolveFailuresForThread,
  setGmailAccountNeedsFullResync,
  syncAccountDraftIds,
  syncLabels,
  updateGmailAccountHistoryId,
  updateGmailAccountSyncTimestamp,
  upsertFetchState,
  upsertAttachments,
  upsertMessages,
  upsertThread,
} from "@g-spot/db/gmail";

import { fanoutNewGmailMessages } from "./chat-gmail";

import {
  getProfile,
  getThreadDetail,
  getHistory,
  listAllDraftMappings,
  listAllThreadIds,
  listLabels,
  parseGmailMessage,
  parseAttachments,
  GmailApiError,
  type ParsedMessage,
} from "./gmail-client";

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
] as const;
export type SyncStartIntent = (typeof syncStartIntents)[number];
type CircuitState = "closed" | "open";

export interface SyncProgress {
  status: "idle" | "running" | "paused" | "interrupted" | "completed" | "error";
  mode: SyncMode | null;
  totalThreads: number;
  fetchedThreads: number;
  processableThreads: number;
  processedThreads: number;
  failedThreads: number;
  startedAt: string | null;
  error: string | null;
}

const GMAIL_INBOX_LABEL = "INBOX";

interface FetchItem {
  gmailThreadId: string;
}

type ProgressSnapshot = Pick<
  SyncProgress,
  | "totalThreads"
  | "fetchedThreads"
  | "processableThreads"
  | "processedThreads"
  | "failedThreads"
>;

type SyncScope = ProgressSnapshot & {
  toFetch: string[];
};

type SyncExecutionPlan = {
  bootstrapProgress: ProgressSnapshot | null;
  intent: SyncStartIntent;
  mode: SyncMode;
  scopeStrategy: SyncMode;
  updatesAccountCheckpoint: boolean;
};

type SyncStartPlanAccount = Pick<
  NonNullable<Awaited<ReturnType<typeof getGmailAccountById>>>,
  "lastFullSyncAt" | "lastIncrementalSyncAt" | "needsFullResync"
>;

type SyncStartPlanState = Pick<
  NonNullable<Awaited<ReturnType<typeof getFetchState>>>,
  "fetchedThreads"
  | "mode"
  | "status"
  | "totalThreads"
>;

type SyncThreadResolution = {
  completedMode: SyncMode | null;
  finalHistoryId: string | null;
  threadIds: string[];
};

type FetchStateWrite = Parameters<typeof upsertFetchState>[2];
type GmailProfile = Awaited<ReturnType<typeof getProfile>>;

function getBootstrapProgress(
  syncState: SyncStartPlanState | null,
): ProgressSnapshot | null {
  if (!syncState) return null;
  return {
    totalThreads: syncState.totalThreads,
    fetchedThreads: syncState.fetchedThreads,
    processableThreads: 0,
    processedThreads: 0,
    failedThreads: 0,
  };
}

function hasCompletedFullSync(account: SyncStartPlanAccount | null): boolean {
  return Boolean(account?.lastFullSyncAt);
}

function resolveModeFromSyncState(syncState: SyncStartPlanState | null): SyncMode {
  return syncState?.mode === "incremental" ? "incremental" : "full";
}

function resolveModeFromAccount(account: SyncStartPlanAccount | null): SyncMode {
  return hasCompletedFullSync(account) && !account?.needsFullResync
    ? "incremental"
    : "full";
}

export function resolveSyncStartPlan(
  intent: SyncStartIntent,
  input: {
    account: SyncStartPlanAccount | null;
    syncState: SyncStartPlanState | null;
  },
): SyncExecutionPlan | null {
  if (intent === "incremental") {
    if (!hasCompletedFullSync(input.account) || input.account?.needsFullResync) {
      return null;
    }
    return {
      bootstrapProgress: null,
      intent,
      mode: "incremental",
      scopeStrategy: "incremental",
      updatesAccountCheckpoint: true,
    };
  }

  if (intent === "full") {
    return {
      bootstrapProgress: null,
      intent,
      mode: "full",
      scopeStrategy: "full",
      updatesAccountCheckpoint: true,
    };
  }

  if (intent === "push") {
    if (
      !hasCompletedFullSync(input.account)
      || input.account?.needsFullResync
      || input.syncState?.status === "running"
      || input.syncState?.status === "paused"
      || input.syncState?.status === "interrupted"
    ) {
      return null;
    }
    return {
      bootstrapProgress: null,
      intent,
      mode: "incremental",
      scopeStrategy: "incremental",
      updatesAccountCheckpoint: true,
    };
  }

  if (
    intent === "resume"
    || (intent === "auto" && (
      input.syncState?.status === "paused"
      || input.syncState?.status === "interrupted"
    ))
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
): Promise<SyncExecutionPlan | null> {
  const [account, fetchStates] = await Promise.all([
    getGmailAccountById(accountId),
    listFetchStates(accountId),
  ]);
  const syncState = getRelevantFetchState(intent, fetchStates);

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
        fetchedThreads: syncState.fetchedThreads,
        mode: syncState.mode === "incremental" ? "incremental" : "full",
        status: syncState.status,
        totalThreads: syncState.totalThreads,
      }
      : null,
  });
}

function getRelevantFetchState(
  intent: SyncStartIntent,
  states: Array<Pick<SyncStartPlanState, "fetchedThreads" | "mode" | "status" | "totalThreads">>,
): SyncStartPlanState | null {
  const paused = states.find((state) =>
    state.status === "paused" || state.status === "interrupted"
  );
  if (intent === "resume" || intent === "auto") return paused ?? null;
  if (intent === "full") {
    return states.find((state) => state.mode === "full") ?? null;
  }
  if (intent === "incremental" || intent === "push") {
    return states.find((state) => state.mode === "incremental") ?? null;
  }
  return null;
}

export function getScopedSyncResumeState(
  threadIds: string[],
  alreadyFetched: ReadonlySet<string>,
  alreadyFetchedInbox: ReadonlySet<string>,
  unprocessed: string[],
  mode: SyncMode = "full",
): {
  fetchedInScope: Set<string>;
  processableThreads: number;
  processedThreads: number;
  toFetch: string[];
  totalThreads: number;
  unprocessedInScope: string[];
} {
  const threadIdSet = new Set(threadIds);
  const inboxFetchedInScopeSize = threadIds.reduce(
    (acc, id) => (alreadyFetchedInbox.has(id) ? acc + 1 : acc),
    0,
  );
  const unprocessedInScope = unprocessed.filter((id) => threadIdSet.has(id));

  // Incremental sync receives only threads that *changed* since the last
  // historyId (e.g. label flips like UNREAD removed). Every one of those is
  // dirty and must be re-fetched even if it's already in the DB — otherwise
  // label/read-state changes never land locally. Full sync keeps the dedupe
  // so a resumed run doesn't re-download the whole mailbox.
  //
  // Because incremental refetches every scoped thread, it must not pre-count
  // already-fetched inbox rows as processable or enqueue stored unprocessed
  // rows. Fetching the dirty thread decides whether it is still inbox and
  // increments the processable counter exactly once.
  if (mode === "incremental") {
    return {
      fetchedInScope: new Set<string>(),
      processableThreads: 0,
      processedThreads: 0,
      toFetch: [...threadIds],
      totalThreads: threadIds.length,
      unprocessedInScope: [],
    };
  }

  const fetchedInScope = new Set(threadIds.filter((id) => alreadyFetched.has(id)));
  const toFetch = threadIds.filter((id) => !fetchedInScope.has(id));

  return {
    fetchedInScope,
    processableThreads: inboxFetchedInScopeSize,
    processedThreads: Math.max(
      0,
      inboxFetchedInScopeSize - unprocessedInScope.length,
    ),
    toFetch,
    totalThreads: threadIds.length,
    unprocessedInScope,
  };
}

export function threadHasInboxLabel(labels: readonly string[]): boolean {
  return labels.includes(GMAIL_INBOX_LABEL);
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

  const { id: dbThreadId, isProcessed } = await upsertThread(accountId, {
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

  const upsertedMessages = await upsertMessages(dbThreadId, accountId, messages);

  for (let i = 0; i < detail.messages.length; i++) {
    const message = upsertedMessages[i];
    if (!message) continue;
    await upsertAttachments(message.id, parseAttachments(detail.messages[i]!));
  }

  const newMessageIds = new Set(
    upsertedMessages
      .filter((message) => message.isNew)
      .map((message) => message.gmailMessageId),
  );
  const newlyIngested = detail.messages.filter(
    (raw) => newMessageIds.has(raw.id),
  );
  if (newlyIngested.length > 0) {
    fanoutNewGmailMessages({
      accountId,
      gmailThreadId,
      rawMessages: newlyIngested,
    });
  }

  const labels = Array.from(allLabels);
  const hasNewContent = newlyIngested.length > 0;
  const shouldExtract = threadHasInboxLabel(labels) && (!isProcessed || hasNewContent);
  if (shouldExtract && hasNewContent) {
    await markThreadUnprocessed(dbThreadId);
  }

  return {
    dbThreadId,
    subject,
    messages,
    shouldExtract,
  };
}

// ---------------------------------------------------------------------------
// Config from env
// ---------------------------------------------------------------------------

const FETCH_CONCURRENCY = env.GMAIL_SYNC_CONCURRENCY;

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

const MAX_CIRCUIT_BACKOFF_SEC = 600;

export class GmailSyncOrchestrator {
  private fetchQueue: AsyncQueuer<FetchItem>;
  private circuitState: CircuitState = "closed";
  private rateLimitStreak = 0;
  private cancelled = false;
  private progress: SyncProgress;
  private accountId: string;
  private token: string;
  private initialProfile: GmailProfile | null;
  private extractableGmailThreadIds = new Set<string>();

  constructor(
    accountId: string,
    token: string,
    initialProfile: GmailProfile | null = null,
  ) {
    this.accountId = accountId;
    this.token = token;
    this.initialProfile = initialProfile;

    this.progress = {
      status: "idle",
      mode: null,
      totalThreads: 0,
      fetchedThreads: 0,
      processableThreads: 0,
      processedThreads: 0,
      failedThreads: 0,
      startedAt: null,
      error: null,
    };

    this.fetchQueue = new AsyncQueuer<FetchItem>(
      async (item) => this.fetchThread(item),
      {
        concurrency: FETCH_CONCURRENCY,
        started: false,
        throwOnError: false,
        onError: (error, item) => this.handleFetchError(error, item),
        onSuccess: (_result, item) => this.handleFetchSuccess(item.gmailThreadId),
      },
    );
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

      this.fetchQueue.start();

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
    this.fetchQueue.clear();
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
    this.progress.processableThreads =
      plan.bootstrapProgress?.processableThreads ?? 0;
    this.progress.processedThreads =
      plan.bootstrapProgress?.processedThreads ?? 0;
    this.progress.failedThreads = plan.bootstrapProgress?.failedThreads ?? 0;
    this.cancelled = false;
    this.rateLimitStreak = 0;
    this.circuitState = "closed";
    this.extractableGmailThreadIds.clear();

    await this.persistFetchState({
      completedAt: null,
      lastError: null,
      status: "running",
    });
  }

  private async resolveThreadIdsForPlan(
    plan: SyncExecutionPlan,
  ): Promise<SyncThreadResolution> {
    return this.resolveThreadIdsForMode(plan.scopeStrategy);
  }

  private async resolveThreadIdsForMode(mode: SyncMode): Promise<{
    completedMode: SyncMode;
    finalHistoryId: string;
    threadIds: string[];
  }> {
    let completedMode: SyncMode = mode;
    const profile = this.initialProfile ?? await getProfile(this.token);
    this.initialProfile = null;
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
    return this.buildSyncScope(
      resolution.threadIds,
      0,
      resolution.completedMode ?? plan.mode,
    );
  }

  private async buildSyncScope(
    threadIds: string[],
    failedThreads: number,
    mode: SyncMode,
  ): Promise<SyncScope> {
    if (mode === "incremental") {
      const {
        fetchedInScope,
        processableThreads,
        processedThreads,
        toFetch,
        totalThreads,
      } = getScopedSyncResumeState(
        threadIds,
        new Set<string>(),
        new Set<string>(),
        [],
        mode,
      );

      return {
        failedThreads,
        fetchedThreads: fetchedInScope.size,
        processableThreads,
        processedThreads,
        toFetch,
        totalThreads,
      };
    }

    const alreadyFetched = await getFetchedGmailThreadIds(this.accountId);
    const alreadyFetchedInbox = await getFetchedInboxGmailThreadIds(
      this.accountId,
    );
    const unprocessed = await getUnprocessedInboxGmailThreadIds(this.accountId);
    const {
      fetchedInScope,
      processableThreads,
      processedThreads,
      toFetch,
      totalThreads,
    } = getScopedSyncResumeState(
      threadIds,
      alreadyFetched,
      alreadyFetchedInbox,
      unprocessed,
      mode,
    );

    return {
      failedThreads,
      fetchedThreads: fetchedInScope.size,
      processableThreads,
      processedThreads,
      toFetch,
      totalThreads,
    };
  }

  private async setRunningScope(scope: ProgressSnapshot): Promise<void> {
    this.progress.totalThreads = scope.totalThreads;
    this.progress.fetchedThreads = scope.fetchedThreads;
    this.progress.processableThreads = scope.processableThreads;
    this.progress.processedThreads = scope.processedThreads;
    this.progress.failedThreads = scope.failedThreads;

    await this.persistFetchState({
      completedAt: null,
      lastError: null,
      status: "running",
    });
  }

  private async finishSuccessfulSync(
    plan: SyncExecutionPlan,
    resolution: Pick<SyncThreadResolution, "completedMode" | "finalHistoryId">,
  ): Promise<void> {
    if (this.progress.failedThreads > 0) {
      throw new Error(
        `Gmail sync skipped ${this.progress.failedThreads} thread(s); not advancing checkpoint`,
      );
    }

    if (plan.updatesAccountCheckpoint) {
      if (!resolution.completedMode || !resolution.finalHistoryId) {
        throw new Error("Missing Gmail sync checkpoint for completed sync");
      }

      await updateGmailAccountHistoryId(this.accountId, resolution.finalHistoryId);
      await updateGmailAccountSyncTimestamp(this.accountId, resolution.completedMode);
    }

    await this.syncDrafts();
    await this.markCompleted();

    if (
      resolution.completedMode === "incremental"
      && this.extractableGmailThreadIds.size > 0
    ) {
      runScopedGmailExtraction(
        this.accountId,
        [...this.extractableGmailThreadIds],
      );
    }
  }

  private async syncDrafts(): Promise<void> {
    try {
      const mappings = await listAllDraftMappings(this.token);
      await syncAccountDraftIds(this.accountId, mappings);
    } catch (err) {
      console.error("[gmail-sync] Failed to sync draft mappings:", err);
    }
  }

  private async persistFetchState(
    overrides: FetchStateWrite = {},
  ): Promise<void> {
    if (!this.progress.mode) {
      throw new Error("Cannot persist Gmail fetch state without a sync mode");
    }
    await upsertFetchState(this.accountId, this.progress.mode, {
      status: this.progress.status,
      totalThreads: this.progress.totalThreads,
      fetchedThreads: this.progress.fetchedThreads,
      failedThreads: this.progress.failedThreads,
      lastError: this.progress.error,
      ...(this.progress.startedAt ? { startedAt: this.progress.startedAt } : {}),
      ...overrides,
    });
  }

  private async markCompleted(): Promise<void> {
    this.progress.status = "completed";
    this.progress.error = null;
    await this.persistFetchState({
      completedAt: new Date().toISOString(),
      lastError: null,
      status: "completed",
    });
  }

  private async markPaused(): Promise<void> {
    this.progress.status = "paused";
    this.progress.error = null;
    await this.persistFetchState({
      completedAt: null,
      lastError: null,
      status: "paused",
    });
  }

  private async markErrored(message: string): Promise<void> {
    this.progress.status = "error";
    this.progress.error = message;
    await this.persistFetchState({
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

  private bumpProgress(
    field:
      | "fetchedThreads"
      | "processableThreads"
      | "processedThreads"
      | "failedThreads",
    amount = 1,
  ): void {
    this.progress[field] = Math.max(0, this.progress[field] + amount);
    if (field !== "fetchedThreads" && field !== "failedThreads") return;
    if (!this.progress.mode) return;
    incrementFetchProgress(this.accountId, this.progress.mode, field, amount)
      .catch((error) => {
        console.error(
          `[gmail-sync] Failed to persist ${field} progress for account ${this.accountId}:`,
          error,
        );
      });
  }

  private handleFetchSuccess(gmailThreadId: string): void {
    this.rateLimitStreak = 0;
    resolveFailuresForThread(this.accountId, gmailThreadId).catch((error) => {
      console.error("[gmail-sync] Failed to resolve fetch failure:", error);
    });
    this.bumpProgress("fetchedThreads");
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

    const { shouldExtract } = await upsertRemoteGmailThread(
      this.accountId,
      this.token,
      item.gmailThreadId,
    );

    if (!shouldExtract) return;

    this.extractableGmailThreadIds.add(item.gmailThreadId);
    this.bumpProgress("processableThreads");
  }

  private handleFetchError(error: Error, item: FetchItem): void {
    if (this.cancelled) return;

    if (error instanceof GmailApiError && error.isRateLimit) {
      this.openCircuit(error.retryAfter ?? 60, error.retryAfter !== undefined);
      // Re-enqueue
      this.fetchQueue.addItem(item);
      return;
    }

    recordSyncFailure(this.accountId, {
      gmailThreadId: item.gmailThreadId,
      stage: "fetch",
      errorMessage: error instanceof Error ? error.message : String(error),
      errorCode: error instanceof GmailApiError
        ? error.reason ?? String(error.status)
        : undefined,
    }).catch((err) => {
      console.error("[gmail-sync] Failed to record fetch failure:", err);
    });
    this.bumpProgress("failedThreads");
    console.error(
      `[gmail-sync] Fetch skipped for ${item.gmailThreadId}:`,
      error instanceof Error ? error.message : error,
    );
  }

  // ----- Internal: Circuit Breaker -----

  private openCircuit(retryAfterSec: number, exactRetryAfter = false): void {
    if (this.circuitState === "open") return;
    this.circuitState = "open";
    this.rateLimitStreak += 1;

    const backoffSec = exactRetryAfter
      ? retryAfterSec
      : Math.min(
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
    // Poll until the fetch queue is idle.
    while (!this.cancelled) {
      const fetchState = this.fetchQueue.store.state;

      const fetchDone =
        fetchState.items.length === 0 && fetchState.activeItems.length === 0;

      if (fetchDone) break;
      await sleep(500);
    }
  }
}

// ---------------------------------------------------------------------------
// Sync manager — module-level singleton map
// ---------------------------------------------------------------------------

const activeSyncs = new Map<string, GmailSyncOrchestrator>();
const syncFinishedHandlers = new Map<string, () => void | Promise<void>>();

export function runAfterActiveGmailSync(
  accountId: string,
  handler: () => void | Promise<void>,
): boolean {
  if (!activeSyncs.has(accountId)) return false;
  syncFinishedHandlers.set(accountId, handler);
  return true;
}

function notifyGmailSyncFinished(accountId: string): void {
  const handler = syncFinishedHandlers.get(accountId);
  if (!handler) return;
  syncFinishedHandlers.delete(accountId);
  Promise.resolve(handler()).catch((error) => {
    console.error("[gmail-sync] Sync finished handler failed:", error);
  });
}

export async function startSync(
  accountId: string,
  token: string,
  intent: SyncStartIntent,
  initialProfile: GmailProfile | null = null,
): Promise<{ started: boolean; orchestrator: GmailSyncOrchestrator }> {
  const existing = activeSyncs.get(accountId);
  if (existing) {
    if (intent === "push") {
      return { started: true, orchestrator: existing };
    }
    throw new Error("Sync already in progress for this account");
  }

  const plan = await resolveSyncExecutionPlan(accountId, intent);
  const orch = new GmailSyncOrchestrator(accountId, token, initialProfile);
  if (!plan) {
    return { started: false, orchestrator: orch };
  }

  activeSyncs.set(accountId, orch);

  try {
    void orch.startSync(plan).finally(() => {
      const current = activeSyncs.get(accountId);
      if (current === orch) {
        activeSyncs.delete(accountId);
        notifyGmailSyncFinished(accountId);
      }
    });
    return { started: true, orchestrator: orch };
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

  const states = await listFetchStates(accountId);
  const activeState = states.find((state) =>
    state.status === "running"
    || state.status === "paused"
    || state.status === "interrupted"
  );
  if (activeState?.mode === "full" || activeState?.mode === "incremental") {
    await upsertFetchState(accountId, activeState.mode, {
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
    const stuck = await getRunningFetchStates();
    if (stuck.length === 0) return;
    for (const state of stuck) {
      if (state.mode !== "full" && state.mode !== "incremental") continue;
      await upsertFetchState(state.accountId, state.mode, {
        status: "interrupted",
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
