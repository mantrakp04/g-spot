import type {
  CreateProjectInput,
  PiAgentConfig,
  UpdateProjectInput,
} from "@g-spot/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { chatKeys, projectKeys } from "@/lib/query-keys";
import { setLastProjectId } from "@/lib/active-project";
import { trpcClient } from "@/utils/trpc";

export function useProjects() {
  return useQuery({
    queryKey: projectKeys.list(),
    queryFn: () => trpcClient.projects.list.query(),
  });
}

export function useProject(projectId: string | null) {
  return useQuery({
    queryKey: projectKeys.detail(projectId ?? ""),
    queryFn: () => trpcClient.projects.get.query({ id: projectId ?? "" }),
    enabled: !!projectId,
  });
}

export function useProjectChatCount(projectId: string | null) {
  return useQuery({
    queryKey: projectKeys.chatCount(projectId ?? ""),
    queryFn: () => trpcClient.projects.chatCount.query({ id: projectId ?? "" }),
    enabled: !!projectId,
  });
}

export function useCreateProjectMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      trpcClient.projects.create.mutate(input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.list() });
      setLastProjectId(data.id);
    },
  });
}

export function useUpdateProjectMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateProjectInput) =>
      trpcClient.projects.update.mutate(input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.list() });
      queryClient.invalidateQueries({
        queryKey: projectKeys.detail(variables.id),
      });
    },
  });
}

export function useUpdateProjectAgentConfigMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: string; agentConfig: PiAgentConfig }) =>
      trpcClient.projects.updateAgentConfig.mutate(input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.list() });
      queryClient.invalidateQueries({
        queryKey: projectKeys.detail(variables.id),
      });
    },
  });
}

export function useDeleteProjectMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: string; force?: boolean }) =>
      trpcClient.projects.delete.mutate(input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.list() });
      queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      // Best-effort: clear the last-used pointer if we just deleted it.
      if (typeof window !== "undefined") {
        const last = window.localStorage.getItem("gspot.lastProjectId");
        if (last === variables.id) setLastProjectId(null);
      }
    },
  });
}
