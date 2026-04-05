import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { AppRouter } from "@g-spot/api/routers/index";

import { gmailKeys, githubKeys, sectionsKeys } from "@/lib/query-keys";
import { trpc, trpcClient } from "@/utils/trpc";
import { persistedStaleWhileRevalidateQueryOptions } from "@/utils/query-defaults";

type RouterInputs = inferRouterInputs<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;
type SectionRecord = RouterOutputs["sections"]["list"][number];

type CreateSectionInput = RouterInputs["sections"]["create"];
type UpdateSectionInput = RouterInputs["sections"]["update"];
type ReorderSectionsInput = RouterInputs["sections"]["reorder"];
type ReorderSectionsMutationInput = ReorderSectionsInput & {
  nextSections: SectionRecord[];
};

function invalidateSectionDerivedData(
  queryClient: ReturnType<typeof useQueryClient>,
  sectionId?: string,
) {
  if (!sectionId) return Promise.resolve();

  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: githubKeys.prsSection(sectionId),
    }),
    queryClient.invalidateQueries({
      queryKey: githubKeys.issuesSection(sectionId),
    }),
    queryClient.invalidateQueries({
      queryKey: gmailKeys.threadsSection(sectionId),
    }),
  ]);
}

function affectsSectionDerivedData(input: UpdateSectionInput) {
  return input.filters !== undefined
    || input.repos !== undefined
    || input.accountId !== undefined;
}

function patchSectionList(
  sections: SectionRecord[] | undefined,
  input: UpdateSectionInput,
) {
  if (!sections) return sections;

  return sections.map((section) =>
    section.id === input.id
      ? {
          ...section,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.filters !== undefined
            ? { filters: JSON.stringify(input.filters) }
            : {}),
          ...(input.showBadge !== undefined
            ? { showBadge: input.showBadge }
            : {}),
          ...(input.collapsed !== undefined
            ? { collapsed: input.collapsed }
            : {}),
          ...(input.repos !== undefined ? { repos: JSON.stringify(input.repos) } : {}),
          ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
          ...(input.columns !== undefined ? { columns: JSON.stringify(input.columns) } : {}),
        }
      : section,
  );
}

export function useSections() {
  return useQuery({
    ...trpc.sections.list.queryOptions(),
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

export function useReorderSectionsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ orderedIds }: ReorderSectionsMutationInput) =>
      trpcClient.sections.reorder.mutate({ orderedIds }),
    onMutate: async (variables: ReorderSectionsMutationInput) => {
      await queryClient.cancelQueries({
        queryKey: sectionsKeys.list(),
        exact: true,
      });

      const previousSections = queryClient.getQueryData<SectionRecord[]>(
        sectionsKeys.list(),
      );

      queryClient.setQueryData(sectionsKeys.list(), variables.nextSections);

      return { previousSections };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousSections) {
        queryClient.setQueryData(sectionsKeys.list(), context.previousSections);
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: sectionsKeys.list(),
        exact: true,
      });
    },
  });
}

export function useCreateSectionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateSectionInput) =>
      trpcClient.sections.create.mutate(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: sectionsKeys.list(),
        exact: true,
      });
    },
  });
}

export function useUpdateSectionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateSectionInput) =>
      trpcClient.sections.update.mutate(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        queryKey: sectionsKeys.list(),
        exact: true,
      });

      const previousSections = queryClient.getQueryData<SectionRecord[]>(
        sectionsKeys.list(),
      );

      queryClient.setQueryData<SectionRecord[]>(
        sectionsKeys.list(),
        (current) => patchSectionList(current, input),
      );

      return { previousSections };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousSections) {
        queryClient.setQueryData(sectionsKeys.list(), context.previousSections);
      }
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: sectionsKeys.list(),
        exact: true,
      });

      if (affectsSectionDerivedData(variables)) {
        void invalidateSectionDerivedData(queryClient, variables.id);
      }
    },
  });
}

export function useDeleteSectionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => trpcClient.sections.delete.mutate({ id }),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: githubKeys.prsSection(id) });
      queryClient.removeQueries({ queryKey: githubKeys.issuesSection(id) });
      queryClient.removeQueries({ queryKey: gmailKeys.threadsSection(id) });

      void queryClient.invalidateQueries({
        queryKey: sectionsKeys.list(),
        exact: true,
      });
    },
  });
}
