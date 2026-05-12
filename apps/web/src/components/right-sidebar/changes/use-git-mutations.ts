import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { gitKeys } from "@/lib/query-keys";
import { trpcClient } from "@/utils/trpc";

export type ChangesQueryData = Awaited<
  ReturnType<typeof trpcClient.git.changes.query>
>;
export type ChangeEntry = ChangesQueryData["changes"][number];

type Invalidate = "changes" | "repoState" | "currentBranch" | "stashList";

function useInvalidate(projectId: string) {
  const qc = useQueryClient();
  return (which: Invalidate[]) => {
    for (const w of which) {
      const key =
        w === "changes"
          ? gitKeys.changes(projectId)
          : w === "repoState"
            ? gitKeys.repoState(projectId)
            : w === "currentBranch"
              ? gitKeys.currentBranch(projectId)
              : gitKeys.stashList(projectId);
      qc.invalidateQueries({ queryKey: key });
    }
  };
}

type OptimisticOpts<TVars> = {
  mutationFn: (vars: TVars) => Promise<unknown>;
  optimistic?: (prev: ChangesQueryData | undefined, vars: TVars) =>
    | ChangesQueryData
    | undefined;
  invalidate: Invalidate[];
  onSuccess?: () => void;
};

function useOptimisticChanges<TVars>(
  projectId: string,
  opts: OptimisticOpts<TVars>,
) {
  const qc = useQueryClient();
  const invalidate = useInvalidate(projectId);
  const key = gitKeys.changes(projectId);
  return useMutation({
    mutationFn: opts.mutationFn,
    onMutate: async (vars) => {
      if (!opts.optimistic) return { prev: undefined };
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ChangesQueryData>(key);
      const next = opts.optimistic(prev, vars);
      if (next) qc.setQueryData<ChangesQueryData>(key, next);
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx && "prev" in ctx && ctx.prev !== undefined) {
        qc.setQueryData<ChangesQueryData>(key, ctx.prev);
      }
      toast.error(err instanceof Error ? err.message : "Git operation failed");
    },
    onSuccess: () => {
      opts.onSuccess?.();
    },
    onSettled: () => {
      invalidate(opts.invalidate);
    },
  });
}

function applyStaged(
  prev: ChangesQueryData | undefined,
  paths: string[],
): ChangesQueryData | undefined {
  if (!prev) return prev;
  const set = new Set(paths);
  const changes = prev.changes
    .map((c) => {
      if (!set.has(c.path)) return c;
      // Move unstaged status to staged side; clear unstaged.
      const newStaged =
        c.unstaged !== "unknown" && c.unstaged !== "ignored"
          ? c.unstaged
          : c.staged;
      return {
        ...c,
        staged: newStaged,
        unstaged: "unknown" as const,
        code: `${codeChar(newStaged)} `,
      };
    })
    .filter((c) => c.staged !== "unknown" || c.unstaged !== "unknown");
  return { ...prev, changes };
}

function applyUnstaged(
  prev: ChangesQueryData | undefined,
  paths: string[],
): ChangesQueryData | undefined {
  if (!prev) return prev;
  const set = new Set(paths);
  const changes = prev.changes
    .map((c) => {
      if (!set.has(c.path)) return c;
      const newUnstaged =
        c.staged !== "unknown" && c.staged !== "ignored"
          ? c.staged
          : c.unstaged;
      return {
        ...c,
        staged: "unknown" as const,
        unstaged: newUnstaged,
        code: ` ${codeChar(newUnstaged)}`,
      };
    })
    .filter((c) => c.staged !== "unknown" || c.unstaged !== "unknown");
  return { ...prev, changes };
}

function applyDiscard(
  prev: ChangesQueryData | undefined,
  paths: string[],
): ChangesQueryData | undefined {
  if (!prev) return prev;
  const set = new Set(paths);
  return { ...prev, changes: prev.changes.filter((c) => !set.has(c.path)) };
}

function codeChar(status: ChangeEntry["staged"]): string {
  switch (status) {
    case "modified":
      return "M";
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "typeChanged":
      return "T";
    case "conflicted":
      return "U";
    case "untracked":
      return "?";
    case "ignored":
      return "!";
    default:
      return " ";
  }
}

