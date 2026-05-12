import { useQuery } from "@tanstack/react-query";

import { gitKeys } from "@/lib/query-keys";
import { trpcClient } from "@/utils/trpc";

export function useChangesQuery(projectId: string) {
  return useQuery({
    queryKey: gitKeys.changes(projectId),
    queryFn: () => trpcClient.git.changes.query({ projectId }),
    refetchInterval: 5_000,
  });
}

export function useRepoStateQuery(projectId: string) {
  return useQuery({
    queryKey: gitKeys.repoState(projectId),
    queryFn: () => trpcClient.git.repoState.query({ projectId }),
    refetchInterval: 5_000,
  });
}

export function useCurrentBranchQuery(projectId: string) {
  return useQuery({
    queryKey: gitKeys.currentBranch(projectId),
    queryFn: () => trpcClient.git.currentBranch.query({ projectId }),
    refetchInterval: 10_000,
  });
}

export function useStashListQuery(projectId: string) {
  return useQuery({
    queryKey: gitKeys.stashList(projectId),
    queryFn: () => trpcClient.git.stashList.query({ projectId }),
  });
}

export function useCommitDraftQuery(projectId: string) {
  return useQuery({
    queryKey: gitKeys.commitDraft(projectId),
    queryFn: () => trpcClient.git.commitMessageDraft.query({ projectId }),
    staleTime: Infinity,
  });
}
