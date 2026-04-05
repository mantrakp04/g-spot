import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryPersister } from "@/utils/query-persister";

const QUERY_KEY = ["settings", "link-warning-dismissed"] as const;

export function useLinkWarningDismissed() {
  const queryClient = useQueryClient();

  const { data: dismissed = false } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => false,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    persister: queryPersister as any,
  });

  const dismiss = () => {
    queryClient.setQueryData(QUERY_KEY, true);
  };

  const reset = () => {
    queryClient.setQueryData(QUERY_KEY, false);
  };

  return { dismissed, dismiss, reset } as const;
}
