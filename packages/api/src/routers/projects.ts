import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  countChatsInProject,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
  updateProjectAgentConfig,
} from "@g-spot/db/projects";
import {
  createProjectInputSchema,
  updateProjectAgentConfigInputSchema,
  updateProjectInputSchema,
  type Project,
} from "@g-spot/types";

import { publicProcedure, router } from "../index";
import {
  getPiAgentDefaults,
  normalizePiAgentConfig,
  normalizeStoredProjectAgentConfig,
} from "../lib/pi";
import {
  translateProjectError,
  validateProjectPath,
} from "../lib/projects";

/**
 * Attach the parsed `agentConfig` to a row returned from `@g-spot/db/projects`,
 * falling back to the user's Pi chat defaults when the project's stored config
 * is empty. Routers return `Project` (with a parsed `agentConfig`), not the
 * raw DB row — the web always consumes the parsed shape.
 */
function withParsedAgentConfig(
  row: NonNullable<Awaited<ReturnType<typeof getProject>>>,
  fallback: Parameters<typeof normalizeStoredProjectAgentConfig>[1],
): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    customInstructions: row.customInstructions,
    appendPrompt: row.appendPrompt,
    agentConfig: normalizeStoredProjectAgentConfig(row.agentConfig, fallback),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const projectsRouter = router({
  list: publicProcedure.query(async () => {
    const defaults = await getPiAgentDefaults();
    const rows = await listProjects();
    return rows.map((row) => withParsedAgentConfig(row, defaults.chat));
  }),

  get: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input }) => {
      const defaults = await getPiAgentDefaults();
      const project = await getProject(input.id);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }
      return withParsedAgentConfig(project, defaults.chat);
    }),

  create: publicProcedure
    .input(createProjectInputSchema)
    .mutation(async ({ input }) => {
      const canonicalPath = await validateProjectPath(input.path);
      const defaults = await getPiAgentDefaults();

      const seededConfig = JSON.stringify(
        normalizePiAgentConfig(defaults.chat),
      );

      try {
        const created = await createProject({
          name: input.name,
          path: canonicalPath,
          customInstructions: input.customInstructions ?? null,
          appendPrompt: input.appendPrompt ?? null,
          agentConfig: seededConfig,
        });
        return created;
      } catch (err) {
        throw translateProjectError(err);
      }
    }),

  update: publicProcedure
    .input(updateProjectInputSchema)
    .mutation(async ({ input }) => {
      const defaults = await getPiAgentDefaults();
      const existing = await getProject(input.id);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }
      await updateProject(input.id, {
        name: input.name,
        customInstructions: input.customInstructions,
        appendPrompt: input.appendPrompt,
      });
      const updated = await getProject(input.id);
      return withParsedAgentConfig(updated!, defaults.chat);
    }),

  updateAgentConfig: publicProcedure
    .input(updateProjectAgentConfigInputSchema)
    .mutation(async ({ input }) => {
      const existing = await getProject(input.id);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }
      const normalized = normalizePiAgentConfig(input.agentConfig);
      await updateProjectAgentConfig(
        input.id,
        JSON.stringify(normalized),
      );
      return { id: input.id, agentConfig: normalized };
    }),

  delete: publicProcedure
    .input(
      z.object({
        id: z.string().min(1),
        /**
         * When false (default), the call refuses to delete a project that
         * still owns chats. When true, the FK cascade silently drops chats
         * and their messages along with the project. The web UI passes
         * `force: true` only after a confirmation dialog.
         */
        force: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const existing = await getProject(input.id);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }
      const chatCount = await countChatsInProject(input.id);
      if (chatCount > 0 && !input.force) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Project has ${chatCount} chat${chatCount === 1 ? "" : "s"}. Pass force=true to delete it and all of its chats.`,
        });
      }
      await deleteProject(input.id);
      return { id: input.id, deletedChatCount: chatCount };
    }),

  chatCount: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input }) => {
      return countChatsInProject(input.id);
    }),
});
