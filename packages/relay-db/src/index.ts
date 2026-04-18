import { createClient, type Client } from "@libsql/client";
import { env } from "@g-spot/env/relay";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";

import { relayEvents, type RelayEventRow } from "./schema";

let relayClient: Client | null = null;
let relayDb: ReturnType<typeof drizzle> | null = null;

function getOrCreateClient() {
  if (!relayClient) {
    relayClient = createClient({
      url: env.DATABASE_URL,
    });
  }

  return relayClient;
}

function getRelayDb() {
  if (!relayDb) {
    relayDb = drizzle({
      client: getOrCreateClient(),
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
  relayClient?.close();
  relayClient = null;
  relayDb = null;
}

export { relayEvents };
