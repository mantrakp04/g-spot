/**
 * Plan resolution for Gmail sync.
 *
 * Pure decision logic: "given the user's intent and the current account /
 * fetch-state row, what should we do?" — separate from the orchestrator so it
 * can be unit-tested without touching the network or DB.
 */

import {
  getFetchState,
  getGmailAccountById,
  listFetchStates,
} from "@g-spot/db/gmail";

export const syncModes = ["full", "incremental"] as const;
export type SyncMode = (typeof syncModes)[number];
export const syncStartIntents = [
  ...syncModes,
  "auto",
  "push",
  "resume",
] as const;
export type SyncStartIntent = (typeof syncStartIntents)[number];

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

export type ProgressSnapshot = Pick<
  SyncProgress,
  | "totalThreads"
  | "fetchedThreads"
  | "processableThreads"
  | "processedThreads"
  | "failedThreads"
>;

export type SyncExecutionPlan = {
  bootstrapProgress: ProgressSnapshot | null;
  intent: SyncStartIntent;
  mode: SyncMode;
  scopeStrategy: SyncMode;
  updatesAccountCheckpoint: boolean;
};

export type SyncStartPlanAccount = Pick<
  NonNullable<Awaited<ReturnType<typeof getGmailAccountById>>>,
  "lastFullSyncAt" | "lastIncrementalSyncAt" | "needsFullResync"
>;

export type SyncStartPlanState = Pick<
  NonNullable<Awaited<ReturnType<typeof getFetchState>>>,
  "fetchedThreads" | "mode" | "status" | "totalThreads"
>;

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

export async function resolveSyncExecutionPlan(
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

/**
 * Compute the resume state for a sync run.
 *
 * Incremental sync receives only threads that *changed* since the last
 * historyId (e.g. label flips like UNREAD removed). Every one of those is
 * dirty and must be re-fetched even if it's already in the DB — otherwise
 * label/read-state changes never land locally. Full sync keeps the dedupe
 * so a resumed run doesn't re-download the whole mailbox.
 */
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
