import type { QueryPersister } from "@tanstack/react-query";

import { queryPersister } from "@/utils/query-persister";

export const staleWhileRevalidateQueryOptions = {
  staleTime: 0,
  refetchOnMount: "always" as const,
  refetchOnWindowFocus: "always" as const,
  refetchOnReconnect: "always" as const,
};

export const persistedStaleWhileRevalidateQueryOptions = {
  ...staleWhileRevalidateQueryOptions,
  persister: queryPersister satisfies QueryPersister,
};
