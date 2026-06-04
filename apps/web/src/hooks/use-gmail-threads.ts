import {
  type InfiniteData,
  type QueryPersister,
  useInfiniteQuery,
} from "@tanstack/react-query";
import type { FilterRule } from "@g-spot/types/filters";
import type { GmailThreadPage } from "@/lib/gmail/types";
import { gmailKeys } from "@/lib/query-keys";
import { trpcClient } from "@/utils/trpc";
import { persistedStaleWhileRevalidateQueryOptions } from "@/utils/query-defaults";

type ThreadsQueryKey = ReturnType<typeof gmailKeys.threads>;

export function useGmailThreads(
  sectionId: string,
  filters: FilterRule,
  providerAccountId: string | null,
) {
  // The shared persister is typed for non-infinite queries (TPageParam = never);
  // re-type it for this infinite query's page-param shape. Same function at runtime.
  const { persister, ...sharedOptions } = persistedStaleWhileRevalidateQueryOptions;
  const infinitePersister = persister as QueryPersister<
    GmailThreadPage,
    ThreadsQueryKey,
    string | null
  >;

  return useInfiniteQuery<
    GmailThreadPage,
    Error,
    InfiniteData<GmailThreadPage, string | null>,
    ThreadsQueryKey,
    string | null
  >({
    queryKey: gmailKeys.threads(sectionId, {
      accountId: providerAccountId ?? null,
      filters,
    }),
    queryFn: ({
      pageParam,
    }: {
      pageParam: string | null;
    }): Promise<GmailThreadPage> =>
      trpcClient.gmail.getThreads.query({
        providerAccountId,
        filters,
        cursor: pageParam,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: GmailThreadPage) => lastPage.nextPageToken,
    ...sharedOptions,
    persister: infinitePersister,
    // Infinite queries refetch every accumulated page on invalidation/focus,
    // so the aggressive SWR defaults are catastrophic for a 1000+ row inbox.
    // Keep data fresh for 30s and skip window-focus refetches; explicit
    // invalidations (e.g. after mutations) still go through invalidateGmailThreads.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
