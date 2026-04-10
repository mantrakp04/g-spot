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

import { authedProcedure, router } from "../index";
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
    userId: row.userId,
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
  list: authedProcedure.query(async ({ ctx }) => {
    const [rows, defaults] = await Promise.all([
      listProjects(ctx.userId),
      getPiAgentDefaults(ctx.userId),
    ]);
    return rows.map((row) => withParsedAgentConfig(row, defaults.chat));
  }),

  get: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const project = await getProject(ctx.userId, input.id);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }
      const defaults = await getPiAgentDefaults(ctx.userId);
      return withParsedAgentConfig(project, defaults.chat);
    }),

  create: authedProcedure
    .input(createProjectInputSchema)
    .mutation(async ({ ctx, input }) => {
      const canonicalPath = await validateProjectPath(ctx.userId, input.path);

      // Seed the project's `agent_config` from the user's current Pi chat
      // defaults so `/chat/settings` actually behaves as the "defaults for
      // new projects" the user configured. Subsequent project edits
      // decouple the per-project config from those defaults.
      const defaults = await getPiAgentDefaults(ctx.userId);
      const seededConfig = JSON.stringify(defaults.chat);

      try {
        const created = await createProject(ctx.userId, {
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

  update: authedProcedure
    .input(updateProjectInputSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await getProject(ctx.userId, input.id);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }
      await updateProject(ctx.userId, input.id, {
        name: input.name,
        customInstructions: input.customInstructions,
        appendPrompt: input.appendPrompt,
      });
      const updated = await getProject(ctx.userId, input.id);
      const defaults = await getPiAgentDefaults(ctx.userId);
      return withParsedAgentConfig(updated!, defaults.chat);
    }),

  updateAgentConfig: authedProcedure
    .input(updateProjectAgentConfigInputSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await getProject(ctx.userId, input.id);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }
      const normalized = normalizePiAgentConfig(input.agentConfig);
      await updateProjectAgentConfig(
        ctx.userId,
        input.id,
        JSON.stringify(normalized),
      );
      return { id: input.id, agentConfig: normalized };
    }),

  delete: authedProcedure
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
    .mutation(async ({ ctx, input }) => {
      const existing = await getProject(ctx.userId, input.id);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }
      const chatCount = await countChatsInProject(ctx.userId, input.id);
      if (chatCount > 0 && !input.force) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Project has ${chatCount} chat${chatCount === 1 ? "" : "s"}. Pass force=true to delete it and all of its chats.`,
        });
      }
      await deleteProject(ctx.userId, input.id);
      return { id: input.id, deletedChatCount: chatCount };
    }),

  chatCount: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return countChatsInProject(ctx.userId, input.id);
    }),
});
