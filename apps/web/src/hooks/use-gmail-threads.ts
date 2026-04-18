import { useInfiniteQuery } from "@tanstack/react-query";
import type { FilterCondition } from "@g-spot/types/filters";
import type { GmailThreadPage } from "@/lib/gmail/types";
import { gmailKeys } from "@/lib/query-keys";
import { trpcClient } from "@/utils/trpc";
import { persistedStaleWhileRevalidateQueryOptions } from "@/utils/query-defaults";

export function useGmailThreads(
  sectionId: string,
  filters: FilterCondition[],
  providerAccountId: string | null,
) {
  return useInfiniteQuery({
    queryKey: gmailKeys.threads(sectionId, {
      accountId: providerAccountId ?? null,
      filters,
    }),
    queryFn: async ({ pageParam }): Promise<GmailThreadPage> => {
      return trpcClient.gmail.getThreads.query({
        providerAccountId: providerAccountId!,
        filters,
        cursor: pageParam,
      });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextPageToken,
    enabled: providerAccountId != null,
    ...persistedStaleWhileRevalidateQueryOptions,
    // Infinite queries refetch every accumulated page on invalidation/focus,
    // so the aggressive SWR defaults are catastrophic for a 1000+ row inbox.
    // Keep data fresh for 30s and skip window-focus refetches; explicit
    // invalidations (e.g. after mutations) still go through invalidateGmailThreads.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
