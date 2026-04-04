import { queryPersister } from "@/utils/query-persister";

export const staleWhileRevalidateQueryOptions = {
  staleTime: 0,
  refetchOnMount: "always" as const,
  refetchOnWindowFocus: "always" as const,
  refetchOnReconnect: "always" as const,
};

export const persistedStaleWhileRevalidateQueryOptions = {
  ...staleWhileRevalidateQueryOptions,
  // TanStack's persister option is still experimental and not inferred cleanly here.
  persister: queryPersister as any,
};
