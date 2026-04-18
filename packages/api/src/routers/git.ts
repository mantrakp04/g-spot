import { getProject } from "@g-spot/db/projects";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, router } from "../index";
import { createBranch, listBranches } from "../lib/git";

export const gitRouter = router({
  listBranches: publicProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ input }) => {
      const project = await getProject(input.projectId);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      return listBranches(project.path);
    }),

  currentBranch: publicProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ input }) => {
      const project = await getProject(input.projectId);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      const branches = await listBranches(project.path);
      return branches.current;
    }),

  createBranch: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        name: z.string().min(1).trim(),
        checkout: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input }) => {
      const project = await getProject(input.projectId);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      await createBranch({
        cwd: project.path,
        name: input.name,
        checkout: input.checkout,
      });
      return { name: input.name };
    }),
});
