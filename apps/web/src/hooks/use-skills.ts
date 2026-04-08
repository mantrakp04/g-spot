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
