/**
 * Gmail sync manager — module-level singleton map per account.
 *
 * Holds at most one orchestrator per accountId and offers a registration hook
 * (`runAfterActiveGmailSync`) for callers that want to re-trigger work once
 * the in-flight sync completes.
 */

import {
  getRunningFetchStates,
  listFetchStates,
  upsertFetchState,
} from "@g-spot/db/gmail";

import { getProfile } from "../api";
import { GmailSyncOrchestrator } from "./orchestrator";
import { resolveSyncExecutionPlan } from "./plan";
import type { SyncStartIntent } from "./plan";

export {
  getScopedSyncResumeState,
  resolveSyncStartPlan,
  resolveSyncExecutionPlan,
  syncModes,
  syncStartIntents,
} from "./plan";
export type {
  ProgressSnapshot,
  SyncExecutionPlan,
  SyncMode,
  SyncProgress,
  SyncStartIntent,
  SyncStartPlanAccount,
  SyncStartPlanState,
} from "./plan";
export { resolveThreadIdsForMode } from "./history";
export type { SyncThreadResolution } from "./history";
export { fetchAndUpsertThread, threadHasInboxLabel } from "./full";
export type { ThreadIngestResult } from "./full";
export { applyCheckpoint } from "./checkpoint";
export { GmailSyncOrchestrator } from "./orchestrator";

type GmailProfile = Awaited<ReturnType<typeof getProfile>>;

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

  void orch.startSync(plan).finally(() => {
    const current = activeSyncs.get(accountId);
    if (current === orch) {
      activeSyncs.delete(accountId);
      notifyGmailSyncFinished(accountId);
    }
  });
  return { started: true, orchestrator: orch };
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
 * Mark stuck "running" syncs from a previous server process as
 * "interrupted". Called once at module load.
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
