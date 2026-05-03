import { getProject } from "@g-spot/db/projects";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, router } from "../index";
import {
  listAllFiles,
  listDirectory,
  readFileText,
  writeFileText,
} from "../lib/fs";

async function resolveProjectPath(projectId: string): Promise<string> {
  const project = await getProject(projectId);
  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }
  return project.path;
}

function wrap<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((err) => {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: err instanceof Error ? err.message : String(err),
    });
  });
}

export const fsRouter = router({
  /** Children of a directory, lazy-loaded by the file tree. */
  list: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        path: z.string().default(""),
      }),
    )
    .query(async ({ input }) => {
      const projectPath = await resolveProjectPath(input.projectId);
      return wrap(listDirectory(projectPath, input.path));
    }),

  /** Flat list of every file path. Used by the Cmd+P fuzzy searcher. */
  listAll: publicProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ input }) => {
      const projectPath = await resolveProjectPath(input.projectId);
      const files = await wrap(listAllFiles(projectPath));
      return { files };
    }),

  read: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        path: z.string().min(1),
      }),
    )
    .query(async ({ input }) => {
      const projectPath = await resolveProjectPath(input.projectId);
      return wrap(readFileText(projectPath, input.path));
    }),

  write: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        path: z.string().min(1),
        content: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const projectPath = await resolveProjectPath(input.projectId);
      await wrap(writeFileText(projectPath, input.path, input.content));
      return { ok: true };
    }),
});
