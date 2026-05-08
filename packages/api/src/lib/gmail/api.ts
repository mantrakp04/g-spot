/**
 * High-level Gmail REST endpoint wrappers.
 *
 * Every call here routes through `gmailFetch` so the rate limiter and error
 * surface are uniform. No raw `fetch` from outside this module.
 */

import {
  GMAIL_API,
  gmailFetch,
  gmailFetchNoContent,
  gmailPost,
  gmailUrl,
} from "./client";
import { GmailApiError } from "./errors";
import type {
  GmailApiLabel,
  GmailApiMessage,
  GmailApiThread,
} from "./parse";

export async function getProfile(
  token: string,
): Promise<{ emailAddress: string; historyId: string }> {
  return gmailFetch(`${GMAIL_API}/profile`, token);
}

export async function getThreadDetail(
  token: string,
  threadId: string,
): Promise<GmailApiThread> {
  return gmailFetch<GmailApiThread>(
    gmailUrl(`threads/${encodeURIComponent(threadId)}?format=full`),
    token,
  );
}

export async function getMessage(
  token: string,
  messageId: string,
): Promise<GmailApiMessage> {
  return gmailFetch<GmailApiMessage>(
    gmailUrl(`messages/${encodeURIComponent(messageId)}?format=full`),
    token,
  );
}

export async function listLabels(token: string): Promise<GmailApiLabel[]> {
  const data = await gmailFetch<{ labels?: GmailApiLabel[] }>(
    gmailUrl("labels"),
    token,
  );
  return data.labels ?? [];
}

/**
 * Stream a thread-id listing one page at a time. Caller decides how to
 * consume, so we can enqueue work concurrently with paging instead of
 * blocking until every id is in memory.
 */
export async function* streamThreadIds(
  token: string,
  query?: string,
): AsyncGenerator<string[], void, void> {
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ maxResults: "500" });
    if (query) params.set("q", query);
    if (pageToken) params.set("pageToken", pageToken);
    const data = await gmailFetch<{
      threads?: Array<{ id: string }>;
      nextPageToken?: string;
    }>(gmailUrl(`threads?${params.toString()}`), token);
    yield (data.threads ?? []).map((t) => t.id);
    pageToken = data.nextPageToken;
  } while (pageToken);
}

export async function listAllDraftMappings(
  token: string,
): Promise<Array<{ draftId: string; gmailMessageId: string }>> {
  const mappings: Array<{ draftId: string; gmailMessageId: string }> = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ maxResults: "500" });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await gmailFetch<{
      drafts?: Array<{ id: string; message: { id: string; threadId: string } }>;
      nextPageToken?: string;
    }>(gmailUrl(`drafts?${params.toString()}`), token);
    for (const d of data.drafts ?? []) {
      mappings.push({ draftId: d.id, gmailMessageId: d.message.id });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return mappings;
}

export interface HistoryDelta {
  threadIds: string[];
  perThreadAddedLabels: Map<string, Set<string>>;
  perThreadRemovedLabels: Map<string, Set<string>>;
  deletedMessageIds: string[];
  newHistoryId: string;
  expired: boolean;
}

/**
 * Walk Gmail's history feed. We ask only for the history types we model so
 * Gmail can skip irrelevant entries.
 */
export async function getHistory(
  token: string,
  startHistoryId: string,
): Promise<HistoryDelta> {
  const threadIds = new Set<string>();
  const perThreadAddedLabels = new Map<string, Set<string>>();
  const perThreadRemovedLabels = new Map<string, Set<string>>();
  const deletedMessageIds: string[] = [];
  let pageToken: string | undefined;
  let newHistoryId = startHistoryId;

  const addToMap = (
    map: Map<string, Set<string>>,
    threadId: string,
    labels: string[] | undefined,
  ) => {
    if (!labels?.length) return;
    let set = map.get(threadId);
    if (!set) {
      set = new Set<string>();
      map.set(threadId, set);
    }
    for (const l of labels) set.add(l);
  };

  try {
    do {
      const params = new URLSearchParams({
        startHistoryId,
        maxResults: "500",
        // Cuts traffic and skips entries we don't care about.
        historyTypes: "messageAdded",
      });
      params.append("historyTypes", "messageDeleted");
      params.append("historyTypes", "labelAdded");
      params.append("historyTypes", "labelRemoved");
      if (pageToken) params.set("pageToken", pageToken);

      const data = await gmailFetch<{
        history?: Array<{
          messages?: Array<{ id: string; threadId: string }>;
          messagesAdded?: Array<{ message: { id: string; threadId: string } }>;
          messagesDeleted?: Array<{ message: { id: string; threadId: string } }>;
          labelsAdded?: Array<{
            message: { id: string; threadId: string };
            labelIds?: string[];
          }>;
          labelsRemoved?: Array<{
            message: { id: string; threadId: string };
            labelIds?: string[];
          }>;
        }>;
        historyId?: string;
        nextPageToken?: string;
      }>(gmailUrl(`history?${params.toString()}`), token);

      if (data.historyId) newHistoryId = data.historyId;

      for (const entry of data.history ?? []) {
        for (const m of entry.messages ?? []) threadIds.add(m.threadId);
        for (const m of entry.messagesAdded ?? []) {
          threadIds.add(m.message.threadId);
        }
        for (const m of entry.messagesDeleted ?? []) {
          threadIds.add(m.message.threadId);
          deletedMessageIds.push(m.message.id);
        }
        for (const m of entry.labelsAdded ?? []) {
          threadIds.add(m.message.threadId);
          addToMap(perThreadAddedLabels, m.message.threadId, m.labelIds);
        }
        for (const m of entry.labelsRemoved ?? []) {
          threadIds.add(m.message.threadId);
          addToMap(perThreadRemovedLabels, m.message.threadId, m.labelIds);
        }
      }

      pageToken = data.nextPageToken;
    } while (pageToken);
  } catch (err) {
    if (err instanceof GmailApiError && err.isNotFound) {
      return {
        threadIds: [],
        perThreadAddedLabels: new Map(),
        perThreadRemovedLabels: new Map(),
        deletedMessageIds: [],
        newHistoryId: startHistoryId,
        expired: true,
      };
    }
    throw err;
  }

  return {
    threadIds: Array.from(threadIds),
    perThreadAddedLabels,
    perThreadRemovedLabels,
    deletedMessageIds,
    newHistoryId,
    expired: false,
  };
}

