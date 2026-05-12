import { getChat } from "@g-spot/db/chat";
import { getProject } from "@g-spot/db/projects";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { publicProcedure, router } from "../index";
import {
  acceptBoth,
  acceptCurrent,
  acceptIncoming,
  addToGitignore,
  applyPatch,
  cleanUntracked,
  commit,
  createBranch,
  createWorktree,
  deleteBranch,
  discardAll,
  discardPaths,
  getCurrentBranch,
  getRepoState,
  getWorktreePath,
  gitFetch,
  gitPull,
  gitPush,
  gitReset,
  gitSync,
  lastCommitMessage,
  listChanges,
  listStashes,
  listWorkspaces,
  publishBranch,
  readCommitMessageDraft,
  readDiffSide,
  removeWorktree,
  stageAll,
  stagePaths,
  stashApply,
  stashDrop,
  stashPop,
  stashPush,
  unstageAll,
  unstagePaths,
  writeCommitMessageDraft,
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

  changes: publicProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ input }) => {
      const project = await getProject(input.projectId);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }
      return { changes: await listChanges(project.path) };
    }),

  fileDiff: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        path: z.string().min(1),
        /**
         * uncommitted = HEAD vs working tree (everything not in HEAD)
         * staged      = HEAD vs index
         * unstaged    = index vs working tree
         */
        mode: z.enum(["uncommitted", "staged", "unstaged"]).default("uncommitted"),
      }),
    )
    .query(async ({ input }) => {
      const project = await getProject(input.projectId);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }
      const cwd = project.path;
      const left =
        input.mode === "unstaged"
          ? await readDiffSide({ cwd, path: input.path, side: "index" })
          : await readDiffSide({ cwd, path: input.path, side: "head" });
      const right =
        input.mode === "staged"
          ? await readDiffSide({ cwd, path: input.path, side: "index" })
          : await readDiffSide({ cwd, path: input.path, side: "working" });
      return { left, right };
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

  // -------------------------------------------------------------------------
  // Source Control parity
  // -------------------------------------------------------------------------

  stage: publicProcedure
    .input(pathsInput())
    .mutation(async ({ input }) => {
      validatePaths(input.paths);
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        await stagePaths(cwd, input.paths);
      } catch (error) {
        throw asTRPC(error);
      }
      return { ok: true as const };
    }),

  unstage: publicProcedure
    .input(pathsInput())
    .mutation(async ({ input }) => {
      validatePaths(input.paths);
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        await unstagePaths(cwd, input.paths);
      } catch (error) {
        throw asTRPC(error);
      }
      return { ok: true as const };
    }),

  stageAll: publicProcedure
    .input(scopeInput())
    .mutation(async ({ input }) => {
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        await stageAll(cwd);
      } catch (error) {
        throw asTRPC(error);
      }
      return { ok: true as const };
    }),

  unstageAll: publicProcedure
    .input(scopeInput())
    .mutation(async ({ input }) => {
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        await unstageAll(cwd);
      } catch (error) {
        throw asTRPC(error);
      }
      return { ok: true as const };
    }),

  applyPatch: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        chatId: z.string().min(1).optional().nullable(),
        patch: z.string().min(1),
        cached: z.boolean().default(true),
        reverse: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }) => {
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        await applyPatch({
          cwd,
          patch: input.patch,
          cached: input.cached,
          reverse: input.reverse,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "git apply failed",
        });
      }
      return { ok: true as const };
    }),

  discard: publicProcedure
    .input(pathsInput())
    .mutation(async ({ input }) => {
      validatePaths(input.paths);
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        await discardPaths(cwd, input.paths);
      } catch (error) {
        throw asTRPC(error);
      }
      return { ok: true as const };
    }),

  discardAll: publicProcedure
    .input(scopeInput())
    .mutation(async ({ input }) => {
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        await discardAll(cwd);
      } catch (error) {
        throw asTRPC(error);
      }
      return { ok: true as const };
    }),

  cleanUntracked: publicProcedure
    .input(pathsInput())
    .mutation(async ({ input }) => {
      validatePaths(input.paths);
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        await cleanUntracked(cwd, input.paths);
      } catch (error) {
        throw asTRPC(error);
      }
      return { ok: true as const };
    }),

  acceptCurrent: publicProcedure
    .input(pathsInput())
    .mutation(async ({ input }) => {
      validatePaths(input.paths);
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        await acceptCurrent(cwd, input.paths);
      } catch (error) {
        throw asTRPC(error);
      }
      return { ok: true as const };
    }),

  acceptIncoming: publicProcedure
    .input(pathsInput())
    .mutation(async ({ input }) => {
      validatePaths(input.paths);
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        await acceptIncoming(cwd, input.paths);
      } catch (error) {
        throw asTRPC(error);
      }
      return { ok: true as const };
    }),

  acceptBoth: publicProcedure
    .input(pathsInput())
    .mutation(async ({ input }) => {
      validatePaths(input.paths);
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        await acceptBoth(cwd, input.paths);
      } catch (error) {
        throw asTRPC(error);
      }
      return { ok: true as const };
    }),

  commit: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        chatId: z.string().min(1).optional().nullable(),
        message: z.string().min(1),
        amend: z.boolean().default(false),
        signoff: z.boolean().default(false),
        all: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }) => {
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        const result = await commit({
          cwd,
          message: input.message,
          amend: input.amend,
          signoff: input.signoff,
          all: input.all,
        });
        return { ok: true as const, sha: result.sha };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "git commit failed",
        });
      }
    }),

  lastCommitMessage: publicProcedure
    .input(scopeInput())
    .query(async ({ input }) => {
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        return { message: await lastCommitMessage(cwd) };
      } catch (error) {
        throw asTRPC(error);
      }
    }),

  commitMessageDraft: publicProcedure
    .input(scopeInput())
    .query(async ({ input }) => {
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        return { draft: await readCommitMessageDraft(cwd) };
      } catch (error) {
        throw asTRPC(error);
      }
    }),

  setCommitMessageDraft: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        chatId: z.string().min(1).optional().nullable(),
        draft: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        await writeCommitMessageDraft(cwd, input.draft);
      } catch (error) {
        throw asTRPC(error);
      }
      return { ok: true as const };
    }),

  repoState: publicProcedure
    .input(scopeInput())
    .query(async ({ input }) => {
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        return await getRepoState(cwd);
      } catch (error) {
        throw asTRPC(error);
      }
    }),

  currentBranch: publicProcedure
    .input(scopeInput())
    .query(async ({ input }) => {
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        return await getCurrentBranch(cwd);
      } catch (error) {
        throw asTRPC(error);
      }
    }),

  fetch: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        chatId: z.string().min(1).optional().nullable(),
        remote: z.string().min(1).optional(),
        all: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        await gitFetch({
          cwd,
          remote: input.remote ?? null,
          all: input.all ?? !input.remote,
        });
      } catch (error) {
        throw asTRPC(error);
      }
      return { ok: true as const };
    }),

  pull: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        chatId: z.string().min(1).optional().nullable(),
        rebase: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        await gitPull({ cwd, rebase: input.rebase });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "git pull failed",
        });
      }
      return { ok: true as const };
    }),

  push: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        chatId: z.string().min(1).optional().nullable(),
        force: z.boolean().optional(),
        setUpstream: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        await gitPush({
          cwd,
          force: input.force,
          setUpstream: input.setUpstream,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "git push failed",
        });
      }
      return { ok: true as const };
    }),

  sync: publicProcedure
    .input(scopeInput())
    .mutation(async ({ input }) => {
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        await gitSync(cwd);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "git sync failed",
        });
      }
      return { ok: true as const };
    }),

  publishBranch: publicProcedure
    .input(scopeInput())
    .mutation(async ({ input }) => {
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        await publishBranch(cwd);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Failed to publish branch",
        });
      }
      return { ok: true as const };
    }),

  stashList: publicProcedure
    .input(scopeInput())
    .query(async ({ input }) => {
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        return { stashes: await listStashes(cwd) };
      } catch (error) {
        throw asTRPC(error);
      }
    }),

  stashPush: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        chatId: z.string().min(1).optional().nullable(),
        message: z.string().optional(),
        includeUntracked: z.boolean().optional(),
        keepIndex: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        await stashPush({
          cwd,
          message: input.message,
          includeUntracked: input.includeUntracked,
          keepIndex: input.keepIndex,
        });
      } catch (error) {
        throw asTRPC(error);
      }
      return { ok: true as const };
    }),

  stashPop: publicProcedure
    .input(stashIndexInput())
    .mutation(async ({ input }) => {
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        await stashPop(cwd, input.index);
      } catch (error) {
        throw asTRPC(error);
      }
      return { ok: true as const };
    }),

  stashApply: publicProcedure
    .input(stashIndexInput())
    .mutation(async ({ input }) => {
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        await stashApply(cwd, input.index);
      } catch (error) {
        throw asTRPC(error);
      }
      return { ok: true as const };
    }),

  stashDrop: publicProcedure
    .input(stashIndexInput())
    .mutation(async ({ input }) => {
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        await stashDrop(cwd, input.index);
      } catch (error) {
        throw asTRPC(error);
      }
      return { ok: true as const };
    }),

  addToGitignore: publicProcedure
    .input(pathsInput())
    .mutation(async ({ input }) => {
      validatePaths(input.paths);
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        await addToGitignore(cwd, input.paths);
      } catch (error) {
        throw asTRPC(error);
      }
      return { ok: true as const };
    }),

  reset: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          chatId: z.string().min(1).optional().nullable(),
          mode: z.enum(["soft", "mixed", "hard"]).default("mixed"),
          ref: z.string().default("HEAD"),
          confirm: z.literal(true).optional(),
        })
        .superRefine((val, ctx) => {
          if (val.mode === "hard" && val.confirm !== true) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Hard reset requires confirm: true",
              path: ["confirm"],
            });
          }
        }),
    )
    .mutation(async ({ input }) => {
      const { cwd } = await resolveGitCwd({
        projectId: input.projectId,
        chatId: input.chatId,
      });
      try {
        await gitReset({ cwd, mode: input.mode, ref: input.ref });
      } catch (error) {
        throw asTRPC(error);
      }
      return { ok: true as const };
    }),
});

function scopeInput() {
  return z.object({
    projectId: z.string().min(1),
    chatId: z.string().min(1).optional().nullable(),
  });
}

function pathsInput() {
  return z.object({
    projectId: z.string().min(1),
    chatId: z.string().min(1).optional().nullable(),
    paths: z.array(z.string().min(1)).min(1),
  });
}

function stashIndexInput() {
  return z.object({
    projectId: z.string().min(1),
    chatId: z.string().min(1).optional().nullable(),
    index: z.number().int().min(0),
  });
}

function validatePaths(paths: string[]): void {
  for (const p of paths) {
    if (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Path must be relative: ${p}`,
      });
    }
    const segments = p.split(/[/\\]/);
    if (segments.some((s) => s === "..")) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Path must not contain '..' segments: ${p}`,
      });
    }
  }
}

function asTRPC(error: unknown): TRPCError {
  if (error instanceof TRPCError) return error;
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: error instanceof Error ? error.message : "Unknown git error",
  });
}
