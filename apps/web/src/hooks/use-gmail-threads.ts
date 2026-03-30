import { useInfiniteQuery } from "@tanstack/react-query";
import type { OAuthConnection } from "@stackframe/react";
import type { FilterCondition } from "@g-spot/api/schemas/section-filters";
import type { GmailThreadPage } from "@/lib/gmail/types";
import { searchGmailThreads } from "@/lib/gmail/api";
import { queryPersister } from "@/utils/query-persister";

export function useGmailThreads(
  sectionId: string,
  filters: FilterCondition[],
  account: OAuthConnection | null,
) {
  return useInfiniteQuery({
    queryKey: ["gmail", "threads", sectionId] as const,
    queryFn: async ({ pageParam }): Promise<GmailThreadPage> => {
      const tokenResult = await account!.getAccessToken();
      if (tokenResult.status === "error") {
        throw new Error("Failed to get Gmail access token");
      }
      return searchGmailThreads(
        tokenResult.data.accessToken,
        filters,
        pageParam,
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextPageToken,
    enabled: account != null,
    staleTime: 2 * 60 * 1000, // 2 min
    refetchOnMount: "always",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    persister: queryPersister as any,
  });
}
