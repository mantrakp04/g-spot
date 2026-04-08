import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { getProject } from "@g-spot/db/projects";
import {
  createSkill,
  deleteSkill,
  getSkill,
  listGlobalSkills,
  listProjectSkills,
  SkillNameConflictError,
  updateSkill,
} from "@g-spot/db/skills";
import {
  createSkillInputSchema,
  RESERVED_SKILL_NAMES,
  updateSkillInputSchema,
} from "@g-spot/types";

import { authedProcedure, router } from "../index";

const RESERVED_SET = new Set<string>(RESERVED_SKILL_NAMES);

function ensureNotReserved(name: string | undefined) {
  if (!name) return;
  if (RESERVED_SET.has(name)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `"${name}" is reserved by a built-in slash command.`,
    });
  }
}

function translateSkillError(err: unknown): TRPCError {
  if (err instanceof SkillNameConflictError) {
    return new TRPCError({ code: "CONFLICT", message: err.message });
  }
  if (err instanceof TRPCError) return err;
  const message = err instanceof Error ? err.message : "Unknown skill error";
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
}

async function ensureProjectAccess(
  userId: string,
  projectId: string | null,
): Promise<void> {
  if (projectId === null) return;
  const project = await getProject(userId, projectId);
  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }
}

export const skillsRouter = router({
  /**
   * List skills filtered by scope:
   *   - `{ projectId: null }`     → user's global skills
   *   - `{ projectId: "<id>" }`    → that project's skills
   *
   * The merged-for-agent view (global + project, project-shadows-global) is
   * computed inside `pi.ts` from `listSkillsForAgent`, not exposed here.
   */
  list: authedProcedure
    .input(z.object({ projectId: z.string().min(1).nullable() }))
    .query(async ({ ctx, input }) => {
      if (input.projectId === null) {
        return listGlobalSkills(ctx.userId);
      }
      await ensureProjectAccess(ctx.userId, input.projectId);
      return listProjectSkills(ctx.userId, input.projectId);
    }),

  get: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const skill = await getSkill(ctx.userId, input.id);
      if (!skill) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Skill not found" });
      }
      return skill;
    }),

  create: authedProcedure
    .input(createSkillInputSchema)
    .mutation(async ({ ctx, input }) => {
      ensureNotReserved(input.name);
      await ensureProjectAccess(ctx.userId, input.projectId);
      try {
        return await createSkill(ctx.userId, {
          projectId: input.projectId,
          name: input.name,
          description: input.description,
          content: input.content,
          triggerKeywords: input.triggerKeywords,
          disableModelInvocation: input.disableModelInvocation,
        });
      } catch (err) {
        throw translateSkillError(err);
      }
    }),

  update: authedProcedure
    .input(updateSkillInputSchema)
    .mutation(async ({ ctx, input }) => {
      ensureNotReserved(input.name);
      const existing = await getSkill(ctx.userId, input.id);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Skill not found" });
      }
      try {
        await updateSkill(ctx.userId, input.id, {
          name: input.name,
          description: input.description,
          content: input.content,
          triggerKeywords: input.triggerKeywords,
          disableModelInvocation: input.disableModelInvocation,
        });
      } catch (err) {
        throw translateSkillError(err);
      }
      const updated = await getSkill(ctx.userId, input.id);
      return updated!;
    }),

  delete: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getSkill(ctx.userId, input.id);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Skill not found" });
      }
      await deleteSkill(ctx.userId, input.id);
      return { id: input.id };
    }),
});
