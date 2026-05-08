import { and, desc, eq, exists, inArray, notInArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "../index";
import { gmailThreadLabels, gmailThreads } from "../schema";
import type { GmailThreadRow } from "../schema/gmail";

const HAS_INBOX_SQL = sql`EXISTS (
  SELECT 1 FROM ${gmailThreadLabels}
  WHERE ${gmailThreadLabels.threadId} = ${gmailThreads.id}
    AND ${gmailThreadLabels.label} = 'INBOX'
)`;

/**
 * Replace the label set for a thread. Computes a diff against the current set
 * and only writes the deletions and insertions needed — keeps the join table
 * minimal and avoids churning unchanged rows.
 */
async function syncThreadLabels(
  accountId: string,
  threadId: string,
  labels: string[],
): Promise<{ added: string[]; removed: string[] }> {
  const existingRows = await db
    .select({ label: gmailThreadLabels.label })
    .from(gmailThreadLabels)
    .where(eq(gmailThreadLabels.threadId, threadId));
  const existing = new Set(existingRows.map((r) => r.label));
  const incoming = new Set(labels);

  const toAdd = labels.filter((l) => !existing.has(l));
  const toRemove = [...existing].filter((l) => !incoming.has(l));

  if (toRemove.length > 0) {
    await db
      .delete(gmailThreadLabels)
      .where(
        and(
          eq(gmailThreadLabels.threadId, threadId),
          inArray(gmailThreadLabels.label, toRemove),
        ),
      );
  }
  if (toAdd.length > 0) {
    await db.insert(gmailThreadLabels).values(
      toAdd.map((label) => ({ accountId, threadId, label })),
    );
  }
  return { added: toAdd, removed: toRemove };
}

export async function upsertThread(
  accountId: string,
  data: {
    gmailThreadId: string;
    subject: string;
    snippet: string;
    lastMessageAt: string;
    messageCount: number;
    labels: string[];
    historyId?: string;
  },
): Promise<{ id: string; isNew: boolean; isProcessed: boolean }> {
  const [existing] = await db
    .select()
    .from(gmailThreads)
    .where(
      and(
        eq(gmailThreads.accountId, accountId),
        eq(gmailThreads.gmailThreadId, data.gmailThreadId),
      ),
    );

  const now = new Date().toISOString();

  if (existing) {
    const wasInboxRow = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(gmailThreadLabels)
      .where(
        and(
          eq(gmailThreadLabels.threadId, existing.id),
          eq(gmailThreadLabels.label, "INBOX"),
        ),
      );
    const wasInbox = (wasInboxRow[0]?.count ?? 0) > 0;
    const isInbox = data.labels.includes("INBOX");
    const isProcessed = isInbox && !wasInbox ? false : existing.isProcessed;

    await db
      .update(gmailThreads)
      .set({
        subject: data.subject,
        snippet: data.snippet,
        lastMessageAt: data.lastMessageAt,
        messageCount: data.messageCount,
        historyId: data.historyId ?? existing.historyId,
        isProcessed,
        updatedAt: now,
      })
      .where(eq(gmailThreads.id, existing.id));
    await syncThreadLabels(accountId, existing.id, data.labels);
    return { id: existing.id, isNew: false, isProcessed };
  }

  const id = nanoid();
  await db.insert(gmailThreads).values({
    id,
    accountId,
    gmailThreadId: data.gmailThreadId,
    subject: data.subject,
    snippet: data.snippet,
    lastMessageAt: data.lastMessageAt,
    messageCount: data.messageCount,
    historyId: data.historyId ?? null,
    createdAt: now,
    updatedAt: now,
  });
  if (data.labels.length > 0) {
    await db.insert(gmailThreadLabels).values(
      data.labels.map((label) => ({ accountId, threadId: id, label })),
    );
  }
  return { id, isNew: true, isProcessed: false };
}

/**
 * Apply a precomputed (added, removed) diff to a thread's label set without
 * re-reading the current state. Used by the history-driven incremental sync.
 */
export async function applyThreadLabelDelta(
  accountId: string,
  threadId: string,
  added: string[],
  removed: string[],
): Promise<void> {
  if (removed.length > 0) {
    await db
      .delete(gmailThreadLabels)
      .where(
        and(
          eq(gmailThreadLabels.threadId, threadId),
          inArray(gmailThreadLabels.label, removed),
        ),
      );
  }
  if (added.length > 0) {
    const values = added.map((label) => ({ accountId, threadId, label }));
    await db
      .insert(gmailThreadLabels)
      .values(values)
      .onConflictDoNothing({
        target: [gmailThreadLabels.threadId, gmailThreadLabels.label],
      });
  }
}

export async function getThreadLabels(threadId: string): Promise<string[]> {
  const rows = await db
    .select({ label: gmailThreadLabels.label })
    .from(gmailThreadLabels)
    .where(eq(gmailThreadLabels.threadId, threadId));
  return rows.map((r) => r.label);
}

export async function getThreadLabelsByIds(
  threadIds: string[],
): Promise<Map<string, string[]>> {
  if (threadIds.length === 0) return new Map();
  const map = new Map<string, string[]>();
  const CHUNK = 500;
  for (let i = 0; i < threadIds.length; i += CHUNK) {
    const chunk = threadIds.slice(i, i + CHUNK);
    const rows = await db
      .select({
        threadId: gmailThreadLabels.threadId,
        label: gmailThreadLabels.label,
      })
      .from(gmailThreadLabels)
      .where(inArray(gmailThreadLabels.threadId, chunk));
    for (const row of rows) {
      const arr = map.get(row.threadId);
      if (arr) arr.push(row.label);
      else map.set(row.threadId, [row.label]);
    }
  }
  return map;
}

export async function getThread(
  accountId: string,
  gmailThreadId: string,
): Promise<GmailThreadRow | null> {
  const [row] = await db
    .select()
    .from(gmailThreads)
    .where(
      and(
        eq(gmailThreads.accountId, accountId),
        eq(gmailThreads.gmailThreadId, gmailThreadId),
      ),
    );
  return row ?? null;
}

export async function markThreadProcessed(threadId: string): Promise<void> {
  await db
    .update(gmailThreads)
    .set({ isProcessed: true, updatedAt: new Date().toISOString() })
    .where(eq(gmailThreads.id, threadId));
}

export async function markThreadUnprocessed(threadId: string): Promise<void> {
  await db
    .update(gmailThreads)
    .set({ isProcessed: false, updatedAt: new Date().toISOString() })
    .where(eq(gmailThreads.id, threadId));
}

export async function getFetchedGmailThreadIds(
  accountId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ gmailThreadId: gmailThreads.gmailThreadId })
    .from(gmailThreads)
    .where(eq(gmailThreads.accountId, accountId));
  return new Set(rows.map((r) => r.gmailThreadId));
}

