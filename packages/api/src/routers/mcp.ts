import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { getProject } from "@g-spot/db/projects";

import { publicProcedure, router } from "../index";
import {
  loadGlobalMcps,
  reloadProjectMcps,
  snapshotMcpServers,
} from "../lib/mcp/manager";

export const mcpRouter = router({
  list: publicProcedure.query(() => snapshotMcpServers()),

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
});
