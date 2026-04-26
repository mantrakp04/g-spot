import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { FilterRule } from "@g-spot/types/filters";

import { db } from "./index";
import { sections } from "./schema";

type PersistedColumnConfig = {
  id: string;
  visible: boolean;
  width: number | null;
  label?: string | null;
  headerAlign?: "left" | "center" | "right" | null;
  align?: "left" | "center" | "right" | null;
};

type SectionSource = "github_pr" | "github_issue" | "gmail";

export async function listSections() {
  return db.select().from(sections).orderBy(sections.position);
}

export async function createSection(input: {
  name: string;
  source: SectionSource;
  filters: FilterRule;
  showBadge: boolean;
  repos: string[];
  accountId: string | null;
  columns?: PersistedColumnConfig[];
}) {
  const [maxRow] = await db
    .select({
      maxPos: sql<number>`coalesce(max(${sections.position}), -1)`,
    })
    .from(sections);

  const position = (maxRow?.maxPos ?? -1) + 1;
  const id = nanoid();

  try {
    await db.insert(sections).values({
      id,
      name: input.name,
      source: input.source,
      filters: JSON.stringify(input.filters),
      repos: JSON.stringify(input.repos),
      columns: JSON.stringify(input.columns ?? []),
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

export async function updateSection(input: {
  id: string;
  name?: string;
  filters?: FilterRule;
  showBadge?: boolean;
  collapsed?: boolean;
  repos?: string[];
  accountId?: string | null;
  columns?: PersistedColumnConfig[];
}) {
  const { id, filters, repos, accountId, columns, ...rest } = input;
  const values: Record<string, unknown> = {};

  if (rest.name !== undefined) values.name = rest.name;
  if (rest.showBadge !== undefined) values.showBadge = rest.showBadge;
  if (rest.collapsed !== undefined) values.collapsed = rest.collapsed;
  if (filters !== undefined) values.filters = JSON.stringify(filters);
  if (repos !== undefined) values.repos = JSON.stringify(repos);
  if (accountId !== undefined) values.accountId = accountId;
  if (columns !== undefined) values.columns = JSON.stringify(columns);
  values.updatedAt = new Date().toISOString();

  await db.update(sections).set(values).where(eq(sections.id, id));
}

export async function deleteSection(id: string) {
  await db.delete(sections).where(eq(sections.id, id));
}

export async function reorderSections(orderedIds: string[]) {
  await db.transaction(async (tx) => {
    const now = new Date().toISOString();
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(sections)
        .set({ position: i, updatedAt: now })
        .where(eq(sections.id, orderedIds[i]!));
    }
  });
}
