import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { getProject } from "@g-spot/db/projects";
import { mcpConfigSchema } from "@g-spot/types";

import { publicProcedure, router } from "../index";
import {
  getMcpConfigForTarget,
  loadGlobalMcps,
  reloadProjectMcps,
  snapshotMcpServers,
  writeMcpConfig,
  type ConfigTarget,
} from "../lib/mcp/manager";

const targetInputSchema = z.union([
  z.object({ scope: z.literal("global") }),
  z.object({
    scope: z.literal("project"),
    projectId: z.string().min(1),
  }),
]);

async function resolveTarget(
  input: z.infer<typeof targetInputSchema>,
): Promise<ConfigTarget> {
  if (input.scope === "global") {
    return { scope: "global" };
  }
  const project = await getProject(input.projectId);
  if (!project) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Project not found",
    });
  }
  return {
    scope: "project",
    projectId: project.id,
    projectPath: project.path,
  };
}

export const mcpRouter = router({
  list: publicProcedure.query(() => snapshotMcpServers()),

  getConfig: publicProcedure
    .input(z.object({ target: targetInputSchema }))
    .query(async ({ input }) => {
      const target = await resolveTarget(input.target);
      return getMcpConfigForTarget(target);
    }),

  reloadGlobal: publicProcedure.mutation(async () => {
    await loadGlobalMcps();
    return snapshotMcpServers();
  }),

  reloadProject: publicProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const project = await getProject(input.projectId);
      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }
      await reloadProjectMcps({
        projectId: project.id,
        projectPath: project.path,
      });
      return snapshotMcpServers();
    }),

  /**
   * Replace the on-disk `.mcp.json` for the given target with the user's
   * edited JSON. The raw text is parsed + Zod-validated server-side; if it
   * doesn't conform to the standard `mcpServers` shape, the write is rejected
   * with a TRPCError carrying the issues for the editor to display.
   */
  saveRawConfig: publicProcedure
    .input(
      z.object({
        target: targetInputSchema,
        raw: z.string().max(1_000_000),
      }),
    )
    .mutation(async ({ input }) => {
      const target = await resolveTarget(input.target);

      // An empty document is allowed and treated as "no servers".
      const trimmed = input.raw.trim();
      const sourceText = trimmed.length === 0 ? "{}" : trimmed;

      let parsed: unknown;
      try {
        parsed = JSON.parse(sourceText);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? `Invalid JSON: ${error.message}`
              : "Invalid JSON",
        });
      }

      const candidate =
        parsed && typeof parsed === "object" && "mcpServers" in parsed
          ? parsed
          : { mcpServers: parsed };

      const result = mcpConfigSchema.safeParse(candidate);
      if (!result.success) {
        const issues = result.error.issues
          .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
          .join("; ");
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `mcpServers schema mismatch — ${issues}`,
        });
      }

      await writeMcpConfig({ target, config: result.data });
      return snapshotMcpServers();
    }),
});
