/**
 * Per-thread fetch and DB upsert.
 *
 * One canonical "ingest a thread" function:
 *   - GET threads/{id}?format=full
 *   - parseGmailMessage / parseAttachments
 *   - upsertThread / upsertMessages / upsertAttachments
 *   - tombstone messages no longer present in the remote thread
 *   - fan out new messages to chat-sdk
 *   - decide whether the thread should enter the extraction queue
 */

import {
  deleteMissingThreadMessages,
  deleteThreadByGmailId,
  markThreadUnprocessed,
  upsertAttachments,
  upsertMessages,
  upsertThread,
} from "@g-spot/db/gmail";

import { getThreadDetail } from "../api";
import { GmailApiError } from "../errors";
import { parseAttachments, parseGmailMessage } from "../parse";
import type { ParsedMessage } from "../parse";
import { fanoutNewGmailMessages } from "../fanout";

const GMAIL_INBOX_LABEL = "INBOX";

export function threadHasInboxLabel(labels: readonly string[]): boolean {
  return labels.includes(GMAIL_INBOX_LABEL);
}

export interface ThreadIngestResult {
  status: "ingested" | "deleted";
  dbThreadId: string | null;
  subject: string;
  messages: ParsedMessage[];
  shouldExtract: boolean;
}

export async function fetchAndUpsertThread(
  accountId: string,
  token: string,
  gmailThreadId: string,
): Promise<ThreadIngestResult> {
  let detail;
  try {
    detail = await getThreadDetail(token, gmailThreadId);
  } catch (err) {
    if (err instanceof GmailApiError && err.isNotFound) {
      // Thread was hard-deleted on Gmail's side. Drop it locally.
      await deleteThreadByGmailId(accountId, gmailThreadId);
      return {
        status: "deleted",
        dbThreadId: null,
        subject: "",
        messages: [],
        shouldExtract: false,
      };
    }
    throw err;
  }

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
    status: "ingested",
    dbThreadId,
    subject,
    messages,
    shouldExtract,
  };
}
