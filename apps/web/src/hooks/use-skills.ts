import type {
  CreateSkillInput,
  UpdateSkillInput,
} from "@g-spot/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { skillsKeys } from "@/lib/query-keys";
import { trpcClient } from "@/utils/trpc";

export function useGlobalSkills() {
  return useQuery({
    queryKey: skillsKeys.global(),
    queryFn: () => trpcClient.skills.list.query({ projectId: null }),
  });
}

export function useProjectSkills(projectId: string | null) {
  return useQuery({
    queryKey: skillsKeys.project(projectId ?? ""),
    queryFn: () =>
      trpcClient.skills.list.query({ projectId: projectId ?? "" }),
    enabled: !!projectId,
  });
}

export function useSkill(skillId: string | null) {
  return useQuery({
    queryKey: skillsKeys.detail(skillId ?? ""),
    queryFn: () => trpcClient.skills.get.query({ id: skillId ?? "" }),
    enabled: !!skillId,
  });
}

function invalidateSkillScopes(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string | null,
) {
  if (projectId) {
    queryClient.invalidateQueries({ queryKey: skillsKeys.project(projectId) });
  } else {
    queryClient.invalidateQueries({ queryKey: skillsKeys.global() });
  }
}

export function useCreateSkillMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateSkillInput) =>
      trpcClient.skills.create.mutate(input),
    onSuccess: (_, variables) => {
      invalidateSkillScopes(queryClient, variables.projectId);
    },
  });
}

export function useUpdateSkillMutation(projectId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateSkillInput) =>
      trpcClient.skills.update.mutate(input),
    onSuccess: (_, variables) => {
      invalidateSkillScopes(queryClient, projectId);
      queryClient.invalidateQueries({
        queryKey: skillsKeys.detail(variables.id),
      });
    },
  });
}

export function useDeleteSkillMutation(projectId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: string }) =>
      trpcClient.skills.delete.mutate(input),
    onSuccess: () => {
      invalidateSkillScopes(queryClient, projectId);
    },
  });
}

/**
 * Search the public skills.sh directory via our tRPC proxy. Query must be at
 * least 2 chars (enforced by the remote API); shorter queries keep the hook
 * disabled so the UI can show an idle state instead of paging an error.
 */
export function useCatalogSearch(query: string, limit = 12) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: skillsKeys.catalogSearch(trimmed, limit),
    queryFn: () =>
      trpcClient.skills.searchCatalog.query({ query: trimmed, limit }),
    enabled: trimmed.length >= 2,
    staleTime: 60_000,
  });
}

export function usePopularCatalog(limit = 12, enabled = true) {
  return useQuery({
    queryKey: skillsKeys.catalogPopular(limit),
    queryFn: () => trpcClient.skills.popularCatalog.query({ limit }),
    enabled,
    staleTime: 60_000,
  });
}

export function useInstallSkillFromSourceMutation(projectId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { source: string; skillSlug: string }) =>
      trpcClient.skills.installFromSource.mutate({
        projectId,
        source: input.source,
        skillSlug: input.skillSlug,
      }),
    onSuccess: () => {
      invalidateSkillScopes(queryClient, projectId);
    },
  });
}
