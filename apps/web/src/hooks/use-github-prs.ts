import { useInfiniteQuery } from "@tanstack/react-query";
import type { OAuthConnection } from "@stackframe/react";
import type { FilterCondition } from "@g-spot/api/schemas/section-filters";
import type { GitHubPRPage } from "@/lib/github/types";
import { searchGitHubPRs } from "@/lib/github/api";
import { queryPersister } from "@/utils/query-persister";

export function useGitHubPRs(
  sectionId: string,
  filters: FilterCondition[],
  account: OAuthConnection | null,
  repos?: string[],
  sortAsc?: boolean,
) {
  return useInfiniteQuery({
    queryKey: ["github", "prs", sectionId, { sortAsc }] as const,
    queryFn: async ({ pageParam }): Promise<GitHubPRPage> => {
      const tokenResult = await account!.getAccessToken();
      if (tokenResult.status === "error") {
        throw new Error("Failed to get GitHub access token");
      }
      return searchGitHubPRs(
        tokenResult.data.accessToken,
        filters,
        pageParam,
        repos,
        sortAsc,
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: account != null,
    staleTime: 2 * 60 * 1000, // 2 min
    refetchOnMount: "always",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    persister: queryPersister as any,
  });
}
