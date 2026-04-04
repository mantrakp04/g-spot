import { eq, and, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "./index";
import { sections } from "./schema";

export async function listSections(userId: string) {
  return db
    .select()
    .from(sections)
    .where(eq(sections.userId, userId))
    .orderBy(sections.position);
}

export async function createSection(
  userId: string,
  input: {
    name: string;
    source: "github_pr" | "github_issue" | "gmail";
    filters: Array<{ field: string; operator: string; value: string; logic?: string }>;
    showBadge: boolean;
    repos: string[];
    accountId: string | null;
  },
) {
  const [maxRow] = await db
    .select({
      maxPos: sql<number>`coalesce(max(${sections.position}), -1)`,
    })
    .from(sections)
    .where(eq(sections.userId, userId));

  const position = (maxRow?.maxPos ?? -1) + 1;
  const id = nanoid();

  try {
    await db.insert(sections).values({
      id,
      userId,
      name: input.name,
      source: input.source,
      filters: JSON.stringify(input.filters),
      repos: JSON.stringify(input.repos),
      accountId: input.accountId,
      position,
      showBadge: input.showBadge,
    });
  } catch (err) {
    const cause = err instanceof Error ? err.cause ?? err.message : String(err);
    console.error("[createSection] insert failed:", cause, err);
    throw err;
  }

  return { id };
}

export async function updateSection(
  userId: string,
  input: {
    id: string;
    name?: string;
    filters?: Array<{ field: string; operator: string; value: string; logic?: string }>;
    showBadge?: boolean;
    collapsed?: boolean;
    repos?: string[];
    accountId?: string | null;
  },
) {
  const { id, filters, repos, accountId, ...rest } = input;
  const values: Record<string, unknown> = {};

  if (rest.name !== undefined) values.name = rest.name;
  if (rest.showBadge !== undefined) values.showBadge = rest.showBadge;
  if (rest.collapsed !== undefined) values.collapsed = rest.collapsed;
  if (filters !== undefined) values.filters = JSON.stringify(filters);
  if (repos !== undefined) values.repos = JSON.stringify(repos);
  if (accountId !== undefined) values.accountId = accountId;
  values.updatedAt = new Date().toISOString();

  await db
    .update(sections)
    .set(values)
    .where(and(eq(sections.id, id), eq(sections.userId, userId)));
}

export async function deleteSection(userId: string, id: string) {
  await db
    .delete(sections)
    .where(and(eq(sections.id, id), eq(sections.userId, userId)));
}

export async function reorderSections(userId: string, orderedIds: string[]) {
  await db.transaction(async (tx) => {
    const now = new Date().toISOString();
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(sections)
        .set({ position: i, updatedAt: now })
        .where(
          and(
            eq(sections.id, orderedIds[i]!),
            eq(sections.userId, userId),
          ),
        );
    }
  });
}
