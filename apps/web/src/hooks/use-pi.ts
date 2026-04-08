import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { piKeys } from "@/lib/query-keys";
import { trpcClient } from "@/utils/trpc";

export function usePiCatalog() {
  return useQuery({
    queryKey: piKeys.catalog(),
    queryFn: () => trpcClient.pi.catalog.query(),
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
