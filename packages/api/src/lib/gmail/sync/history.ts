/**
 * Resolve the set of threads to fetch for a sync run.
 *
 * - Full sync: stream the entire thread index (no query) so callers can begin
 *   work as the first page lands.
 * - Incremental sync: walk the Gmail history feed from the account's stored
 *   historyId. If Gmail says the cursor is too old (`HistoryNotFound`), mark
 *   the account as needing a full resync and fall through to a full sweep.
 */

import {
  getGmailAccountById,
  setGmailAccountNeedsFullResync,
  syncLabels,
} from "@g-spot/db/gmail";

import { getHistory, getProfile, listLabels, streamThreadIds } from "../api";
import type { SyncMode } from "./plan";

export interface SyncThreadResolution {
  completedMode: SyncMode;
  finalHistoryId: string;
  /** Streaming thread-id pages — caller can enqueue work as ids arrive. */
  threadIdStream: AsyncIterable<string[]>;
  /** Best-effort thread-id materialization (incremental: full set; full: empty). */
  knownThreadIds: string[];
  /** Tombstones from history, applied at sync completion. */
  deletedMessageIds: string[];
  perThreadAddedLabels: Map<string, Set<string>>;
  perThreadRemovedLabels: Map<string, Set<string>>;
}

async function syncRemoteLabels(
  token: string,
  accountId: string,
): Promise<void> {
  const labels = await listLabels(token);
  await syncLabels(
    accountId,
    labels.map((l) => ({
      gmailId: l.id,
      name: l.name,
      type: l.type,
      color: l.color ? JSON.stringify(l.color) : null,
    })),
  );
}

async function* singleArrayStream(ids: string[]): AsyncGenerator<string[], void, void> {
  if (ids.length > 0) yield ids;
}

export async function resolveThreadIdsForMode(
  token: string,
  accountId: string,
  requestedMode: SyncMode,
  initialProfile: { historyId: string } | null = null,
): Promise<SyncThreadResolution> {
  const profile = initialProfile ?? await getProfile(token);
  const finalHistoryId = profile.historyId;

  await syncRemoteLabels(token, accountId);

  if (requestedMode === "full") {
    return {
      completedMode: "full",
      finalHistoryId,
      threadIdStream: streamThreadIds(token),
      knownThreadIds: [],
      deletedMessageIds: [],
      perThreadAddedLabels: new Map(),
      perThreadRemovedLabels: new Map(),
    };
  }

  const account = await getGmailAccountById(accountId);
  const lastHistoryId = account?.historyId;
  if (!lastHistoryId) {
    return {
      completedMode: "full",
      finalHistoryId,
      threadIdStream: streamThreadIds(token),
      knownThreadIds: [],
      deletedMessageIds: [],
      perThreadAddedLabels: new Map(),
      perThreadRemovedLabels: new Map(),
    };
  }

  const history = await getHistory(token, lastHistoryId);
  if (history.expired) {
    await setGmailAccountNeedsFullResync(accountId, true);
    return {
      completedMode: "full",
      finalHistoryId,
      threadIdStream: streamThreadIds(token),
      knownThreadIds: [],
      deletedMessageIds: [],
      perThreadAddedLabels: new Map(),
      perThreadRemovedLabels: new Map(),
    };
  }

  return {
    completedMode: "incremental",
    finalHistoryId: history.newHistoryId,
    threadIdStream: singleArrayStream(history.threadIds),
    knownThreadIds: history.threadIds,
    deletedMessageIds: history.deletedMessageIds,
    perThreadAddedLabels: history.perThreadAddedLabels,
    perThreadRemovedLabels: history.perThreadRemovedLabels,
  };
}
