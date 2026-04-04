import { useMutation } from "@tanstack/react-query";

import { trpcClient } from "@/utils/trpc";

export function useRemoveConnectionMutation() {
  return useMutation({
    mutationFn: (input: { provider: string; providerAccountId: string }) =>
      trpcClient.connections.remove.mutate(input),
  });
}
