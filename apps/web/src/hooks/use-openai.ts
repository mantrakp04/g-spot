import { useCallback } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { openaiKeys } from "@/lib/query-keys";
import { persistedStaleWhileRevalidateQueryOptions } from "@/utils/query-defaults";
import { trpcClient } from "@/utils/trpc";

type OpenAIStatus = {
  connected: boolean;
};

export function useOpenAIStatus() {
  return useQuery({
    queryKey: openaiKeys.status(),
    queryFn: () => trpcClient.openai.status.query(),
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

export function useRefreshOpenAIStatus() {
  const queryClient = useQueryClient();

  return useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: openaiKeys.status(),
        exact: true,
      }),
    [queryClient],
  );
}

export function useInitiateOpenAIOAuthMutation() {
  return useMutation({
    mutationFn: () => trpcClient.openai.initiateAuth.mutate(),
  });
}

export function useSaveOpenAIApiKeyMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (apiKey: string) =>
      trpcClient.openai.saveKey.mutate({ apiKey }),
    onSuccess: (data) => {
      queryClient.setQueryData<OpenAIStatus>(openaiKeys.status(), {
        connected: data.connected,
      });
    },
  });
}

export function useDisconnectOpenAIMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => trpcClient.openai.disconnect.mutate(),
    onSuccess: (data) => {
      queryClient.setQueryData<OpenAIStatus>(openaiKeys.status(), {
        connected: data.connected,
      });
    },
  });
}
