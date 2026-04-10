import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "./index";
import {
  gmailAccounts,
  gmailAttachments,
  gmailLabels,
  gmailMessages,
  gmailSyncFailures,
  gmailSyncState,
  gmailThreads,
} from "./schema";
import type {
  GmailAccountRow,
  GmailLabelRow,
  GmailMessageRow,
  GmailSyncFailureRow,
  GmailSyncStateRow,
  GmailThreadRow,
} from "./schema/gmail";

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function getGmailAccount(
  userId: string,
  providerAccountId: string,
): Promise<GmailAccountRow | null> {
  const [row] = await db
    .select()
    .from(gmailAccounts)
    .where(
      and(
        eq(gmailAccounts.userId, userId),
        eq(gmailAccounts.providerAccountId, providerAccountId),
      ),
    );
  return row ?? null;
}

export async function upsertGmailAccount(
  userId: string,
  data: { email: string; providerAccountId: string; historyId?: string },
): Promise<{ id: string; isNew: boolean }> {
  const existing = await getGmailAccount(userId, data.providerAccountId);
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
    userId,
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
    .set({ historyId, updatedAt: new Date().toISOString() })
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
): Promise<{ id: string; isNew: boolean }> {
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
    await db
      .update(gmailThreads)
      .set({
        subject: data.subject,
        snippet: data.snippet,
        lastMessageAt: data.lastMessageAt,
        messageCount: data.messageCount,
        labels: JSON.stringify(data.labels),
        historyId: data.historyId ?? existing.historyId,
        updatedAt: now,
      })
      .where(eq(gmailThreads.id, existing.id));
    return { id: existing.id, isNew: false };
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
  return { id, isNew: true };
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

export async function listThreads(
  accountId: string,
  options: {
    label?: string;
    limit?: number;
    cursor?: string; // lastMessageAt ISO string for keyset pagination
  } = {},
): Promise<{ threads: GmailThreadRow[]; nextCursor: string | null }> {
  const limit = options.limit ?? 20;

  let query = db
    .select()
    .from(gmailThreads)
    .where(eq(gmailThreads.accountId, accountId))
    .orderBy(desc(gmailThreads.lastMessageAt))
    .limit(limit + 1);

  if (options.cursor) {
    query = db
      .select()
      .from(gmailThreads)
      .where(
        and(
          eq(gmailThreads.accountId, accountId),
          lt(gmailThreads.lastMessageAt, options.cursor),
        ),
      )
      .orderBy(desc(gmailThreads.lastMessageAt))
      .limit(limit + 1);
  }

  const rows = await query;

  // Client-side label filter (JSON array). For small result sets this is fine.
  let filtered = rows;
  if (options.label) {
    filtered = rows.filter((r) => {
      const labels: string[] = JSON.parse(r.labels);
      return labels.includes(options.label!);
    });
  }

  const hasMore = filtered.length > limit;
  const threads = filtered.slice(0, limit);
  const nextCursor = hasMore ? threads[threads.length - 1]?.lastMessageAt ?? null : null;

  return { threads, nextCursor };
}

export async function markThreadProcessed(threadId: string): Promise<void> {
  await db
    .update(gmailThreads)
    .set({ isProcessed: true, updatedAt: new Date().toISOString() })
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

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

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
): Promise<string[]> {
  const ids: string[] = [];

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
      ids.push(existing.id);
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
      ids.push(id);
    }
  }

  return ids;
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

export async function getMessageAttachments(messageId: string) {
  return db
    .select()
    .from(gmailAttachments)
    .where(eq(gmailAttachments.messageId, messageId));
}

// ---------------------------------------------------------------------------
// Sync State
// ---------------------------------------------------------------------------

export async function getSyncState(
  accountId: string,
): Promise<GmailSyncStateRow | null> {
  const [row] = await db
    .select()
    .from(gmailSyncState)
    .where(eq(gmailSyncState.accountId, accountId));
  return row ?? null;
}

export async function upsertSyncState(
  accountId: string,
  data: Partial<{
    status: string;
    mode: string;
    totalThreads: number;
    fetchedThreads: number;
    processedThreads: number;
    failedThreads: number;
    startedAt: string;
    completedAt: string | null;
    lastError: string | null;
  }>,
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await getSyncState(accountId);

  if (existing) {
    await db
      .update(gmailSyncState)
      .set({ ...data, updatedAt: now })
      .where(eq(gmailSyncState.id, existing.id));
  } else {
    await db.insert(gmailSyncState).values({
      id: nanoid(),
      accountId,
      status: "idle",
      ...data,
      updatedAt: now,
    });
  }
}

export async function incrementSyncProgress(
  accountId: string,
  field: "fetchedThreads" | "processedThreads" | "failedThreads",
  amount = 1,
): Promise<void> {
  const col = gmailSyncState[field];
  await db
    .update(gmailSyncState)
    .set({
      [field]: sql`${col} + ${amount}`,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(gmailSyncState.accountId, accountId));
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
): Promise<void> {
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
  }
}

export async function getUnresolvedFailures(
  accountId: string,
): Promise<GmailSyncFailureRow[]> {
  return db
    .select()
    .from(gmailSyncFailures)
    .where(
      and(
        eq(gmailSyncFailures.accountId, accountId),
        isNull(gmailSyncFailures.resolvedAt),
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
// Search (LIKE-based for v1)
// ---------------------------------------------------------------------------

export async function searchThreads(
  accountId: string,
  query: string,
  limit = 20,
): Promise<GmailThreadRow[]> {
  const pattern = `%${query}%`;

  // Find matching message thread IDs
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
  const placeholders = ids.map(() => "?").join(",");

  return db
    .select()
    .from(gmailThreads)
    .where(sql`${gmailThreads.id} IN (${sql.raw(placeholders)})`)
    .orderBy(desc(gmailThreads.lastMessageAt));
}
