import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "./index";
import {
  gmailAccounts,
  gmailAnalysisState,
  gmailAttachments,
  gmailAgentWorkflows,
  gmailFetchState,
  gmailLabels,
  gmailMessages,
  gmailSyncFailures,
  gmailThreads,
} from "./schema";
import type {
  GmailAccountRow,
  GmailAnalysisStateRow,
  GmailAgentWorkflowRow,
  GmailFetchStateRow,
  GmailLabelRow,
  GmailMessageRow,
  GmailSyncFailureRow,
  GmailThreadRow,
} from "./schema/gmail";
import type { FilterRule } from "@g-spot/types/filters";

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function getGmailAccount(
  providerAccountId: string,
): Promise<GmailAccountRow | null> {
  const [row] = await db
    .select()
    .from(gmailAccounts)
    .where(eq(gmailAccounts.providerAccountId, providerAccountId));
  return row ?? null;
}

export async function getGmailAccountById(
  accountId: string,
): Promise<GmailAccountRow | null> {
  const [row] = await db
    .select()
    .from(gmailAccounts)
    .where(eq(gmailAccounts.id, accountId));
  return row ?? null;
}

export async function listGmailAccounts(): Promise<GmailAccountRow[]> {
  return db
    .select()
    .from(gmailAccounts)
    .orderBy(asc(gmailAccounts.createdAt));
}

export async function listGmailAccountsWithPendingNotifications(): Promise<GmailAccountRow[]> {
  const accounts = await db
    .select()
    .from(gmailAccounts)
    .where(isNotNull(gmailAccounts.lastNotificationHistoryId))
    .orderBy(asc(gmailAccounts.createdAt));
  return accounts.filter((account) =>
    isNewerHistoryId(account.lastNotificationHistoryId!, account.historyId),
  );
}

export async function listGmailAccountsByEmail(
  email: string,
): Promise<GmailAccountRow[]> {
  return db
    .select()
    .from(gmailAccounts)
    .where(eq(gmailAccounts.email, email))
    .orderBy(asc(gmailAccounts.createdAt));
}

export async function upsertGmailAccount(
  data: { email: string; providerAccountId: string; historyId?: string },
): Promise<{ id: string; isNew: boolean }> {
  const existing = await getGmailAccount(data.providerAccountId);
  if (existing) {
    const now = new Date().toISOString();
    await db
      .update(gmailAccounts)
      .set({
        email: data.email,
        ...(data.historyId ? { historyId: data.historyId } : {}),
        updatedAt: now,
      })
      .where(eq(gmailAccounts.id, existing.id));
    return { id: existing.id, isNew: false };
  }

  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(gmailAccounts).values({
    id,
    email: data.email,
    providerAccountId: data.providerAccountId,
    historyId: data.historyId ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return { id, isNew: true };
}

export async function updateGmailAccountHistoryId(
  accountId: string,
  historyId: string,
): Promise<void> {
  await db
    .update(gmailAccounts)
    .set({
      historyId,
      needsFullResync: false,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(gmailAccounts.id, accountId));
}

export async function updateGmailWatchState(
  accountId: string,
  data: {
    watchExpiration: number;
    lastWatchHistoryId: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .update(gmailAccounts)
    .set({
      watchExpiration: data.watchExpiration,
      lastWatchHistoryId: data.lastWatchHistoryId,
      lastWatchRenewedAt: now,
      updatedAt: now,
    })
    .where(eq(gmailAccounts.id, accountId));
}

export async function recordGmailPushNotification(
  accountId: string,
  historyId: string,
  receivedAt = new Date().toISOString(),
): Promise<void> {
  const [account] = await db
    .select({ lastNotificationHistoryId: gmailAccounts.lastNotificationHistoryId })
    .from(gmailAccounts)
    .where(eq(gmailAccounts.id, accountId));
  const lastHistoryId = account?.lastNotificationHistoryId ?? null;
  const nextHistoryId = isNewerHistoryId(historyId, lastHistoryId)
    ? historyId
    : lastHistoryId;

  await db
    .update(gmailAccounts)
    .set({
      lastNotificationHistoryId: nextHistoryId,
      lastNotificationAt: receivedAt,
      updatedAt: receivedAt,
    })
    .where(eq(gmailAccounts.id, accountId));
}

function isNewerHistoryId(incoming: string, existing: string | null): boolean {
  if (!existing) return true;
  try {
    return BigInt(incoming) > BigInt(existing);
  } catch {
    return incoming > existing;
  }
}

export async function setGmailAccountNeedsFullResync(
  accountId: string,
  needsFullResync: boolean,
): Promise<void> {
  await db
    .update(gmailAccounts)
    .set({
      needsFullResync,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(gmailAccounts.id, accountId));
}

export async function updateGmailAccountSyncTimestamp(
  accountId: string,
  mode: "full" | "incremental",
): Promise<void> {
  const now = new Date().toISOString();
  const field =
    mode === "full" ? "lastFullSyncAt" : "lastIncrementalSyncAt";
  await db
    .update(gmailAccounts)
    .set({ [field]: now, updatedAt: now })
    .where(eq(gmailAccounts.id, accountId));
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export async function syncLabels(
  accountId: string,
  labels: Array<{
    gmailId: string;
    name: string;
    type: "system" | "user";
    color?: string | null;
  }>,
): Promise<void> {
  for (const label of labels) {
    const [existing] = await db
      .select()
      .from(gmailLabels)
      .where(
        and(
          eq(gmailLabels.accountId, accountId),
          eq(gmailLabels.gmailId, label.gmailId),
        ),
      );

    if (existing) {
      await db
        .update(gmailLabels)
        .set({ name: label.name, type: label.type, color: label.color ?? null })
        .where(eq(gmailLabels.id, existing.id));
    } else {
      await db.insert(gmailLabels).values({
        id: nanoid(),
        accountId,
        gmailId: label.gmailId,
        name: label.name,
        type: label.type,
        color: label.color ?? null,
      });
    }
  }
}

export async function getLabels(accountId: string): Promise<GmailLabelRow[]> {
  return db
    .select()
    .from(gmailLabels)
    .where(eq(gmailLabels.accountId, accountId))
    .orderBy(asc(gmailLabels.name));
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

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
    const wasInbox = (JSON.parse(existing.labels) as string[]).includes("INBOX");
    const isInbox = data.labels.includes("INBOX");
    const isProcessed = isInbox && !wasInbox ? false : existing.isProcessed;
    await db
      .update(gmailThreads)
      .set({
        subject: data.subject,
        snippet: data.snippet,
        lastMessageAt: data.lastMessageAt,
        messageCount: data.messageCount,
        labels: JSON.stringify(data.labels),
        historyId: data.historyId ?? existing.historyId,
        isProcessed,
        updatedAt: now,
      })
      .where(eq(gmailThreads.id, existing.id));
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
    labels: JSON.stringify(data.labels),
    historyId: data.historyId ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return { id, isNew: true, isProcessed: false };
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

export async function getThreadById(
  threadId: string,
): Promise<GmailThreadRow | null> {
  const [row] = await db
    .select()
    .from(gmailThreads)
    .where(eq(gmailThreads.id, threadId));
  return row ?? null;
}

export async function listAllThreads(
  accountId: string,
): Promise<GmailThreadRow[]> {
  return db
    .select()
    .from(gmailThreads)
    .where(eq(gmailThreads.accountId, accountId))
    .orderBy(desc(gmailThreads.lastMessageAt));
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

export async function getUnprocessedThreadIds(
  accountId: string,
  limit = 100,
): Promise<string[]> {
  const rows = await db
    .select({ id: gmailThreads.id })
    .from(gmailThreads)
    .where(
      and(
        eq(gmailThreads.accountId, accountId),
        eq(gmailThreads.isProcessed, false),
      ),
    )
    .limit(limit);
  return rows.map((r) => r.id);
}

/**
 * Returns all gmail_thread_ids that are already fetched (stored) for an account.
 */
export async function getFetchedGmailThreadIds(
  accountId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ gmailThreadId: gmailThreads.gmailThreadId })
    .from(gmailThreads)
    .where(eq(gmailThreads.accountId, accountId));
  return new Set(rows.map((r) => r.gmailThreadId));
}

/**
 * Returns fetched inbox thread IDs that still need extraction.
 */
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
        labelExistsSql("INBOX"),
      ),
    );
  return rows.map((r) => r.gmailThreadId);
}

export async function listUnprocessedInboxThreadsBatch(
  accountId: string,
  limit = 100,
  excludeThreadIds: string[] = [],
): Promise<Array<Pick<GmailThreadRow, "id" | "gmailThreadId" | "subject">>> {
  const conditions: SQL[] = [
    eq(gmailThreads.accountId, accountId),
    eq(gmailThreads.isProcessed, false),
    labelExistsSql("INBOX"),
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

  // SQLite caps parameters around 999; chunk to stay well under.
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
          labelExistsSql("INBOX"),
          inArray(gmailThreads.gmailThreadId, chunk),
        ),
      );
    out.push(...rows);
  }
  return out;
}

/**
 * Returns all fetched thread IDs that have the INBOX label (processed or not).
 * Used to count the "processable" universe during sync resume.
 */
export async function getFetchedInboxGmailThreadIds(
  accountId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ gmailThreadId: gmailThreads.gmailThreadId })
    .from(gmailThreads)
    .where(
      and(
        eq(gmailThreads.accountId, accountId),
        labelExistsSql("INBOX"),
      ),
    );
  return new Set(rows.map((r) => r.gmailThreadId));
}

