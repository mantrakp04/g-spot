import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  countChatsInProject,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from "@g-spot/db/projects";
import {
  createProjectInputSchema,
  updateProjectInputSchema,
} from "@g-spot/types";

import { authedProcedure, router } from "../index";
import {
  translateProjectError,
  validateProjectPath,
} from "../lib/projects";

export const projectsRouter = router({
  list: authedProcedure.query(async ({ ctx }) => {
    return listProjects(ctx.userId);
  }),

  get: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const project = await getProject(ctx.userId, input.id);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }
      return project;
    }),

  create: authedProcedure
    .input(createProjectInputSchema)
    .mutation(async ({ ctx, input }) => {
      const canonicalPath = await validateProjectPath(ctx.userId, input.path);

      try {
        const created = await createProject(ctx.userId, {
          name: input.name,
          path: canonicalPath,
          customInstructions: input.customInstructions ?? null,
          appendPrompt: input.appendPrompt ?? null,
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
      return updated!;
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
