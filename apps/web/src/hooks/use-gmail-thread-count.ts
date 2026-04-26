import { useQuery } from "@tanstack/react-query";
import type { FilterRule } from "@g-spot/types/filters";

import { gmailKeys } from "@/lib/query-keys";
import { trpcClient } from "@/utils/trpc";
import { persistedStaleWhileRevalidateQueryOptions } from "@/utils/query-defaults";

export function useGmailThreadCount(
  sectionId: string,
  filters: FilterRule,
  providerAccountId: string | null,
) {
  return useQuery({
    queryKey: gmailKeys.threadCount(sectionId, {
      accountId: providerAccountId ?? null,
      filters,
    }),
    queryFn: () =>
      trpcClient.gmail.getThreadCount.query({
        providerAccountId: providerAccountId!,
        filters,
      }),
    enabled: providerAccountId != null,
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}