export function useGitMutations(projectId: string) {
  const invalidate = useInvalidate(projectId);

  const stage = useOptimisticChanges<{ paths: string[] }>(projectId, {
    mutationFn: ({ paths }) => trpcClient.git.stage.mutate({ projectId, paths }),
    optimistic: (prev, { paths }) => applyStaged(prev, paths),
    invalidate: ["changes", "repoState"],
  });

  const unstage = useOptimisticChanges<{ paths: string[] }>(projectId, {
    mutationFn: ({ paths }) =>
      trpcClient.git.unstage.mutate({ projectId, paths }),
    optimistic: (prev, { paths }) => applyUnstaged(prev, paths),
    invalidate: ["changes", "repoState"],
  });

  const discard = useOptimisticChanges<{ paths: string[] }>(projectId, {
    mutationFn: ({ paths }) =>
      trpcClient.git.discard.mutate({ projectId, paths }),
    optimistic: (prev, { paths }) => applyDiscard(prev, paths),
    invalidate: ["changes", "repoState"],
  });

  const cleanUntracked = useOptimisticChanges<{ paths: string[] }>(projectId, {
    mutationFn: ({ paths }) =>
      trpcClient.git.cleanUntracked.mutate({ projectId, paths }),
    optimistic: (prev, { paths }) => applyDiscard(prev, paths),
    invalidate: ["changes", "repoState"],
  });

  const stageAll = useOptimisticChanges<void>(projectId, {
    mutationFn: () => trpcClient.git.stageAll.mutate({ projectId }),
    invalidate: ["changes", "repoState"],
  });

  const unstageAll = useOptimisticChanges<void>(projectId, {
    mutationFn: () => trpcClient.git.unstageAll.mutate({ projectId }),
    invalidate: ["changes", "repoState"],
  });

  const discardAll = useOptimisticChanges<void>(projectId, {
    mutationFn: () => trpcClient.git.discardAll.mutate({ projectId }),
    invalidate: ["changes", "repoState"],
  });

  const acceptCurrent = useOptimisticChanges<{ paths: string[] }>(projectId, {
    mutationFn: ({ paths }) =>
      trpcClient.git.acceptCurrent.mutate({ projectId, paths }),
    invalidate: ["changes", "repoState"],
  });

  const acceptIncoming = useOptimisticChanges<{ paths: string[] }>(projectId, {
    mutationFn: ({ paths }) =>
      trpcClient.git.acceptIncoming.mutate({ projectId, paths }),
    invalidate: ["changes", "repoState"],
  });

  const acceptBoth = useOptimisticChanges<{ paths: string[] }>(projectId, {
    mutationFn: ({ paths }) =>
      trpcClient.git.acceptBoth.mutate({ projectId, paths }),
    invalidate: ["changes", "repoState"],
  });

  const addToGitignore = useMutation({
    mutationFn: (paths: string[]) =>
      trpcClient.git.addToGitignore.mutate({ projectId, paths }),
    onSuccess: () => invalidate(["changes"]),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to ignore"),
  });

  const commit = useMutation({
    mutationFn: (vars: { message: string; amend?: boolean }) =>
      trpcClient.git.commit.mutate({
        projectId,
        message: vars.message,
        amend: vars.amend ?? false,
      }),
    onSuccess: () => invalidate(["changes", "repoState", "currentBranch"]),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Commit failed"),
  });

  const fetchRemote = useMutation({
    mutationFn: (vars: { all?: boolean } = {}) =>
      trpcClient.git.fetch.mutate({ projectId, all: vars.all }),
    onSuccess: () => invalidate(["currentBranch", "repoState"]),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Fetch failed"),
  });

  const pull = useMutation({
    mutationFn: (vars: { rebase?: boolean } = {}) =>
      trpcClient.git.pull.mutate({ projectId, rebase: vars.rebase }),
    onSuccess: () => invalidate(["changes", "repoState", "currentBranch"]),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Pull failed"),
  });

  const push = useMutation({
    mutationFn: (vars: { force?: boolean; setUpstream?: boolean } = {}) =>
      trpcClient.git.push.mutate({
        projectId,
        force: vars.force,
        setUpstream: vars.setUpstream,
      }),
    onSuccess: () => invalidate(["currentBranch"]),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Push failed"),
  });

  const sync = useMutation({
    mutationFn: () => trpcClient.git.sync.mutate({ projectId }),
    onSuccess: () => invalidate(["changes", "repoState", "currentBranch"]),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Sync failed"),
  });

  const publishBranch = useMutation({
    mutationFn: () => trpcClient.git.publishBranch.mutate({ projectId }),
    onSuccess: () => invalidate(["currentBranch"]),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Publish failed"),
  });

  const stashPush = useMutation({
    mutationFn: (vars: { message?: string; includeUntracked?: boolean }) =>
      trpcClient.git.stashPush.mutate({ projectId, ...vars }),
    onSuccess: () => invalidate(["changes", "repoState", "stashList"]),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Stash failed"),
  });

  const stashApply = useMutation({
    mutationFn: (index: number) =>
      trpcClient.git.stashApply.mutate({ projectId, index }),
    onSuccess: () => invalidate(["changes", "repoState", "stashList"]),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Stash apply failed"),
  });

  const stashPop = useMutation({
    mutationFn: (index: number) =>
      trpcClient.git.stashPop.mutate({ projectId, index }),
    onSuccess: () => invalidate(["changes", "repoState", "stashList"]),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Stash pop failed"),
  });

  const stashDrop = useMutation({
    mutationFn: (index: number) =>
      trpcClient.git.stashDrop.mutate({ projectId, index }),
    onSuccess: () => invalidate(["stashList"]),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Stash drop failed"),
  });

  const reset = useMutation({
    mutationFn: (vars: {
      mode: "soft" | "mixed" | "hard";
      ref?: string;
      confirm?: true;
    }) =>
      trpcClient.git.reset.mutate({
        projectId,
        mode: vars.mode,
        ref: vars.ref ?? "HEAD",
        ...(vars.mode === "hard" ? { confirm: true as const } : {}),
      }),
    onSuccess: () => invalidate(["changes", "repoState", "currentBranch"]),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Reset failed"),
  });

  const setDraft = useMutation({
    mutationFn: (draft: string) =>
      trpcClient.git.setCommitMessageDraft.mutate({ projectId, draft }),
  });

  return {
    stage,
    unstage,
    discard,
    cleanUntracked,
    stageAll,
    unstageAll,
    discardAll,
    acceptCurrent,
    acceptIncoming,
    acceptBoth,
    addToGitignore,
    commit,
    fetchRemote,
    pull,
    push,
    sync,
    publishBranch,
    stashPush,
    stashApply,
    stashPop,
    stashDrop,
    reset,
    setDraft,
  };
}

export type GitMutations = ReturnType<typeof useGitMutations>;
