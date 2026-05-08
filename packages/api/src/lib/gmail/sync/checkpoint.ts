/**
 * Tombstone-aware sync checkpoint.
 *
 * Runs once per successful sync — advances the account's historyId / mode
 * timestamps, applies any history tombstones, and reconciles the draft-id
 * mapping with Gmail.
 */

import {
  deleteMessagesByGmailIds,
  syncAccountDraftIds,
  updateGmailAccountHistoryId,
  updateGmailAccountSyncTimestamp,
} from "@g-spot/db/gmail";

import { listAllDraftMappings } from "../api";
import type { SyncExecutionPlan } from "./plan";
import type { SyncThreadResolution } from "./history";

export interface CheckpointInput {
  accountId: string;
  token: string;
  plan: SyncExecutionPlan;
  resolution: Pick<SyncThreadResolution, "completedMode" | "finalHistoryId" | "deletedMessageIds">;
  failedThreads: number;
}

export async function applyCheckpoint(input: CheckpointInput): Promise<void> {
  const { accountId, token, plan, resolution, failedThreads } = input;

  if (failedThreads > 0) {
    throw new Error(
      `Gmail sync skipped ${failedThreads} thread(s); not advancing checkpoint`,
    );
  }

  if (plan.updatesAccountCheckpoint) {
    if (!resolution.completedMode || !resolution.finalHistoryId) {
      throw new Error("Missing Gmail sync checkpoint for completed sync");
    }
    await updateGmailAccountHistoryId(accountId, resolution.finalHistoryId);
    await updateGmailAccountSyncTimestamp(accountId, resolution.completedMode);
  }

  if (resolution.deletedMessageIds.length > 0) {
    await deleteMessagesByGmailIds(accountId, resolution.deletedMessageIds);
  }

  try {
    const mappings = await listAllDraftMappings(token);
    await syncAccountDraftIds(accountId, mappings);
  } catch (err) {
    console.error("[gmail-sync] Failed to sync draft mappings:", err);
  }
}
