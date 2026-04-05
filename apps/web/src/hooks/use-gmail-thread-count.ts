import { useQuery } from "@tanstack/react-query";
import type { FilterCondition } from "@g-spot/types/filters";
import type { OAuthConnection } from "@stackframe/react";

import { fetchBestEffortGmailThreadCount } from "@/lib/gmail/counts";
import { getOAuthToken } from "@/lib/oauth";
import { gmailKeys } from "@/lib/query-keys";
import { persistedStaleWhileRevalidateQueryOptions } from "@/utils/query-defaults";

export function useGmailThreadCount(
  sectionId: string,
  filters: FilterCondition[],
  account: OAuthConnection | null,
) {
  return useQuery({
    queryKey: gmailKeys.threadCount(sectionId, {
      accountId: account?.providerAccountId ?? null,
      filters,
    }),
    queryFn: async () => {
      const token = await getOAuthToken(account!);
      return fetchBestEffortGmailThreadCount(token, filters);
    },
    enabled: account != null,
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}
