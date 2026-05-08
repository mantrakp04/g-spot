import { asc, eq, isNotNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "../index";
import { gmailAccounts } from "../schema";
import type { GmailAccountRow } from "../schema/gmail";

export function isNewerHistoryId(
  incoming: string,
  existing: string | null,
): boolean {
  if (!existing) return true;
  try {
    return BigInt(incoming) > BigInt(existing);
  } catch {
    return incoming > existing;
  }
}

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

export async function listGmailAccountsWithPendingNotifications(): Promise<
  GmailAccountRow[]
> {
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

export async function upsertGmailAccount(data: {
  email: string;
  providerAccountId: string;
  historyId?: string;
}): Promise<{ id: string; isNew: boolean }> {
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
  data: { watchExpiration: number; lastWatchHistoryId: string },
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

/**
 * Atomic single-statement upsert of the latest pubsub historyId for an account.
 * Only overwrites when the incoming numeric value is strictly greater than the
 * stored one. Falls back gracefully when either value is NULL or non-numeric.
 */
export async function recordGmailPushNotification(
  accountId: string,
  historyId: string,
  receivedAt = new Date().toISOString(),
): Promise<void> {
  await db
    .update(gmailAccounts)
    .set({
      lastNotificationHistoryId: sql`CASE
        WHEN ${gmailAccounts.lastNotificationHistoryId} IS NULL
          OR CAST(${historyId} AS INTEGER) > CAST(${gmailAccounts.lastNotificationHistoryId} AS INTEGER)
        THEN ${historyId}
        ELSE ${gmailAccounts.lastNotificationHistoryId}
      END`,
      lastNotificationAt: receivedAt,
      updatedAt: receivedAt,
    })
    .where(eq(gmailAccounts.id, accountId));
}

export async function setGmailAccountNeedsFullResync(
  accountId: string,
  needsFullResync: boolean,
): Promise<void> {
  await db
    .update(gmailAccounts)
    .set({ needsFullResync, updatedAt: new Date().toISOString() })
    .where(eq(gmailAccounts.id, accountId));
}

export async function updateGmailAccountSyncTimestamp(
  accountId: string,
  mode: "full" | "incremental",
): Promise<void> {
  const now = new Date().toISOString();
  const field = mode === "full" ? "lastFullSyncAt" : "lastIncrementalSyncAt";
  await db
    .update(gmailAccounts)
    .set({ [field]: now, updatedAt: now })
    .where(eq(gmailAccounts.id, accountId));
}
