import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "./index";
import { projects, skills } from "./schema";

export type SkillRow = typeof skills.$inferSelect;

/** Parsed shape exposed by the router/hooks — `triggerKeywords` deserialized from JSON. */
export type SkillRecord = Omit<SkillRow, "triggerKeywords"> & {
  triggerKeywords: string[];
};

export class SkillNameConflictError extends Error {
  constructor(name: string) {
    super(`A skill named "${name}" already exists in this scope`);
    this.name = "SkillNameConflictError";
  }
}

function toRecord(row: SkillRow): SkillRecord {
  let triggerKeywords: string[] = [];
  try {
    const parsed = JSON.parse(row.triggerKeywords);
    if (Array.isArray(parsed)) {
      triggerKeywords = parsed.filter(
        (value): value is string => typeof value === "string",
      );
    }
  } catch {
    triggerKeywords = [];
  }
  return { ...row, triggerKeywords };
}

export async function listGlobalSkills(userId: string): Promise<SkillRecord[]> {
  const rows = await db
    .select()
    .from(skills)
    .where(and(eq(skills.userId, userId), isNull(skills.projectId)))
    .orderBy(asc(skills.name));
  return rows.map(toRecord);
}

export async function listProjectSkills(
  userId: string,
  projectId: string,
): Promise<SkillRecord[]> {
  const rows = await db
    .select()
    .from(skills)
    .where(and(eq(skills.userId, userId), eq(skills.projectId, projectId)))
    .orderBy(asc(skills.name));
  return rows.map(toRecord);
}

/**
 * Returns the merged skill list that the Pi agent should see for a given
 * project: global skills for the user, plus project-scoped skills, with
 * project-scoped skills shadowing any global skill that shares a name.
 */
export async function listSkillsForAgent(
  userId: string,
  projectId: string,
): Promise<SkillRecord[]> {
  const rows = await db
    .select()
    .from(skills)
    .where(
      and(
        eq(skills.userId, userId),
        or(isNull(skills.projectId), eq(skills.projectId, projectId)),
      ),
    );

  const byName = new Map<string, SkillRow>();
  // Seed with globals first, then let project rows overwrite on collision.
  for (const row of rows) {
    if (row.projectId === null) byName.set(row.name, row);
  }
  for (const row of rows) {
    if (row.projectId === projectId) byName.set(row.name, row);
  }

  return Array.from(byName.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(toRecord);
}

export async function getSkill(
  userId: string,
  skillId: string,
): Promise<SkillRecord | null> {
  const [row] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.id, skillId), eq(skills.userId, userId)));
  return row ? toRecord(row) : null;
}

/**
 * Verifies a caller owns the project before touching a project-scoped skill.
 * Returns true for global skills (projectId === null) without a join.
 */
async function assertProjectOwnership(
  userId: string,
  projectId: string | null,
): Promise<void> {
  if (projectId === null) return;
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  if (!row) {
    throw new Error("Project not found or not owned by user");
  }
}

export async function createSkill(
  userId: string,
  input: {
    projectId: string | null;
    name: string;
    description: string;
    content?: string;
    triggerKeywords?: string[];
    disableModelInvocation?: boolean;
  },
): Promise<{ id: string }> {
  await assertProjectOwnership(userId, input.projectId);

  const id = nanoid();
  const now = new Date().toISOString();

  try {
    await db.insert(skills).values({
      id,
      userId,
      projectId: input.projectId,
      name: input.name,
      description: input.description,
      content: input.content ?? "",
      triggerKeywords: JSON.stringify(input.triggerKeywords ?? []),
      disableModelInvocation: input.disableModelInvocation ?? false,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("UNIQUE") &&
      (message.includes("skills_global_name_unique") ||
        message.includes("skills_project_name_unique"))
    ) {
      throw new SkillNameConflictError(input.name);
    }
    throw err;
  }

  return { id };
}

export async function updateSkill(
  userId: string,
  skillId: string,
  input: {
    name?: string;
    description?: string;
    content?: string;
    triggerKeywords?: string[];
    disableModelInvocation?: boolean;
  },
): Promise<void> {
  const values: Record<string, unknown> = {};

  if (input.name !== undefined) values.name = input.name;
  if (input.description !== undefined) values.description = input.description;
  if (input.content !== undefined) values.content = input.content;
  if (input.triggerKeywords !== undefined) {
    values.triggerKeywords = JSON.stringify(input.triggerKeywords);
  }
  if (input.disableModelInvocation !== undefined) {
    values.disableModelInvocation = input.disableModelInvocation;
  }

  if (Object.keys(values).length === 0) return;
  values.updatedAt = new Date().toISOString();

  try {
    await db
      .update(skills)
      .set(values)
      .where(and(eq(skills.id, skillId), eq(skills.userId, userId)));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("UNIQUE") &&
      (message.includes("skills_global_name_unique") ||
        message.includes("skills_project_name_unique"))
    ) {
      throw new SkillNameConflictError(input.name ?? "");
    }
    throw err;
  }
}

export async function deleteSkill(
  userId: string,
  skillId: string,
): Promise<void> {
  await db
    .delete(skills)
    .where(and(eq(skills.id, skillId), eq(skills.userId, userId)));
}

export async function countSkillsInProject(
  userId: string,
  projectId: string,
): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)` })
    .from(skills)
    .where(and(eq(skills.userId, userId), eq(skills.projectId, projectId)));
  return row?.value ?? 0;
}
