import { asc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "../index";
import { gmailLabels } from "../schema";
import type { GmailLabelRow } from "../schema/gmail";

/**
 * Idempotent label sync. Single bulk INSERT...ON CONFLICT DO UPDATE so we
 * don't have to round-trip per row. Uses the `(account_id, gmail_id)` unique
 * index as the conflict target.
 */
export async function syncLabels(
  accountId: string,
  labels: Array<{
    gmailId: string;
    name: string;
    type: "system" | "user";
    color?: string | null;
  }>,
): Promise<void> {
  if (labels.length === 0) return;
  const values = labels.map((label) => ({
    id: nanoid(),
    accountId,
    gmailId: label.gmailId,
    name: label.name,
    type: label.type,
    color: label.color ?? null,
  }));

  await db
    .insert(gmailLabels)
    .values(values)
    .onConflictDoUpdate({
      target: [gmailLabels.accountId, gmailLabels.gmailId],
      set: {
        name: sql`excluded.name`,
        type: sql`excluded.type`,
        color: sql`excluded.color`,
      },
    });
}

export async function getLabels(accountId: string): Promise<GmailLabelRow[]> {
  return db
    .select()
    .from(gmailLabels)
    .where(eq(gmailLabels.accountId, accountId))
    .orderBy(asc(gmailLabels.name));
}
