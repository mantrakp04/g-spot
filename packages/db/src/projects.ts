import { and, asc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "./index";
import { chats, projects } from "./schema";

export type ProjectRow = typeof projects.$inferSelect;

/**
 * Thrown when a path collides with an existing project for the same user.
 * The tRPC router translates this into a user-facing 409.
 */
export class ProjectPathConflictError extends Error {
  constructor(path: string) {
    super(`A project with path ${path} already exists`);
    this.name = "ProjectPathConflictError";
  }
}

export async function listProjects(userId: string): Promise<ProjectRow[]> {
  return db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(asc(projects.createdAt), asc(projects.id));
}

export async function getProject(
  userId: string,
  projectId: string,
): Promise<ProjectRow | null> {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  return row ?? null;
}

export async function getProjectByPath(
  userId: string,
  path: string,
): Promise<ProjectRow | null> {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.path, path)));
  return row ?? null;
}

export async function createProject(
  userId: string,
  input: {
    name: string;
    path: string;
    customInstructions?: string | null;
    appendPrompt?: string | null;
    /** JSON-stringified `PiAgentConfig`. Opaque here; parsed at the api layer. */
    agentConfig?: string;
  },
): Promise<{ id: string }> {
  const id = nanoid();
  const now = new Date().toISOString();

  try {
    await db.insert(projects).values({
      id,
      userId,
      name: input.name,
      path: input.path,
      customInstructions: input.customInstructions ?? null,
      appendPrompt: input.appendPrompt ?? null,
      agentConfig: input.agentConfig ?? "{}",
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("UNIQUE") &&
      message.includes("projects_user_path_idx")
    ) {
      throw new ProjectPathConflictError(input.path);
    }
    throw err;
  }

  return { id };
}

/**
 * NOTE: `path` is INTENTIONALLY absent from the input type. This is the
 * second line of defense behind the zod schema — even a caller that
 * bypasses the router cannot mutate the path through this helper.
 */
export async function updateProject(
  userId: string,
  projectId: string,
  input: {
    name?: string;
    customInstructions?: string | null;
    appendPrompt?: string | null;
  },
): Promise<void> {
  const values: Record<string, unknown> = {};

  if (input.name !== undefined) values.name = input.name;
  if (input.customInstructions !== undefined) {
    values.customInstructions = input.customInstructions;
  }
  if (input.appendPrompt !== undefined) {
    values.appendPrompt = input.appendPrompt;
  }

  if (Object.keys(values).length === 0) {
    return;
  }

  values.updatedAt = new Date().toISOString();

  await db
    .update(projects)
    .set(values)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
}

/**
 * Update just the per-project Pi agent config. Kept separate from
 * `updateProject` so its invocation sites make it obvious that agent_config
 * is being mutated (and so the stricter update input schema doesn't have to
 * accept a large JSON blob).
 */
export async function updateProjectAgentConfig(
  userId: string,
  projectId: string,
  agentConfigJson: string,
): Promise<void> {
  await db
    .update(projects)
    .set({
      agentConfig: agentConfigJson,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
}

export async function deleteProject(
  userId: string,
  projectId: string,
): Promise<void> {
  await db
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
}

export async function countChatsInProject(
  userId: string,
  projectId: string,
): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)` })
    .from(chats)
    .where(and(eq(chats.projectId, projectId), eq(chats.userId, userId)));
  return row?.value ?? 0;
}
