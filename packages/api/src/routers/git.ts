import { getChat } from "@g-spot/db/chat";
import { getProject } from "@g-spot/db/projects";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, router } from "../index";
import {
  createBranch,
  createWorktree,
  deleteBranch,
  getWorktreePath,
  listWorkspaces,
  removeWorktree,
} from "../lib/git";
import { normalizeStoredChatAgentConfig } from "../lib/pi";

/**
 * Resolve the cwd to run git commands in for a given chat. The chat's `branch`
 * field is the single workspace identity: if it matches a worktree slug we
 * point at that worktree's path, otherwise we fall back to the project root.
 */
async function resolveGitCwd(args: {
  projectId: string;
  chatId?: string | null;
}) {
  const project = await getProject(args.projectId);
  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }

  if (!args.chatId) {
    return { project, chat: null, chatConfig: null, cwd: project.path };
  }

  const chat = await getChat(args.chatId);
  if (!chat || chat.projectId !== project.id) {
    return { project, chat: null, chatConfig: null, cwd: project.path };
  }

  const chatConfig = normalizeStoredChatAgentConfig(chat);
  const cwd = await resolveWorkspaceCwd(project.path, chatConfig.branch);
  return { project, chat, chatConfig, cwd };
}

async function resolveWorkspaceCwd(
  projectPath: string,
  branch: string | null,
): Promise<string> {
  if (!branch) return projectPath;
  const { workspaces } = await listWorkspaces(projectPath);
  const worktree = workspaces.find(
    (workspace) => workspace.kind === "worktree" && workspace.name === branch,
  );
  if (worktree && worktree.kind === "worktree") {
    return worktree.path;
  }
  return projectPath;
}

export const gitRouter = router({
  listWorkspaces: publicProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ input }) => {
      const project = await getProject(input.projectId);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }
      return listWorkspaces(project.path);
    }),

  createBranch: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        chatId: z.string().min(1).optional().nullable(),
        name: z.string().min(1).trim(),
        startPoint: z.string().min(1).trim().optional().nullable(),
        checkout: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input }) => {
      const context = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });

      await createBranch({
        cwd: context.cwd,
        name: input.name,
        startPoint: input.startPoint ?? null,
        checkout: input.checkout,
      });

      return { name: input.name };
    }),

  deleteBranch: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        name: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const project = await getProject(input.projectId);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      const { workspaces } = await listWorkspaces(project.path);
      const branchWorkspace = workspaces.find(
        (workspace) => workspace.kind === "branch" && workspace.name === input.name,
      );

      if (!branchWorkspace || branchWorkspace.kind !== "branch") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Branch not found" });
      }

      if (branchWorkspace.isProtected) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Can't delete the repo's base branch",
        });
      }

      if (branchWorkspace.isCurrent) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Can't delete the currently checked out branch",
        });
      }

      await deleteBranch({ cwd: project.path, name: input.name });
      return { name: input.name };
    }),

  createWorktree: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        baseBranch: z.string().min(1).trim().nullable(),
      }),
    )
    .mutation(async ({ input }) => {
      const project = await getProject(input.projectId);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      try {
        return await createWorktree({
          projectPath: project.path,
          baseBranch: input.baseBranch,
        });
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to create worktree",
        });
      }
    }),

  deleteWorktree: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        name: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const project = await getProject(input.projectId);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      await removeWorktree({ projectPath: project.path, name: input.name });
      return { name: input.name };
    }),

  worktreePath: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        name: z.string().min(1),
      }),
    )
    .query(async ({ input }) => {
      const project = await getProject(input.projectId);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }
      return { path: getWorktreePath(project.path, input.name) };
    }),
});
