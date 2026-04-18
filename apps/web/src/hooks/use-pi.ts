import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { piKeys } from "@/lib/query-keys";
import { trpcClient } from "@/utils/trpc";

export function usePiCatalog(enabled = true) {
  return useQuery({
    queryKey: piKeys.catalog(),
    queryFn: () => trpcClient.pi.catalog.query(),
    enabled,
  });
}

export function usePiDefaults() {
  return useQuery({
    queryKey: piKeys.defaults(),
    queryFn: () => trpcClient.pi.defaults.query(),
  });
}

export function useUpdatePiDefaultsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      chat?: Awaited<ReturnType<typeof trpcClient.pi.defaults.query>>["chat"];
      worker?: Awaited<ReturnType<typeof trpcClient.pi.defaults.query>>["worker"];
    }) => trpcClient.pi.updateDefaults.mutate(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: piKeys.defaults() }),
        queryClient.invalidateQueries({ queryKey: piKeys.catalog() }),
      ]);
    },
  });
}

export function usePiAddons(projectId: string | null) {
  return useQuery({
    queryKey: piKeys.addons(projectId),
    queryFn: () => trpcClient.pi.listAddons.query({ projectId }),
  });
}

export function useInstallPiAddonMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { projectId: string | null; source: string }) =>
      trpcClient.pi.installAddon.mutate(input),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: piKeys.addons(variables.projectId),
      });
    },
  });
}

export function useRemovePiAddonMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { projectId: string | null; source: string }) =>
      trpcClient.pi.removeAddon.mutate(input),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: piKeys.addons(variables.projectId),
      });
    },
  });
}

export function useSavePiCredentialMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { provider: string; apiKey: string }) =>
      trpcClient.pi.saveApiKey.mutate(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: piKeys.catalog() });
    },
  });
}

export function useRemovePiCredentialMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (provider: string) =>
      trpcClient.pi.removeCredential.mutate({ provider }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: piKeys.catalog() });
    },
  });
}

export function usePopularPiCatalog(limit = 24, enabled = true) {
  return useQuery({
    queryKey: piKeys.addonCatalogPopular(limit),
    queryFn: () => trpcClient.pi.popularCatalog.query({ limit }),
    enabled,
    staleTime: 60_000,
  });
}

export function usePiCatalogSearch(query: string, limit = 24) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: piKeys.addonCatalogSearch(trimmed, limit),
    queryFn: () =>
      trpcClient.pi.searchCatalog.query({ query: trimmed, limit }),
    enabled: trimmed.length >= 1,
    staleTime: 60_000,
  });
}
