import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { mcpKeys } from "@/lib/query-keys";
import { trpcClient } from "@/utils/trpc";

export type McpTargetInput =
  | { scope: "global" }
  | { scope: "project"; projectId: string };

export function useMcpList() {
  return useQuery({
    queryKey: mcpKeys.list(),
    queryFn: () => trpcClient.mcp.list.query(),
    refetchInterval: 5_000,
  });
}

function useInvalidateMcpList() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: mcpKeys.list() });
    queryClient.invalidateQueries({ queryKey: ["mcp", "config"] });
  };
}

export function useMcpConfig(target: McpTargetInput) {
  const scopeKey = target.scope === "global" ? "global" : target.projectId;
  return useQuery({
    queryKey: mcpKeys.config(scopeKey),
    queryFn: () => trpcClient.mcp.getConfig.query({ target }),
  });
}

export function useReloadGlobalMcpsMutation() {
  const invalidate = useInvalidateMcpList();
  return useMutation({
    mutationFn: () => trpcClient.mcp.reloadGlobal.mutate(),
    onSuccess: invalidate,
  });
}

export function useReloadProjectMcpsMutation() {
  const invalidate = useInvalidateMcpList();
  return useMutation({
    mutationFn: (projectId: string) =>
      trpcClient.mcp.reloadProject.mutate({ projectId }),
    onSuccess: invalidate,
  });
}

export function useSaveRawConfigMutation() {
  const invalidate = useInvalidateMcpList();
  return useMutation({
    mutationFn: (input: { target: McpTargetInput; raw: string }) =>
      trpcClient.mcp.saveRawConfig.mutate(input),
    onSuccess: invalidate,
  });
}
