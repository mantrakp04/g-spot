import { and, asc, eq, inArray, notInArray, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "../index";
import { gmailMessageLabels, gmailMessages } from "../schema";
import type { GmailMessageRow } from "../schema/gmail";

export type UpsertedGmailMessage = {
  id: string;
  gmailMessageId: string;
  isNew: boolean;
};

export interface MessageUpsertInput {
  gmailMessageId: string;
  gmailThreadId: string;
  fromName: string;
  fromEmail: string;
  toHeader: string;
  ccHeader: string;
  subject: string;
  date: string;
  bodyHtml: string | null;
  bodyText: string | null;
  snippet: string;
  labels: string[];
  messageIdHeader: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  isDraft: boolean;
  historyId: string | null;
  rawSizeEstimate: number | null;
}

async function syncMessageLabels(
  accountId: string,
  messageId: string,
  labels: string[],
): Promise<void> {
  const existingRows = await db
    .select({ label: gmailMessageLabels.label })
    .from(gmailMessageLabels)
    .where(eq(gmailMessageLabels.messageId, messageId));
  const existing = new Set(existingRows.map((r) => r.label));
  const incoming = new Set(labels);

  const toAdd = labels.filter((l) => !existing.has(l));
  const toRemove = [...existing].filter((l) => !incoming.has(l));

  if (toRemove.length > 0) {
    await db
      .delete(gmailMessageLabels)
      .where(
        and(
          eq(gmailMessageLabels.messageId, messageId),
          inArray(gmailMessageLabels.label, toRemove),
        ),
      );
  }
  if (toAdd.length > 0) {
    await db.insert(gmailMessageLabels).values(
      toAdd.map((label) => ({ accountId, messageId, label })),
    );
  }
}

/**
 * Upsert a batch of messages. Single bulk INSERT...ON CONFLICT DO UPDATE for
 * the message rows themselves, then a per-message label set sync (small, and
 * gives us a precise diff against the existing set).
 */
export async function upsertMessages(
  threadId: string,
  accountId: string,
  messages: MessageUpsertInput[],
): Promise<UpsertedGmailMessage[]> {
  if (messages.length === 0) return [];

  const valuesWithIds = messages.map((msg) => ({
    id: nanoid(),
    threadId,
    accountId,
    gmailMessageId: msg.gmailMessageId,
    gmailThreadId: msg.gmailThreadId,
    fromName: msg.fromName,
    fromEmail: msg.fromEmail,
    toHeader: msg.toHeader,
    ccHeader: msg.ccHeader,
    subject: msg.subject,
    date: msg.date,
    bodyHtml: msg.bodyHtml,
    bodyText: msg.bodyText,
    snippet: msg.snippet,
    messageIdHeader: msg.messageIdHeader,
    inReplyTo: msg.inReplyTo,
    referencesHeader: msg.referencesHeader,
    isDraft: msg.isDraft,
    historyId: msg.historyId,
    rawSizeEstimate: msg.rawSizeEstimate,
  }));

  const inserted = await db
    .insert(gmailMessages)
    .values(valuesWithIds)
    .onConflictDoUpdate({
      target: [gmailMessages.accountId, gmailMessages.gmailMessageId],
      set: {
        fromName: sql`excluded.from_name`,
        fromEmail: sql`excluded.from_email`,
        toHeader: sql`excluded.to_header`,
        ccHeader: sql`excluded.cc_header`,
        subject: sql`excluded.subject`,
        date: sql`excluded.date`,
        bodyHtml: sql`excluded.body_html`,
        bodyText: sql`excluded.body_text`,
        snippet: sql`excluded.snippet`,
        messageIdHeader: sql`excluded.message_id_header`,
        inReplyTo: sql`excluded.in_reply_to`,
        referencesHeader: sql`excluded.references_header`,
        isDraft: sql`excluded.is_draft`,
        historyId: sql`excluded.history_id`,
        rawSizeEstimate: sql`excluded.raw_size_estimate`,
      },
    })
    .returning({
      id: gmailMessages.id,
      gmailMessageId: gmailMessages.gmailMessageId,
    });

  const idByGmail = new Map(
    inserted.map((row) => [row.gmailMessageId, row.id]),
  );
  const proposedIdByGmail = new Map(
    valuesWithIds.map((row) => [row.gmailMessageId, row.id]),
  );

  const results: UpsertedGmailMessage[] = [];
  for (const msg of messages) {
    const id = idByGmail.get(msg.gmailMessageId);
    if (!id) continue;
    const isNew = proposedIdByGmail.get(msg.gmailMessageId) === id;
    await syncMessageLabels(accountId, id, msg.labels);
    results.push({ id, gmailMessageId: msg.gmailMessageId, isNew });
  }
  return results;
}

export async function getThreadMessages(
  threadId: string,
): Promise<GmailMessageRow[]> {
  return db
    .select()
    .from(gmailMessages)
    .where(eq(gmailMessages.threadId, threadId))
    .orderBy(asc(gmailMessages.date));
}

export async function listMessagesByThreadIds(
  threadIds: string[],
): Promise<GmailMessageRow[]> {
  if (threadIds.length === 0) return [];

  return db
    .select()
    .from(gmailMessages)
    .where(inArray(gmailMessages.threadId, threadIds))
    .orderBy(asc(gmailMessages.date));
}

export async function deleteMissingThreadMessages(
  threadId: string,
  gmailMessageIds: string[],
): Promise<void> {
  if (gmailMessageIds.length === 0) {
    await db.delete(gmailMessages).where(eq(gmailMessages.threadId, threadId));
    return;
  }

  await db
    .delete(gmailMessages)
    .where(
      and(
        eq(gmailMessages.threadId, threadId),
        notInArray(gmailMessages.gmailMessageId, gmailMessageIds),
      ),
    );
}

export async function deleteMessagesByGmailIds(
  accountId: string,
  gmailMessageIds: string[],
): Promise<void> {
  if (gmailMessageIds.length === 0) return;
  await db
    .delete(gmailMessages)
    .where(
      and(
        eq(gmailMessages.accountId, accountId),
        inArray(gmailMessages.gmailMessageId, gmailMessageIds),
      ),
    );
}

export async function getMessageLabels(messageId: string): Promise<string[]> {
  const rows = await db
    .select({ label: gmailMessageLabels.label })
    .from(gmailMessageLabels)
    .where(eq(gmailMessageLabels.messageId, messageId));
  return rows.map((r) => r.label);
}

export async function getMessageLabelsByIds(
  messageIds: string[],
): Promise<Map<string, string[]>> {
  if (messageIds.length === 0) return new Map();
  const map = new Map<string, string[]>();
  const CHUNK = 500;
  for (let i = 0; i < messageIds.length; i += CHUNK) {
    const chunk = messageIds.slice(i, i + CHUNK);
    const rows = await db
      .select({
        messageId: gmailMessageLabels.messageId,
        label: gmailMessageLabels.label,
      })
      .from(gmailMessageLabels)
      .where(inArray(gmailMessageLabels.messageId, chunk));
    for (const row of rows) {
      const arr = map.get(row.messageId);
      if (arr) arr.push(row.label);
      else map.set(row.messageId, [row.label]);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Drafts (compose mappings live on gmail_messages)
// ---------------------------------------------------------------------------

export async function syncAccountDraftIds(
  accountId: string,
  mappings: Array<{ draftId: string; gmailMessageId: string }>,
): Promise<void> {
  await db
    .update(gmailMessages)
    .set({ gmailDraftId: null })
    .where(eq(gmailMessages.accountId, accountId));

  for (const m of mappings) {
    await db
      .update(gmailMessages)
      .set({ gmailDraftId: m.draftId })
      .where(
        and(
          eq(gmailMessages.accountId, accountId),
          eq(gmailMessages.gmailMessageId, m.gmailMessageId),
        ),
      );
  }
}

export async function getThreadDrafts(
  accountId: string,
  gmailThreadId: string,
  gmailMessageIds: string[] = [],
): Promise<Array<{ draftId: string; messageId: string; threadId: string }>> {
  const matchClauses: SQL[] = [eq(gmailMessages.gmailThreadId, gmailThreadId)];
  if (gmailMessageIds.length > 0) {
    matchClauses.push(inArray(gmailMessages.gmailMessageId, gmailMessageIds));
  }

  const rows = await db
    .select({
      draftId: gmailMessages.gmailDraftId,
      gmailMessageId: gmailMessages.gmailMessageId,
      gmailThreadId: gmailMessages.gmailThreadId,
    })
    .from(gmailMessages)
    .where(
      and(
        eq(gmailMessages.accountId, accountId),
        sql`${gmailMessages.gmailDraftId} IS NOT NULL`,
        or(...matchClauses),
      ),
    );

  return rows
    .filter((r): r is typeof r & { draftId: string } => r.draftId != null)
    .map((r) => ({
      draftId: r.draftId,
      messageId: r.gmailMessageId,
      threadId: r.gmailThreadId,
    }));
}
