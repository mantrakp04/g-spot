import { eq } from "drizzle-orm";

import { db } from "./index";
import { piState, PI_STATE_SINGLETON_ID } from "./schema/pi";

export type PiStateUpdate = Partial<{
  chatDefaults: string;
  workerDefaults: string;
  credentials: string;
}>;

export async function getPiState() {
  const [row] = await db
    .select()
    .from(piState)
    .where(eq(piState.id, PI_STATE_SINGLETON_ID));

  return row ?? null;
}

export async function upsertPiState(update: PiStateUpdate): Promise<void> {
  const existing = await getPiState();
  const now = new Date().toISOString();

  if (existing) {
    await db
      .update(piState)
      .set({
        ...update,
        updatedAt: now,
      })
      .where(eq(piState.id, PI_STATE_SINGLETON_ID));
    return;
  }

  await db.insert(piState).values({
    id: PI_STATE_SINGLETON_ID,
    chatDefaults: update.chatDefaults ?? "{}",
    workerDefaults: update.workerDefaults ?? "{}",
    credentials: update.credentials ?? "{}",
    createdAt: now,
    updatedAt: now,
  });
}
