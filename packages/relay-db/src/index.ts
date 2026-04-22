import { Database } from "bun:sqlite";
import { env } from "@g-spot/env/relay";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";

import { relayEvents, type RelayEventRow } from "./schema";

let relaySqlite: Database | null = null;
let relayDb: ReturnType<typeof drizzle> | null = null;

function getOrCreateSqlite() {
  if (!relaySqlite) {
    const path = env.DATABASE_URL.startsWith("file:")
      ? env.DATABASE_URL.slice("file:".length)
      : env.DATABASE_URL;
    relaySqlite = new Database(path, { create: true });
    relaySqlite.exec("PRAGMA journal_mode = WAL;");
  }
  return relaySqlite;
}

function getRelayDb() {
  if (!relayDb) {
    relayDb = drizzle({
      client: getOrCreateSqlite(),
      schema: { relayEvents },
    });
  }
  return relayDb;
}

export async function enqueueRelayEvent(event: {
  id: string;
  userId: string;
  pubsubMessageId: string | null;
  emailAddress: string;
  historyId: string;
  publishTime: string | null;
  receivedAt: string;
}) {
  await getRelayDb()
    .insert(relayEvents)
    .values(event)
    .onConflictDoNothing({
      target: [relayEvents.pubsubMessageId, relayEvents.userId],
    });
}

export async function getNextPendingRelayEvent(
  userId: string,
): Promise<RelayEventRow | null> {
  const rows = await getRelayDb()
    .select()
    .from(relayEvents)
    .where(and(eq(relayEvents.userId, userId), isNull(relayEvents.drainedAt)))
    .orderBy(asc(relayEvents.createdAt), asc(relayEvents.id))
    .limit(1);

  return rows[0] ?? null;
}

export async function incrementRelayEventAttempt(id: string, sentAt: string) {
  await getRelayDb()
    .update(relayEvents)
    .set({
      attempts: sql`${relayEvents.attempts} + 1`,
      lastSentAt: sentAt,
    })
    .where(eq(relayEvents.id, id));
}

export async function markRelayEventDrained(
  userId: string,
  id: string,
  drainedAt: string,
) {
  await getRelayDb()
    .update(relayEvents)
    .set({ drainedAt })
    .where(and(eq(relayEvents.userId, userId), eq(relayEvents.id, id)));
}

export async function deleteRelayEventsWithoutUser() {
  await getRelayDb().delete(relayEvents).where(isNull(relayEvents.userId));
}

export function closeRelayDb() {
  relaySqlite?.close();
  relaySqlite = null;
  relayDb = null;
}

export { relayEvents };
