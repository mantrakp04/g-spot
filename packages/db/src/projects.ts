import { asc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "./index";
import { chats, projects } from "./schema";

export type ProjectRow = typeof projects.$inferSelect;

export class ProjectPathConflictError extends Error {
  constructor(path: string) {
    super(`A project with path ${path} already exists`);
    this.name = "ProjectPathConflictError";
  }
}

export async function listProjects(): Promise<ProjectRow[]> {
  return db
    .select()
    .from(projects)
    .orderBy(asc(projects.createdAt), asc(projects.id));
}

export async function getProject(
  projectId: string,
): Promise<ProjectRow | null> {
  const [row] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  return row ?? null;
}

export async function getProjectByPath(
  path: string,
): Promise<ProjectRow | null> {
  const [row] = await db
    .select()
    .from(projects)
    .where(eq(projects.path, path));
  return row ?? null;
}

export async function createProject(input: {
  name: string;
  path: string;
  customInstructions?: string | null;
  appendPrompt?: string | null;
  agentConfig?: string;
}): Promise<{ id: string }> {
  const id = nanoid();
  const now = new Date().toISOString();

  try {
    await db.insert(projects).values({
      id,
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
    if (message.includes("UNIQUE") && message.includes("projects_path_idx")) {
      throw new ProjectPathConflictError(input.path);
    }
    throw err;
  }

  return { id };
}

/**
 * NOTE: `path` is INTENTIONALLY absent from the input type so callers cannot
 * mutate it through this helper.
 */
export async function updateProject(
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

  if (Object.keys(values).length === 0) return;

  values.updatedAt = new Date().toISOString();

  await db.update(projects).set(values).where(eq(projects.id, projectId));
}

export async function updateProjectAgentConfig(
  projectId: string,
  agentConfigJson: string,
): Promise<void> {
  await db
    .update(projects)
    .set({
      agentConfig: agentConfigJson,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(projects.id, projectId));
}

export async function deleteProject(projectId: string): Promise<void> {
  await db.delete(projects).where(eq(projects.id, projectId));
}

export async function countChatsInProject(projectId: string): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)` })
    .from(chats)
    .where(eq(chats.projectId, projectId));
  return row?.value ?? 0;
}
