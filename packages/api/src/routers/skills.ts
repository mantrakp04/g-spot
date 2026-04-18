import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { getProject } from "@g-spot/db/projects";
import {
  createSkillInputSchema,
  RESERVED_SKILL_NAMES,
  updateSkillInputSchema,
} from "@g-spot/types";

import {
  fetchSkillFromSource,
  listPopularCatalog,
  searchCatalog,
  SkillCatalogError,
} from "../lib/skill-catalog";
import {
  createSkill,
  deleteSkill,
  getSkill,
  listGlobalSkills,
  listProjectSkills,
  SkillNameConflictError,
  updateSkill,
} from "../lib/pi-skills";
import { publicProcedure, router } from "../index";

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
  if (err instanceof SkillCatalogError) {
    const codeMap: Record<
      SkillCatalogError["code"],
      "NOT_FOUND" | "BAD_REQUEST" | "BAD_GATEWAY"
    > = {
      SEARCH_FAILED: "BAD_GATEWAY",
      SOURCE_INVALID: "BAD_REQUEST",
      SOURCE_NOT_FOUND: "NOT_FOUND",
      SKILL_NOT_FOUND: "NOT_FOUND",
      FRONTMATTER_INVALID: "BAD_REQUEST",
      FETCH_FAILED: "BAD_GATEWAY",
    };
    return new TRPCError({ code: codeMap[err.code], message: err.message });
  }
  if (err instanceof TRPCError) return err;
  const message = err instanceof Error ? err.message : "Unknown skill error";
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
}

/**
 * The skills directory sometimes returns slugs that don't cleanly match our
 * `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` name regex (e.g. "frontend design",
 * "Convex Best Practices"). Coerce to a safe slug so imports don't bounce at
 * the Zod boundary. Empty output is rejected by the caller.
 */
function slugifySkillName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Trim a description to the Pi SDK limit while keeping a sentence boundary. */
function fitDescription(input: string): string {
  const MAX = 1024;
  const cleaned = input.replace(/\s+/g, " ").trim();
  if (cleaned.length <= MAX) return cleaned || "Imported skill.";
  const cut = cleaned.slice(0, MAX - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > MAX - 120 ? lastSpace : cut.length)}…`;
}

/**
 * Pick an available skill name in the target scope. If the preferred name is
 * reserved or already taken, append `-1`, `-2`, ... until we find a free
 * slot. This mirrors the "friendly collision handling" users get from other
 * package managers.
 */
async function pickAvailableSkillName(
  projectId: string | null,
  preferred: string,
): Promise<string> {
  const existing =
    projectId === null
      ? await listGlobalSkills()
      : await listProjectSkills(projectId);
  const taken = new Set<string>(existing.map((s) => s.name));
  const reserved = new Set<string>(RESERVED_SKILL_NAMES);

  const base = preferred || "skill";
  let candidate = base;
  let suffix = 1;
  while (taken.has(candidate) || reserved.has(candidate)) {
    const tail = `-${suffix++}`;
    candidate = `${base.slice(0, 64 - tail.length)}${tail}`;
    if (suffix > 50) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Could not find a free skill name near "${preferred}"`,
      });
    }
  }
  return candidate;
}

async function ensureProjectAccess(projectId: string | null): Promise<void> {
  if (projectId === null) return;
  const project = await getProject(projectId);
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
  list: publicProcedure
    .input(z.object({ projectId: z.string().min(1).nullable() }))
    .query(async ({ input }) => {
      if (input.projectId === null) {
        return listGlobalSkills();
      }
      await ensureProjectAccess(input.projectId);
      return listProjectSkills(input.projectId);
    }),

  get: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input }) => {
      const skill = await getSkill(input.id);
      if (!skill) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Skill not found" });
      }
      return skill;
    }),

  create: publicProcedure
    .input(createSkillInputSchema)
    .mutation(async ({ input }) => {
      ensureNotReserved(input.name);
      await ensureProjectAccess(input.projectId);
      try {
        return await createSkill({
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

  update: publicProcedure
    .input(updateSkillInputSchema)
    .mutation(async ({ input }) => {
      ensureNotReserved(input.name);
      const existing = await getSkill(input.id);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Skill not found" });
      }
      try {
        await updateSkill(input.id, {
          name: input.name,
          description: input.description,
          content: input.content,
          triggerKeywords: input.triggerKeywords,
          disableModelInvocation: input.disableModelInvocation,
        });
      } catch (err) {
        throw translateSkillError(err);
      }
      const updated = await getSkill(input.id);
      return updated!;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const existing = await getSkill(input.id);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Skill not found" });
      }
      await deleteSkill(input.id);
      return { id: input.id };
    }),

  /**
   * Proxy-search the public skills.sh directory. The remote API rejects
   * queries shorter than two characters, so we enforce the same lower
   * bound at the router boundary to fail fast.
   */
  searchCatalog: publicProcedure
    .input(
      z.object({
        query: z.string().min(2).max(128),
        limit: z.number().int().min(1).max(25).default(12),
      }),
    )
    .query(async ({ input }) => {
      try {
        return await searchCatalog(input.query, input.limit);
      } catch (err) {
        throw translateSkillError(err);
      }
    }),

  popularCatalog: publicProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(25).default(12),
      }),
    )
    .query(async ({ input }) => {
      try {
        return await listPopularCatalog(input.limit);
      } catch (err) {
        throw translateSkillError(err);
      }
    }),

  /**
   * Install a skill the user picked from the explorer. We pull the raw
   * SKILL.md from GitHub, parse its frontmatter, and persist it into the
   * user's skill table at the requested scope. Collisions and reserved
   * names are resolved by appending `-1`, `-2`, ... instead of failing —
   * the user explicitly chose to install this, and a hard failure would
   * be frustrating.
   */
  installFromSource: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1).nullable(),
        source: z.string().min(3).max(256),
        skillSlug: z.string().min(1).max(128),
      }),
    )
    .mutation(async ({ input }) => {
      await ensureProjectAccess(input.projectId);

      let fetched: Awaited<ReturnType<typeof fetchSkillFromSource>>;
      try {
        fetched = await fetchSkillFromSource(input.source, input.skillSlug);
      } catch (err) {
        throw translateSkillError(err);
      }

      const preferredRaw =
        slugifySkillName(fetched.name) || slugifySkillName(input.skillSlug);
      if (!preferredRaw) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Could not derive a valid skill name from "${fetched.name}"`,
        });
      }

      const finalName = await pickAvailableSkillName(
        input.projectId,
        preferredRaw,
      );

      try {
        const created = await createSkill({
          projectId: input.projectId,
          name: finalName,
          description: fitDescription(fetched.description),
          content: fetched.content.slice(0, 200_000),
          triggerKeywords: [],
          disableModelInvocation: false,
        });
        return {
          id: created.id,
          name: finalName,
          source: input.source,
          sourcePath: fetched.sourcePath,
          renamedFrom: finalName !== preferredRaw ? preferredRaw : null,
        };
      } catch (err) {
        throw translateSkillError(err);
      }
    }),
});
