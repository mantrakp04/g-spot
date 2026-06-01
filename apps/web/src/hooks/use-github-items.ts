import {
  type InfiniteData,
  type QueryPersister,
  useInfiniteQuery,
} from "@tanstack/react-query";
import type { OAuthConnection } from "@hexclave/react";
import type { FilterRule } from "@g-spot/types/filters";
import type { GitHubItemPage } from "@/lib/github/types";
import { searchGitHubItems } from "@/lib/github/api";
import { getConnectedAccountAccessToken } from "@/lib/connected-account";
import { githubKeys } from "@/lib/query-keys";
import { persistedStaleWhileRevalidateQueryOptions } from "@/utils/query-defaults";

type ItemsQueryKey = ReturnType<typeof githubKeys.items>;

const SOURCE_TO_ITEM_TYPE = {
  github_pr: "pr",
  github_issue: "issue",
} as const;

export function useGitHubItems(
  source: "github_pr" | "github_issue",
  sectionId: string,
  filters: FilterRule,
  account: OAuthConnection | null,
  repos?: string[],
  sortAsc?: boolean,
) {
  const itemType = SOURCE_TO_ITEM_TYPE[source];

  // The shared persister is typed for non-infinite queries (TPageParam = never);
  // re-type it for this infinite query's page-param shape. Same function at runtime.
  const { persister, ...sharedOptions } = persistedStaleWhileRevalidateQueryOptions;
  const infinitePersister = persister as QueryPersister<
    GitHubItemPage,
    ItemsQueryKey,
    string | null
  >;

  return useInfiniteQuery<
    GitHubItemPage,
    Error,
    InfiniteData<GitHubItemPage, string | null>,
    ItemsQueryKey,
    string | null
  >({
    queryKey: githubKeys.items(source, sectionId, {
      accountId: account?.providerAccountId ?? null,
      filters,
      repos: repos ?? [],
      sortAsc: sortAsc ?? false,
    }),
    queryFn: async ({ pageParam }): Promise<GitHubItemPage> => {
      const accessToken = account
        ? await getConnectedAccountAccessToken(account)
        : null;
      return searchGitHubItems(
        itemType,
        accessToken,
        filters,
        pageParam,
        repos,
        sortAsc,
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    ...sharedOptions,
    persister: infinitePersister,
  });
}