export async function getGmailThreadStats(accountId: string): Promise<{
  totalThreads: number;
  inboxThreads: number;
  unprocessedInboxThreads: number;
}> {
  const [row] = await db
    .select({
      totalThreads: sql<number>`count(*)`,
      inboxThreads: sql<number>`sum(case when ${labelExistsSql("INBOX")} then 1 else 0 end)`,
      unprocessedInboxThreads: sql<number>`sum(case when ${labelExistsSql("INBOX")} and ${gmailThreads.isProcessed} = 0 then 1 else 0 end)`,
    })
    .from(gmailThreads)
    .where(eq(gmailThreads.accountId, accountId));

  return {
    totalThreads: Number(row?.totalThreads ?? 0),
    inboxThreads: Number(row?.inboxThreads ?? 0),
    unprocessedInboxThreads: Number(row?.unprocessedInboxThreads ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type UpsertedGmailMessage = {
  id: string;
  gmailMessageId: string;
  isNew: boolean;
};

export async function upsertMessages(
  threadId: string,
  accountId: string,
  messages: Array<{
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
  }>,
): Promise<UpsertedGmailMessage[]> {
  const results: UpsertedGmailMessage[] = [];

  for (const msg of messages) {
    const [existing] = await db
      .select({ id: gmailMessages.id })
      .from(gmailMessages)
      .where(
        and(
          eq(gmailMessages.accountId, accountId),
          eq(gmailMessages.gmailMessageId, msg.gmailMessageId),
        ),
      );

    if (existing) {
      await db
        .update(gmailMessages)
        .set({
          fromName: msg.fromName,
          fromEmail: msg.fromEmail,
          toHeader: msg.toHeader,
          ccHeader: msg.ccHeader,
          subject: msg.subject,
          date: msg.date,
          bodyHtml: msg.bodyHtml,
          bodyText: msg.bodyText,
          snippet: msg.snippet,
          labels: JSON.stringify(msg.labels),
          messageIdHeader: msg.messageIdHeader,
          inReplyTo: msg.inReplyTo,
          referencesHeader: msg.referencesHeader,
          isDraft: msg.isDraft,
          historyId: msg.historyId,
          rawSizeEstimate: msg.rawSizeEstimate,
        })
        .where(eq(gmailMessages.id, existing.id));
      results.push({
        id: existing.id,
        gmailMessageId: msg.gmailMessageId,
        isNew: false,
      });
    } else {
      const id = nanoid();
      await db.insert(gmailMessages).values({
        id,
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
        labels: JSON.stringify(msg.labels),
        messageIdHeader: msg.messageIdHeader,
        inReplyTo: msg.inReplyTo,
        referencesHeader: msg.referencesHeader,
        isDraft: msg.isDraft,
        historyId: msg.historyId,
        rawSizeEstimate: msg.rawSizeEstimate,
      });
      results.push({
        id,
        gmailMessageId: msg.gmailMessageId,
        isNew: true,
      });
    }
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

export async function listMessagesByAccount(
  accountId: string,
): Promise<GmailMessageRow[]> {
  return db
    .select()
    .from(gmailMessages)
    .where(eq(gmailMessages.accountId, accountId))
    .orderBy(desc(gmailMessages.date));
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
    await db
      .delete(gmailMessages)
      .where(eq(gmailMessages.threadId, threadId));
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

// ---------------------------------------------------------------------------
// Drafts
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
): Promise<
  Array<{ draftId: string; messageId: string; threadId: string }>
> {
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

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export async function upsertAttachments(
  messageId: string,
  attachments: Array<{
    gmailAttachmentId: string | null;
    filename: string;
    mimeType: string;
    size: number;
  }>,
): Promise<void> {
  // Simple replace strategy: delete existing, insert new
  await db
    .delete(gmailAttachments)
    .where(eq(gmailAttachments.messageId, messageId));

  for (const att of attachments) {
    await db.insert(gmailAttachments).values({
      id: nanoid(),
      messageId,
      gmailAttachmentId: att.gmailAttachmentId,
      filename: att.filename,
      mimeType: att.mimeType,
      size: att.size,
    });
  }
}

export async function listAttachmentsByMessageIds(messageIds: string[]) {
  if (messageIds.length === 0) return [];

  return db
    .select()
    .from(gmailAttachments)
    .where(inArray(gmailAttachments.messageId, messageIds));
}

export async function listAttachmentsByAccount(
  accountId: string,
): Promise<Array<typeof gmailAttachments.$inferSelect & { threadId: string }>> {
  return db
    .select({
      id: gmailAttachments.id,
      messageId: gmailAttachments.messageId,
      gmailAttachmentId: gmailAttachments.gmailAttachmentId,
      filename: gmailAttachments.filename,
      mimeType: gmailAttachments.mimeType,
      size: gmailAttachments.size,
      createdAt: gmailAttachments.createdAt,
      threadId: gmailMessages.threadId,
    })
    .from(gmailAttachments)
    .innerJoin(gmailMessages, eq(gmailAttachments.messageId, gmailMessages.id))
    .where(eq(gmailMessages.accountId, accountId));
}

// ---------------------------------------------------------------------------
// Fetch State
// ---------------------------------------------------------------------------

export async function getFetchState(
  accountId: string,
  mode: "full" | "incremental",
): Promise<GmailFetchStateRow | null> {
  const [row] = await db
    .select()
    .from(gmailFetchState)
    .where(
      and(
        eq(gmailFetchState.accountId, accountId),
        eq(gmailFetchState.mode, mode),
      ),
    );
  return row ?? null;
}

export async function listFetchStates(
  accountId: string,
): Promise<GmailFetchStateRow[]> {
  return db
    .select()
    .from(gmailFetchState)
    .where(eq(gmailFetchState.accountId, accountId));
}

export async function getRunningFetchStates(): Promise<GmailFetchStateRow[]> {
  return db
    .select()
    .from(gmailFetchState)
    .where(
      or(
        eq(gmailFetchState.status, "running"),
        eq(gmailFetchState.status, "paused"),
        eq(gmailFetchState.status, "interrupted"),
      ),
    );
}

export async function upsertFetchState(
  accountId: string,
  mode: "full" | "incremental",
  data: Partial<{
    status: string;
    totalThreads: number;
    fetchedThreads: number;
    failedThreads: number;
    startedAt: string;
    completedAt: string | null;
    lastError: string | null;
  }>,
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await getFetchState(accountId, mode);

  if (existing) {
    await db
      .update(gmailFetchState)
      .set({ ...data, updatedAt: now })
      .where(eq(gmailFetchState.id, existing.id));
  } else {
    await db.insert(gmailFetchState).values({
      id: nanoid(),
      accountId,
      mode,
      status: "idle",
      ...data,
      updatedAt: now,
    });
  }
}

export async function incrementFetchProgress(
  accountId: string,
  mode: "full" | "incremental",
  field: "fetchedThreads" | "failedThreads",
  amount = 1,
): Promise<void> {
  const col = gmailFetchState[field];
  await db
    .update(gmailFetchState)
    .set({
      [field]: sql`${col} + ${amount}`,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(gmailFetchState.accountId, accountId),
        eq(gmailFetchState.mode, mode),
      ),
    );
}

// ---------------------------------------------------------------------------
// Analysis State
// ---------------------------------------------------------------------------

export async function getAnalysisState(
  accountId: string,
): Promise<GmailAnalysisStateRow | null> {
  const [row] = await db
    .select()
    .from(gmailAnalysisState)
    .where(eq(gmailAnalysisState.accountId, accountId));
  return row ?? null;
}

export async function upsertAnalysisState(
  accountId: string,
  data: Partial<{
    status: string;
    totalThreads: number;
    analyzedThreads: number;
    failedThreads: number;
    startedAt: string;
    completedAt: string | null;
    lastError: string | null;
  }>,
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await getAnalysisState(accountId);

  if (existing) {
    await db
      .update(gmailAnalysisState)
      .set({ ...data, updatedAt: now })
      .where(eq(gmailAnalysisState.id, existing.id));
  } else {
    await db.insert(gmailAnalysisState).values({
      id: nanoid(),
      accountId,
      status: "idle",
      ...data,
      updatedAt: now,
    });
  }
}

export async function incrementAnalysisProgress(
  accountId: string,
  field: "analyzedThreads" | "failedThreads",
  amount = 1,
): Promise<void> {
  const col = gmailAnalysisState[field];
  await db
    .update(gmailAnalysisState)
    .set({
      [field]: sql`${col} + ${amount}`,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(gmailAnalysisState.accountId, accountId));
}

// ---------------------------------------------------------------------------
// Sync Failures (dead-letter queue)
// ---------------------------------------------------------------------------

export async function recordSyncFailure(
  accountId: string,
  data: {
    gmailThreadId: string;
    stage: string;
    errorMessage: string;
    errorCode?: string;
  },
): Promise<boolean> {
  const now = new Date().toISOString();

  // Check if there's an existing unresolved failure for this thread
  const [existing] = await db
    .select()
    .from(gmailSyncFailures)
    .where(
      and(
        eq(gmailSyncFailures.accountId, accountId),
        eq(gmailSyncFailures.gmailThreadId, data.gmailThreadId),
        isNull(gmailSyncFailures.resolvedAt),
      ),
    );

  if (existing) {
    await db
      .update(gmailSyncFailures)
      .set({
        stage: data.stage,
        errorMessage: data.errorMessage,
        errorCode: data.errorCode ?? null,
        attempts: sql`${gmailSyncFailures.attempts} + 1`,
        lastAttemptAt: now,
      })
      .where(eq(gmailSyncFailures.id, existing.id));
    return false;
  } else {
    await db.insert(gmailSyncFailures).values({
      id: nanoid(),
      accountId,
      gmailThreadId: data.gmailThreadId,
      stage: data.stage,
      errorMessage: data.errorMessage,
      errorCode: data.errorCode ?? null,
      attempts: 1,
      lastAttemptAt: now,
      createdAt: now,
    });
    return true;
  }
}

export async function getRetryableSyncFailures(
  accountId: string,
): Promise<GmailSyncFailureRow[]> {
  return db
    .select({
      id: gmailSyncFailures.id,
      accountId: gmailSyncFailures.accountId,
      gmailThreadId: gmailSyncFailures.gmailThreadId,
      stage: gmailSyncFailures.stage,
      errorMessage: gmailSyncFailures.errorMessage,
      errorCode: gmailSyncFailures.errorCode,
      attempts: gmailSyncFailures.attempts,
      lastAttemptAt: gmailSyncFailures.lastAttemptAt,
      resolvedAt: gmailSyncFailures.resolvedAt,
      createdAt: gmailSyncFailures.createdAt,
    })
    .from(gmailSyncFailures)
    .leftJoin(
      gmailThreads,
      and(
        eq(gmailThreads.accountId, gmailSyncFailures.accountId),
        eq(gmailThreads.gmailThreadId, gmailSyncFailures.gmailThreadId),
      ),
    )
    .where(
      and(
        eq(gmailSyncFailures.accountId, accountId),
        isNull(gmailSyncFailures.resolvedAt),
        or(
          eq(gmailSyncFailures.stage, "fetch"),
          labelExistsSql("INBOX"),
        ),
      ),
    )
    .orderBy(desc(gmailSyncFailures.lastAttemptAt));
}

export async function resolveFailure(failureId: string): Promise<void> {
  await db
    .update(gmailSyncFailures)
    .set({ resolvedAt: new Date().toISOString() })
    .where(eq(gmailSyncFailures.id, failureId));
}

export async function resolveFailuresForThread(
  accountId: string,
  gmailThreadId: string,
): Promise<number> {
  const unresolved = await db
    .select({ id: gmailSyncFailures.id })
    .from(gmailSyncFailures)
    .where(
      and(
        eq(gmailSyncFailures.accountId, accountId),
        eq(gmailSyncFailures.gmailThreadId, gmailThreadId),
        isNull(gmailSyncFailures.resolvedAt),
      ),
    );

  if (unresolved.length === 0) return 0;

  await db
    .update(gmailSyncFailures)
    .set({ resolvedAt: new Date().toISOString() })
    .where(
      inArray(
        gmailSyncFailures.id,
        unresolved.map((r) => r.id),
      ),
    );

  return unresolved.length;
}

export async function getRetryableFailureThreadIds(
  accountId: string,
): Promise<string[]> {
  const rows = await db
    .select({ gmailThreadId: gmailSyncFailures.gmailThreadId })
    .from(gmailSyncFailures)
    .leftJoin(
      gmailThreads,
      and(
        eq(gmailThreads.accountId, gmailSyncFailures.accountId),
        eq(gmailThreads.gmailThreadId, gmailSyncFailures.gmailThreadId),
      ),
    )
    .where(
      and(
        eq(gmailSyncFailures.accountId, accountId),
        isNull(gmailSyncFailures.resolvedAt),
        or(
          eq(gmailSyncFailures.stage, "fetch"),
          labelExistsSql("INBOX"),
        ),
      ),
    );
  return Array.from(new Set(rows.map((r) => r.gmailThreadId)));
}

// ---------------------------------------------------------------------------
// Agent Workflows
// ---------------------------------------------------------------------------

export async function listGmailAgentWorkflows(
  accountId: string,
): Promise<GmailAgentWorkflowRow[]> {
  return db
    .select()
    .from(gmailAgentWorkflows)
    .where(eq(gmailAgentWorkflows.accountId, accountId))
    .orderBy(asc(gmailAgentWorkflows.createdAt));
}

export async function listEnabledIncrementalGmailAgentWorkflows(
  accountId: string,
): Promise<GmailAgentWorkflowRow[]> {
  return db
    .select()
    .from(gmailAgentWorkflows)
    .where(
      and(
        eq(gmailAgentWorkflows.accountId, accountId),
        eq(gmailAgentWorkflows.enabled, true),
        eq(gmailAgentWorkflows.trigger, "incremental_sync"),
      ),
    )
    .orderBy(asc(gmailAgentWorkflows.createdAt));
}

export async function upsertGmailAgentWorkflow(
  accountId: string,
  input: {
    id?: string;
    name: string;
    enabled: boolean;
    prompt: string;
    agentConfig?: string;
    disabledToolNames?: string;
  },
): Promise<{ id: string }> {
  const now = new Date().toISOString();

  if (input.id) {
    await db
      .update(gmailAgentWorkflows)
      .set({
        name: input.name,
        enabled: input.enabled,
        prompt: input.prompt,
        ...(input.agentConfig !== undefined ? { agentConfig: input.agentConfig } : {}),
        ...(input.disabledToolNames !== undefined
          ? { disabledToolNames: input.disabledToolNames }
          : {}),
        trigger: "incremental_sync",
        updatedAt: now,
      })
      .where(
        and(
          eq(gmailAgentWorkflows.id, input.id),
          eq(gmailAgentWorkflows.accountId, accountId),
        ),
      );
    return { id: input.id };
  }

  const id = nanoid();
  await db.insert(gmailAgentWorkflows).values({
    id,
    accountId,
    name: input.name,
    enabled: input.enabled,
    trigger: "incremental_sync",
    prompt: input.prompt,
    agentConfig: input.agentConfig ?? "{}",
    disabledToolNames: input.disabledToolNames ?? "[]",
    createdAt: now,
    updatedAt: now,
  });
  return { id };
}

export async function deleteGmailAgentWorkflow(
  accountId: string,
  workflowId: string,
): Promise<void> {
  await db
    .delete(gmailAgentWorkflows)
    .where(
      and(
        eq(gmailAgentWorkflows.accountId, accountId),
        eq(gmailAgentWorkflows.id, workflowId),
      ),
    );
}

export async function getFailuresByIds(
  failureIds: string[],
): Promise<GmailSyncFailureRow[]> {
  if (failureIds.length === 0) return [];
  return db
    .select()
    .from(gmailSyncFailures)
    .where(
      and(
        inArray(gmailSyncFailures.id, failureIds),
        isNull(gmailSyncFailures.resolvedAt),
      ),
    );
}

// ---------------------------------------------------------------------------
// Filtered thread queries
// ---------------------------------------------------------------------------

export type GmailFilterCondition = {
  type?: "condition";
  field: string;
  operator: string;
  value: string;
  logic?: "and" | "or";
};

type ThreadListItem = {
  id: string;
  gmailThreadId: string;
  subject: string;
  snippet: string;
  lastMessageAt: string | null;
  labels: string;
  fromName: string;
  fromEmail: string;
  hasAttachment: boolean;
};

function mapCategoryToLabel(value: string): string | null {
  switch (value.trim().toLowerCase()) {
    case "primary": return "CATEGORY_PERSONAL";
    case "social": return "CATEGORY_SOCIAL";
    case "promotions": return "CATEGORY_PROMOTIONS";
    case "updates": return "CATEGORY_UPDATES";
    case "forums": return "CATEGORY_FORUMS";
    default: return null;
  }
}

function mapLocationToLabel(value: string): string | null {
  switch (value.trim().toLowerCase()) {
    case "inbox": return "INBOX";
    case "sent": return "SENT";
    case "draft": case "drafts": return "DRAFT";
    case "trash": return "TRASH";
    case "spam": return "SPAM";
    case "starred": return "STARRED";
    case "important": return "IMPORTANT";
    case "anywhere": return null;
    default: return value;
  }
}

function parseRelativeDurationMs(value: string): number | null {
  const match = value.trim().match(/^(\d+)([dmy])$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  if (unit === "d") return amount * 86_400_000;
  if (unit === "m") return amount * 30 * 86_400_000;
  if (unit === "y") return amount * 365 * 86_400_000;
  return null;
}

function parseSizeBytes(value: string): number | null {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)([kmg])?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  if (!unit) return amount;
  if (unit === "k") return amount * 1024;
  if (unit === "m") return amount * 1048576;
  if (unit === "g") return amount * 1073741824;
  return amount;
}

function booleanFilterWantsPositive(operator: string, value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (normalized !== "true" && normalized !== "false") return null;
  const rawValue = normalized === "true";
  return operator === "is_not" ? !rawValue : rawValue;
}

function labelExistsSql(label: string): SQL {
  return sql`EXISTS (SELECT 1 FROM json_each(${gmailThreads.labels}) WHERE json_each.value = ${label})`;
}

function labelNotExistsSql(label: string): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM json_each(${gmailThreads.labels}) WHERE json_each.value = ${label})`;
}

function labelContainsSql(pattern: string): SQL {
  return sql`EXISTS (SELECT 1 FROM json_each(${gmailThreads.labels}) WHERE LOWER(json_each.value) LIKE ${pattern})`;
}

function messageFieldMatchSql(
  accountId: string,
  column: typeof gmailMessages.fromEmail | typeof gmailMessages.fromName | typeof gmailMessages.toHeader | typeof gmailMessages.ccHeader | typeof gmailMessages.subject,
  operator: string,
  value: string,
): SQL {
  const needle = value.trim().toLowerCase();
  let cond: SQL;
  switch (operator) {
    case "is":
      cond = sql`LOWER(${column}) = ${needle}`;
      break;
    case "is_not":
      cond = sql`LOWER(${column}) != ${needle}`;
      break;
    case "contains":
      cond = sql`LOWER(${column}) LIKE ${"%" + needle + "%"}`;
      break;
    case "not_contains":
      cond = sql`LOWER(${column}) NOT LIKE ${"%" + needle + "%"}`;
      break;
    default:
      cond = sql`1=1`;
  }

  const isNegated = operator === "is_not" || operator === "not_contains";
  if (isNegated) {
    return sql`NOT EXISTS (SELECT 1 FROM ${gmailMessages} m WHERE m.thread_id = ${gmailThreads.id} AND m.account_id = ${accountId} AND NOT (${cond}))`;
  }

  return sql`EXISTS (SELECT 1 FROM ${gmailMessages} m WHERE m.thread_id = ${gmailThreads.id} AND m.account_id = ${accountId} AND ${cond})`;
}

function buildFilterConditionSql(
  accountId: string,
  filter: GmailFilterCondition,
): SQL | null {
  const { field, operator, value } = filter;

  switch (field) {
    case "from": {
      const needle = value.trim().toLowerCase();
      const like = "%" + needle + "%";
      if (operator === "is" || operator === "contains") {
        const match = operator === "is" ? sql`LOWER(m.from_email) = ${needle}` : sql`(LOWER(m.from_email) LIKE ${like} OR LOWER(m.from_name) LIKE ${like})`;
        return sql`EXISTS (SELECT 1 FROM ${gmailMessages} m WHERE m.thread_id = ${gmailThreads.id} AND m.account_id = ${accountId} AND ${match})`;
      }
      if (operator === "is_not" || operator === "not_contains") {
        const match = operator === "is_not" ? sql`LOWER(m.from_email) = ${needle}` : sql`(LOWER(m.from_email) LIKE ${like} OR LOWER(m.from_name) LIKE ${like})`;
        return sql`NOT EXISTS (SELECT 1 FROM ${gmailMessages} m WHERE m.thread_id = ${gmailThreads.id} AND m.account_id = ${accountId} AND ${match})`;
      }
      return null;
    }

    case "to":
      return messageFieldMatchSql(accountId, gmailMessages.toHeader, operator, value);
    case "cc":
      return messageFieldMatchSql(accountId, gmailMessages.ccHeader, operator, value);
    case "subject":
      return messageFieldMatchSql(accountId, gmailMessages.subject, operator, value);

    case "label": {
      const needle = value.trim().toLowerCase();
      if (operator === "is") return labelExistsSql(value);
      if (operator === "is_not") return labelNotExistsSql(value);
      if (operator === "contains") return labelContainsSql("%" + needle + "%");
      if (operator === "not_contains") return sql`NOT (${labelContainsSql("%" + needle + "%")})`;
      return null;
    }

    case "category": {
      const mapped = mapCategoryToLabel(value);
      if (!mapped) return null;
      return operator === "is_not"
        ? labelNotExistsSql(mapped)
        : labelExistsSql(mapped);
    }

    case "in": {
      const mapped = mapLocationToLabel(value);
      if (mapped === null) return null;
      return operator === "is_not"
        ? labelNotExistsSql(mapped)
        : labelExistsSql(mapped);
    }

    case "is_unread": {
      const wantsPositive = booleanFilterWantsPositive(operator, value);
      if (wantsPositive === null) return null;
      return wantsPositive ? labelExistsSql("UNREAD") : labelNotExistsSql("UNREAD");
    }
    case "is_read": {
      const wantsPositive = booleanFilterWantsPositive(operator, value);
      if (wantsPositive === null) return null;
      return wantsPositive ? labelNotExistsSql("UNREAD") : labelExistsSql("UNREAD");
    }
    case "is_starred": {
      const wantsPositive = booleanFilterWantsPositive(operator, value);
      if (wantsPositive === null) return null;
      return wantsPositive ? labelExistsSql("STARRED") : labelNotExistsSql("STARRED");
    }
    case "is_important": {
      const wantsPositive = booleanFilterWantsPositive(operator, value);
      if (wantsPositive === null) return null;
      return wantsPositive ? labelExistsSql("IMPORTANT") : labelNotExistsSql("IMPORTANT");
    }
    case "is_snoozed": {
      const wantsPositive = booleanFilterWantsPositive(operator, value);
      if (wantsPositive === null) return null;
      return wantsPositive ? labelExistsSql("SNOOZED") : labelNotExistsSql("SNOOZED");
    }
    case "is_muted": {
      const wantsPositive = booleanFilterWantsPositive(operator, value);
      if (wantsPositive === null) return null;
      return wantsPositive ? labelExistsSql("MUTED") : labelNotExistsSql("MUTED");
    }

    case "has_attachment": {
      const wantsPositive = booleanFilterWantsPositive(operator, value);
      if (wantsPositive === null) return null;
      if (wantsPositive) {
        return sql`EXISTS (SELECT 1 FROM ${gmailAttachments} a INNER JOIN ${gmailMessages} m ON a.message_id = m.id WHERE m.thread_id = ${gmailThreads.id} AND m.account_id = ${accountId})`;
      }
      return sql`NOT EXISTS (SELECT 1 FROM ${gmailAttachments} a INNER JOIN ${gmailMessages} m ON a.message_id = m.id WHERE m.thread_id = ${gmailThreads.id} AND m.account_id = ${accountId})`;
    }

    case "filename": {
      const needle = value.trim().toLowerCase();
      const like = "%" + needle + "%";
      if (operator === "is") {
        return sql`EXISTS (SELECT 1 FROM ${gmailAttachments} a INNER JOIN ${gmailMessages} m ON a.message_id = m.id WHERE m.thread_id = ${gmailThreads.id} AND m.account_id = ${accountId} AND LOWER(a.filename) = ${needle})`;
      }
      if (operator === "contains") {
        return sql`EXISTS (SELECT 1 FROM ${gmailAttachments} a INNER JOIN ${gmailMessages} m ON a.message_id = m.id WHERE m.thread_id = ${gmailThreads.id} AND m.account_id = ${accountId} AND LOWER(a.filename) LIKE ${like})`;
      }
      return null;
    }

    case "after": {
      const dateStr = value.trim();
      return sql`${gmailThreads.lastMessageAt} > ${dateStr}`;
    }
    case "before": {
      const dateStr = value.trim();
      return sql`${gmailThreads.lastMessageAt} < ${dateStr}`;
    }
    case "newer_than": {
      const durationMs = parseRelativeDurationMs(value);
      if (durationMs === null) return null;
      const cutoff = new Date(Date.now() - durationMs).toISOString();
      return sql`${gmailThreads.lastMessageAt} >= ${cutoff}`;
    }
    case "older_than": {
      const durationMs = parseRelativeDurationMs(value);
      if (durationMs === null) return null;
      const cutoff = new Date(Date.now() - durationMs).toISOString();
      return sql`${gmailThreads.lastMessageAt} <= ${cutoff}`;
    }

    case "larger": {
      const bytes = parseSizeBytes(value);
      if (bytes === null) return null;
      return sql`(SELECT COALESCE(SUM(COALESCE(m.raw_size_estimate, 0)), 0) FROM ${gmailMessages} m WHERE m.thread_id = ${gmailThreads.id} AND m.account_id = ${accountId}) > ${bytes}`;
    }
    case "smaller": {
      const bytes = parseSizeBytes(value);
      if (bytes === null) return null;
      return sql`(SELECT COALESCE(SUM(COALESCE(m.raw_size_estimate, 0)), 0) FROM ${gmailMessages} m WHERE m.thread_id = ${gmailThreads.id} AND m.account_id = ${accountId}) < ${bytes}`;
    }

    case "has_drive":
    case "has_document":
    case "has_spreadsheet":
    case "has_presentation":
    case "has_youtube": {
      const wantsPositive = booleanFilterWantsPositive(operator, value);
      if (wantsPositive === null) return null;
      const patterns: Record<string, string[]> = {
        has_drive: ["%drive.google.com%"],
        has_document: ["%docs.google.com/document%"],
        has_spreadsheet: ["%docs.google.com/spreadsheets%"],
        has_presentation: ["%docs.google.com/presentation%"],
        has_youtube: ["%youtube.com%", "%youtu.be%"],
      };
      const likes = patterns[field]!;
      const likeClauses = likes.map((p) => sql`(m.body_html LIKE ${p} OR m.body_text LIKE ${p})`);
      const combined = likeClauses.length === 1
        ? likeClauses[0]!
        : sql`(${sql.join(likeClauses, sql` OR `)})`;
      if (wantsPositive) {
        return sql`EXISTS (SELECT 1 FROM ${gmailMessages} m WHERE m.thread_id = ${gmailThreads.id} AND m.account_id = ${accountId} AND ${combined})`;
      }
      return sql`NOT EXISTS (SELECT 1 FROM ${gmailMessages} m WHERE m.thread_id = ${gmailThreads.id} AND m.account_id = ${accountId} AND ${combined})`;
    }

    default:
      return null;
  }
}

function buildFilterRuleSql(
  accountId: string,
  rule: FilterRule,
): SQL | undefined {
  if (rule.type === "condition") {
    if (rule.value.trim().length === 0) return undefined;
    return buildFilterConditionSql(accountId, rule) ?? undefined;
  }

  const conditions = rule.children
    .map((child) => buildFilterRuleSql(accountId, child))
    .filter((condition): condition is SQL => condition != null);

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return rule.operator === "or" ? or(...conditions) : and(...conditions);
}

function buildFilterWhere(
  accountId: string,
  filters: FilterRule,
): SQL | undefined {
  const ruleSql = buildFilterRuleSql(accountId, filters);
  const conditions: SQL[] = [eq(gmailThreads.accountId, accountId)];
  if (ruleSql) conditions.push(ruleSql);

  return and(...conditions);
}

export async function queryThreads(
  accountId: string,
  filters: FilterRule,
  options: {
    limit?: number;
    cursor?: string | null;
    sortAsc?: boolean;
  } = {},
): Promise<{ threads: ThreadListItem[]; hasMore: boolean; totalCount: number }> {
  const limit = options.limit ?? 7;
  const where = buildFilterWhere(accountId, filters);

  const cursorConditions: SQL[] = where ? [where] : [eq(gmailThreads.accountId, accountId)];
  if (options.cursor) {
    cursorConditions.push(lt(gmailThreads.lastMessageAt, options.cursor));
  }

  const threadRows = await db
    .select({
      id: gmailThreads.id,
      gmailThreadId: gmailThreads.gmailThreadId,
      subject: gmailThreads.subject,
      snippet: gmailThreads.snippet,
      lastMessageAt: gmailThreads.lastMessageAt,
      labels: gmailThreads.labels,
    })
    .from(gmailThreads)
    .where(and(...cursorConditions))
    .orderBy(options.sortAsc ? asc(gmailThreads.lastMessageAt) : desc(gmailThreads.lastMessageAt))
    .limit(limit + 1);

  const hasMore = threadRows.length > limit;
  const pageRows = threadRows.slice(0, limit);
  const threadIds = pageRows.map((r) => r.id);

  // Batch-fetch latest message sender + attachment presence for the page
  const [senderRows, attachmentCounts] = threadIds.length > 0
    ? await Promise.all([
        db
          .select({
            threadId: gmailMessages.threadId,
            fromName: gmailMessages.fromName,
            fromEmail: gmailMessages.fromEmail,
            date: gmailMessages.date,
          })
          .from(gmailMessages)
          .where(inArray(gmailMessages.threadId, threadIds))
          .orderBy(desc(gmailMessages.date)),
        db
          .select({
            threadId: gmailMessages.threadId,
            count: sql<number>`COUNT(*)`.as("count"),
          })
          .from(gmailAttachments)
          .innerJoin(gmailMessages, eq(gmailAttachments.messageId, gmailMessages.id))
          .where(inArray(gmailMessages.threadId, threadIds))
          .groupBy(gmailMessages.threadId),
      ])
    : [[], []];

  // Pick the first (latest by date DESC) message per thread
  const msgMap = new Map<string, { fromName: string; fromEmail: string }>();
  for (const row of senderRows) {
    if (!msgMap.has(row.threadId)) {
      msgMap.set(row.threadId, { fromName: row.fromName, fromEmail: row.fromEmail });
    }
  }
  const attMap = new Map(attachmentCounts.map((r) => [r.threadId, r.count]));

  const threads: ThreadListItem[] = pageRows.map((row) => {
    const msg = msgMap.get(row.id);
    return {
      id: row.id,
      gmailThreadId: row.gmailThreadId,
      subject: row.subject,
      snippet: row.snippet,
      lastMessageAt: row.lastMessageAt,
      labels: row.labels,
      fromName: msg?.fromName ?? "",
      fromEmail: msg?.fromEmail ?? "",
      hasAttachment: (attMap.get(row.id) ?? 0) > 0,
    };
  });

  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(gmailThreads)
    .where(where);
  const totalCount = countRow?.count ?? 0;

  return { threads, hasMore, totalCount };
}

export async function countFilteredThreads(
  accountId: string,
  filters: FilterRule,
): Promise<number> {
  const where = buildFilterWhere(accountId, filters);
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(gmailThreads)
    .where(where);
  return row?.count ?? 0;
}

export async function getContactSuggestions(
  accountId: string,
  limit = 100,
): Promise<Array<{ name: string; email: string }>> {
  const rows = await db
    .select({
      fromName: gmailMessages.fromName,
      fromEmail: gmailMessages.fromEmail,
      count: sql<number>`COUNT(*)`.as("cnt"),
    })
    .from(gmailMessages)
    .where(and(
      eq(gmailMessages.accountId, accountId),
      sql`${gmailMessages.fromEmail} != ''`,
    ))
    .groupBy(gmailMessages.fromEmail)
    .orderBy(sql`cnt DESC`)
    .limit(limit);

  return rows.map((r) => ({
    name: r.fromName,
    email: r.fromEmail,
  }));
}

export async function getFieldSuggestions(
  accountId: string,
  field: "from" | "to" | "cc" | "subject" | "filename",
  limit = 50,
): Promise<Array<{ value: string; label: string }>> {
  switch (field) {
    case "from": {
      const rows = await db
        .select({
          fromName: gmailMessages.fromName,
          fromEmail: gmailMessages.fromEmail,
        })
        .from(gmailMessages)
        .where(and(
          eq(gmailMessages.accountId, accountId),
          sql`${gmailMessages.fromEmail} != ''`,
        ))
        .groupBy(gmailMessages.fromEmail)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(limit);
      return rows.map((r) => ({
        value: r.fromEmail,
        label: r.fromName ? `${r.fromName} <${r.fromEmail}>` : r.fromEmail,
      }));
    }

    case "to": {
      const rows = await db
        .select({ toHeader: gmailMessages.toHeader })
        .from(gmailMessages)
        .where(and(
          eq(gmailMessages.accountId, accountId),
          sql`${gmailMessages.toHeader} != ''`,
        ))
        .groupBy(gmailMessages.toHeader)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(limit * 3);
      return extractUniqueEmails(rows.map((r) => r.toHeader), limit);
    }

    case "cc": {
      const rows = await db
        .select({ ccHeader: gmailMessages.ccHeader })
        .from(gmailMessages)
        .where(and(
          eq(gmailMessages.accountId, accountId),
          sql`${gmailMessages.ccHeader} != ''`,
        ))
        .groupBy(gmailMessages.ccHeader)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(limit * 3);
      return extractUniqueEmails(rows.map((r) => r.ccHeader), limit);
    }

    case "subject": {
      const rows = await db
        .select({ subject: gmailMessages.subject })
        .from(gmailMessages)
        .where(and(
          eq(gmailMessages.accountId, accountId),
          sql`${gmailMessages.subject} != ''`,
        ))
        .groupBy(gmailMessages.subject)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(limit);
      return rows.map((r) => ({ value: r.subject, label: r.subject }));
    }

    case "filename": {
      const rows = await db
        .select({ filename: gmailAttachments.filename })
        .from(gmailAttachments)
        .innerJoin(gmailMessages, eq(gmailAttachments.messageId, gmailMessages.id))
        .where(eq(gmailMessages.accountId, accountId))
        .groupBy(gmailAttachments.filename)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(limit);
      return rows.map((r) => ({ value: r.filename, label: r.filename }));
    }

    default:
      return [];
  }
}

function extractUniqueEmails(
  headers: string[],
  limit: number,
): Array<{ value: string; label: string }> {
  const seen = new Map<string, string>();

  for (const raw of headers) {
    for (const part of raw.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      const named = trimmed.match(/^(.+?)\s*<(.+?)>$/);
      if (named) {
        const email = named[2]!.trim().toLowerCase();
        if (!seen.has(email)) {
          const name = named[1]!.trim().replace(/^"|"$/g, "");
          seen.set(email, name ? `${name} <${email}>` : email);
        }
      } else {
        const email = trimmed.replace(/^<|>$/g, "").trim().toLowerCase();
        if (email && !seen.has(email)) {
          seen.set(email, email);
        }
      }

      if (seen.size >= limit) break;
    }
    if (seen.size >= limit) break;
  }

  return [...seen.entries()].map(([email, label]) => ({ value: email, label }));
}

// ---------------------------------------------------------------------------
// Search (LIKE-based)
// ---------------------------------------------------------------------------

export async function searchThreads(
  accountId: string,
  query: string,
  limit = 20,
): Promise<ThreadListItem[]> {
  const pattern = `%${query}%`;

  const matchingThreadIds = await db
    .select({ threadId: gmailMessages.threadId })
    .from(gmailMessages)
    .where(
      and(
        eq(gmailMessages.accountId, accountId),
        sql`(${gmailMessages.subject} LIKE ${pattern} OR ${gmailMessages.bodyText} LIKE ${pattern} OR ${gmailMessages.fromEmail} LIKE ${pattern} OR ${gmailMessages.fromName} LIKE ${pattern})`,
      ),
    )
    .groupBy(gmailMessages.threadId)
    .limit(limit);

  if (matchingThreadIds.length === 0) return [];

  const ids = matchingThreadIds.map((r) => r.threadId);

  const rows = await db
    .select()
    .from(gmailThreads)
    .where(inArray(gmailThreads.id, ids))
    .orderBy(desc(gmailThreads.lastMessageAt));

  const senderRows = await db
    .select({
      threadId: gmailMessages.threadId,
      fromName: gmailMessages.fromName,
      fromEmail: gmailMessages.fromEmail,
      date: gmailMessages.date,
    })
    .from(gmailMessages)
    .where(inArray(gmailMessages.threadId, ids))
    .orderBy(desc(gmailMessages.date));

  const msgMap = new Map<string, { fromName: string; fromEmail: string }>();
  for (const row of senderRows) {
    if (!msgMap.has(row.threadId)) {
      msgMap.set(row.threadId, { fromName: row.fromName, fromEmail: row.fromEmail });
    }
  }

  const attachmentCounts = await db
    .select({
      threadId: gmailMessages.threadId,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(gmailAttachments)
    .innerJoin(gmailMessages, eq(gmailAttachments.messageId, gmailMessages.id))
    .where(inArray(gmailMessages.threadId, ids))
    .groupBy(gmailMessages.threadId);
  const attMap = new Map(attachmentCounts.map((r) => [r.threadId, r.count]));

  return rows.map((row) => {
    const msg = msgMap.get(row.id);
    return {
      id: row.id,
      gmailThreadId: row.gmailThreadId,
      subject: row.subject,
      snippet: row.snippet,
      lastMessageAt: row.lastMessageAt,
      labels: row.labels,
      fromName: msg?.fromName ?? "",
      fromEmail: msg?.fromEmail ?? "",
      hasAttachment: (attMap.get(row.id) ?? 0) > 0,
    };
  });
}