export async function getUnprocessedInboxGmailThreadIds(
  accountId: string,
): Promise<string[]> {
  const rows = await db
    .select({ gmailThreadId: gmailThreads.gmailThreadId })
    .from(gmailThreads)
    .where(
      and(
        eq(gmailThreads.accountId, accountId),
        eq(gmailThreads.isProcessed, false),
        HAS_INBOX_SQL,
      ),
    );
  return rows.map((r) => r.gmailThreadId);
}

export async function listUnprocessedInboxThreadsBatch(
  accountId: string,
  limit = 100,
  excludeThreadIds: string[] = [],
): Promise<Array<Pick<GmailThreadRow, "id" | "gmailThreadId" | "subject">>> {
  const conditions = [
    eq(gmailThreads.accountId, accountId),
    eq(gmailThreads.isProcessed, false),
    HAS_INBOX_SQL,
  ];
  if (excludeThreadIds.length > 0) {
    conditions.push(notInArray(gmailThreads.id, excludeThreadIds));
  }

  return db
    .select({
      id: gmailThreads.id,
      gmailThreadId: gmailThreads.gmailThreadId,
      subject: gmailThreads.subject,
    })
    .from(gmailThreads)
    .where(and(...conditions))
    .orderBy(desc(gmailThreads.lastMessageAt))
    .limit(limit);
}

export async function listUnprocessedInboxThreadsByGmailIds(
  accountId: string,
  gmailThreadIds: string[],
): Promise<Array<Pick<GmailThreadRow, "id" | "gmailThreadId" | "subject">>> {
  if (gmailThreadIds.length === 0) return [];

  const CHUNK = 500;
  const out: Array<Pick<GmailThreadRow, "id" | "gmailThreadId" | "subject">> = [];
  for (let i = 0; i < gmailThreadIds.length; i += CHUNK) {
    const chunk = gmailThreadIds.slice(i, i + CHUNK);
    const rows = await db
      .select({
        id: gmailThreads.id,
        gmailThreadId: gmailThreads.gmailThreadId,
        subject: gmailThreads.subject,
      })
      .from(gmailThreads)
      .where(
        and(
          eq(gmailThreads.accountId, accountId),
          eq(gmailThreads.isProcessed, false),
          HAS_INBOX_SQL,
          inArray(gmailThreads.gmailThreadId, chunk),
        ),
      );
    out.push(...rows);
  }
  return out;
}

export async function getFetchedInboxGmailThreadIds(
  accountId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ gmailThreadId: gmailThreads.gmailThreadId })
    .from(gmailThreads)
    .where(and(eq(gmailThreads.accountId, accountId), HAS_INBOX_SQL));
  return new Set(rows.map((r) => r.gmailThreadId));
}

export async function getGmailThreadStats(accountId: string): Promise<{
  totalThreads: number;
  inboxThreads: number;
  unprocessedInboxThreads: number;
}> {
  const inboxExpr = exists(
    db
      .select({ one: sql`1` })
      .from(gmailThreadLabels)
      .where(
        and(
          eq(gmailThreadLabels.threadId, gmailThreads.id),
          eq(gmailThreadLabels.label, "INBOX"),
        ),
      ),
  );
  const [row] = await db
    .select({
      totalThreads: sql<number>`count(*)`,
      inboxThreads: sql<number>`sum(case when ${inboxExpr} then 1 else 0 end)`,
      unprocessedInboxThreads: sql<number>`sum(case when ${inboxExpr} and ${gmailThreads.isProcessed} = 0 then 1 else 0 end)`,
    })
    .from(gmailThreads)
    .where(eq(gmailThreads.accountId, accountId));

  return {
    totalThreads: Number(row?.totalThreads ?? 0),
    inboxThreads: Number(row?.inboxThreads ?? 0),
    unprocessedInboxThreads: Number(row?.unprocessedInboxThreads ?? 0),
  };
}

export async function deleteThreadByGmailId(
  accountId: string,
  gmailThreadId: string,
): Promise<void> {
  await db
    .delete(gmailThreads)
    .where(
      and(
        eq(gmailThreads.accountId, accountId),
        eq(gmailThreads.gmailThreadId, gmailThreadId),
      ),
    );
}