export async function watchMailbox(
  token: string,
  input: {
    topicName: string;
    labelIds?: string[];
    labelFilterBehavior?: "include" | "exclude";
  },
): Promise<{ historyId: string; expiration: string }> {
  return gmailPost(gmailUrl("watch"), token, {
    topicName: input.topicName,
    ...(input.labelIds?.length ? { labelIds: input.labelIds } : {}),
    ...(input.labelFilterBehavior
      ? { labelFilterBehavior: input.labelFilterBehavior }
      : {}),
  });
}

export async function stopWatchMailbox(token: string): Promise<void> {
  return gmailFetchNoContent(gmailUrl("stop"), token, { method: "POST" });
}

export async function modifyThreadLabels(
  token: string,
  threadId: string,
  addLabelIds?: string[],
  removeLabelIds?: string[],
): Promise<void> {
  return gmailFetchNoContent(
    gmailUrl(`threads/${encodeURIComponent(threadId)}/modify`),
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(addLabelIds?.length ? { addLabelIds } : {}),
        ...(removeLabelIds?.length ? { removeLabelIds } : {}),
      }),
    },
  );
}

export async function trashThread(token: string, threadId: string): Promise<void> {
  return gmailFetchNoContent(
    gmailUrl(`threads/${encodeURIComponent(threadId)}/trash`),
    token,
    { method: "POST" },
  );
}

export interface DraftResource {
  id: string;
  message: { id: string; threadId: string; labelIds?: string[] };
}

export async function createDraft(
  token: string,
  raw: string,
  threadId?: string,
): Promise<DraftResource> {
  return gmailPost<DraftResource>(gmailUrl("drafts"), token, {
    message: { raw, ...(threadId ? { threadId } : {}) },
  });
}

export async function updateDraft(
  token: string,
  draftId: string,
  raw: string,
  threadId?: string,
): Promise<DraftResource> {
  return gmailFetch<DraftResource>(
    gmailUrl(`drafts/${encodeURIComponent(draftId)}`),
    token,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: { raw, ...(threadId ? { threadId } : {}) },
      }),
    },
  );
}

export async function deleteDraft(token: string, draftId: string): Promise<void> {
  return gmailFetchNoContent(
    gmailUrl(`drafts/${encodeURIComponent(draftId)}`),
    token,
    { method: "DELETE" },
  );
}

export async function sendDraft(
  token: string,
  draftId: string,
): Promise<{ id: string; threadId: string }> {
  return gmailPost(gmailUrl("drafts/send"), token, { id: draftId });
}

export async function sendMessage(
  token: string,
  raw: string,
  threadId?: string,
): Promise<{ id: string; threadId: string }> {
  return gmailPost(gmailUrl("messages/send"), token, {
    raw,
    ...(threadId ? { threadId } : {}),
  });
}

export async function fetchComposeDraftId(
  token: string,
  gmailMessageId: string,
): Promise<string | null> {
  try {
    const params = new URLSearchParams();
    params.set("q", `rfc822msgid:${gmailMessageId}`);
    const data = await gmailFetch<{
      drafts?: Array<{ id: string; message: { id: string } }>;
    }>(gmailUrl(`drafts?${params.toString()}`), token);
    for (const d of data.drafts ?? []) {
      if (d.message.id === gmailMessageId) return d.id;
    }
    return null;
  } catch (err) {
    if (err instanceof GmailApiError && err.isNotFound) return null;
    throw err;
  }
}
