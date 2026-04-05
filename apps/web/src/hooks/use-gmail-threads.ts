import { useInfiniteQuery } from "@tanstack/react-query";
import type { OAuthConnection } from "@stackframe/react";
import type { FilterCondition } from "@g-spot/types/filters";
import type { GmailThreadPage } from "@/lib/gmail/types";
import { searchGmailThreads } from "@/lib/gmail/api";
import { getOAuthToken } from "@/lib/oauth";
import { gmailKeys } from "@/lib/query-keys";
import { persistedStaleWhileRevalidateQueryOptions } from "@/utils/query-defaults";

export function useGmailThreads(
  sectionId: string,
  filters: FilterCondition[],
  account: OAuthConnection | null,
) {
  return useInfiniteQuery({
    queryKey: gmailKeys.threads(sectionId, {
      accountId: account?.providerAccountId ?? null,
      filters,
    }),
    queryFn: async ({ pageParam }): Promise<GmailThreadPage> => {
      const token = await getOAuthToken(account!);
      return searchGmailThreads(token, filters, pageParam);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextPageToken,
    enabled: account != null,
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}
