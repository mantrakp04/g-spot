import { useMemo } from "react";

import type { OAuthConnection } from "@stackframe/react";
import { useQueries } from "@tanstack/react-query";

import type { FilterCondition, SectionSource } from "@g-spot/types/filters";

import {
  fetchGitHubFilterSuggestions,
  fetchGitHubUserSearch,
  type FilterSuggestionOption as GitHubFilterSuggestionOption,
} from "@/hooks/use-github-options";
import {
  fetchGmailFilterSuggestions,
  type FilterSuggestionOption as GmailFilterSuggestionOption,
} from "@/hooks/use-gmail-options";
import { getFieldConfig } from "@/lib/filter-fields";
import { githubKeys, gmailKeys } from "@/lib/query-keys";
import { persistedStaleWhileRevalidateQueryOptions } from "@/utils/query-defaults";

type FilterSuggestionOption =
  | GitHubFilterSuggestionOption
  | GmailFilterSuggestionOption;

type SuggestionState = {
  options?: FilterSuggestionOption[];
  isLoading: boolean;
};

/** Fields that support contextual suggestions, per GitHub source */
const GITHUB_SUGGESTION_FIELDS: Record<"github_pr" | "github_issue", Set<string>> = {
  github_pr: new Set([
    "author", "reviewer", "team_reviewer", "assignee", "mentions", "involves",
    "repo", "label", "milestone", "language", "head", "base",
  ]),
  github_issue: new Set([
    "author", "assignee", "mentions", "involves",
    "repo", "label", "milestone", "language",
  ]),
};

/** Fields where user search is overlaid on top of contextual suggestions */
const GITHUB_USER_SEARCH_FIELDS: Record<"github_pr" | "github_issue", Set<string>> = {
  github_pr: new Set(["author", "reviewer", "assignee", "mentions", "involves"]),
  github_issue: new Set(["author", "assignee", "mentions", "involves"]),
};

const GMAIL_SUGGESTION_FIELDS = new Set([
  "from", "to", "cc", "bcc", "deliveredto", "list", "subject", "filename",
]);

function getContextFilters(
  filters: FilterCondition[],
  index: number,
): FilterCondition[] {
  return filters.filter(
    (filter, filterIndex) =>
      filterIndex !== index && filter.value.trim().length > 0,
  );
}

function mergeOptions(
  primary: FilterSuggestionOption[] | undefined,
  fallback: FilterSuggestionOption[] | undefined,
): FilterSuggestionOption[] | undefined {
  const merged = [...(primary ?? []), ...(fallback ?? [])];
  if (merged.length === 0) return undefined;

  const seen = new Set<string>();
  const deduped: FilterSuggestionOption[] = [];

  for (const option of merged) {
    if (!option.value || seen.has(option.value)) continue;
    seen.add(option.value);
    deduped.push(option);
  }

  return deduped;
}

export function useSectionFilterSuggestions({
  source,
  account,
  filters,
  repos,
  searchQueries,
  repoOptions,
  githubLabelOptions,
  gmailLabelOptions,
}: {
  source: SectionSource;
  account: OAuthConnection | null;
  filters: FilterCondition[];
  repos: string[];
  searchQueries: string[];
  repoOptions?: FilterSuggestionOption[];
  githubLabelOptions?: FilterSuggestionOption[];
  gmailLabelOptions?: FilterSuggestionOption[];
}): SuggestionState[] {
  const contextualQueries = useQueries({
    queries: filters.map((condition, index) => {
      const fieldConfig = getFieldConfig(source, condition.field);
      const contextFilters = getContextFilters(filters, index);
      const searchQuery = searchQueries[index] ?? "";

      if (!account || fieldConfig?.valueType !== "combobox") {
        return {
          queryKey: ["filter-suggestions", source, condition.field, index, "disabled"],
          queryFn: async () => [] as FilterSuggestionOption[],
          enabled: false,
        };
      }

      // GitHub PR & Issue — unified path
      if (
        (source === "github_pr" || source === "github_issue") &&
        GITHUB_SUGGESTION_FIELDS[source].has(condition.field)
      ) {
        const itemType = source === "github_pr" ? "pr" as const : "issue" as const;
        const isUserField = GITHUB_USER_SEARCH_FIELDS[source].has(condition.field);

        return {
          queryKey: githubKeys.filterSuggestions(
            account.providerAccountId,
            source,
            condition.field,
            contextFilters,
            repos,
            isUserField ? searchQuery.trim().toLowerCase() : "",
          ),
          queryFn: async () => {
            const [contextualOptions, searchedUsers] = await Promise.all([
              fetchGitHubFilterSuggestions(
                itemType,
                account,
                condition.field,
                contextFilters,
                repos,
              ),
              isUserField && searchQuery.trim().length >= 2
                ? fetchGitHubUserSearch(account, searchQuery)
                : Promise.resolve([]),
            ]);

            return mergeOptions(contextualOptions, searchedUsers) ?? [];
          },
          enabled: true,
          ...persistedStaleWhileRevalidateQueryOptions,
        };
      }

      // Gmail
      if (source === "gmail" && GMAIL_SUGGESTION_FIELDS.has(condition.field)) {
        return {
          queryKey: gmailKeys.filterSuggestions(
            account.providerAccountId,
            condition.field,
            contextFilters,
          ),
          queryFn: () =>
            fetchGmailFilterSuggestions(
              account,
              condition.field as Parameters<typeof fetchGmailFilterSuggestions>[1],
              contextFilters,
            ),
          enabled: true,
          ...persistedStaleWhileRevalidateQueryOptions,
        };
      }

      return {
        queryKey: ["filter-suggestions", source, condition.field, index, "noop"],
        queryFn: async () => [] as FilterSuggestionOption[],
        enabled: false,
      };
    }),
  });

  return useMemo(
    () =>
      filters.map((condition, index) => {
        const contextual = contextualQueries[index];
        const fallbackOptions =
          source === "github_pr" || source === "github_issue"
            ? condition.field === "repo"
              ? repoOptions
              : condition.field === "label"
                ? githubLabelOptions
                : undefined
            : condition.field === "label"
              ? gmailLabelOptions
              : undefined;

        return {
          options: mergeOptions(contextual?.data, fallbackOptions),
          isLoading: Boolean(contextual?.isLoading || contextual?.isFetching),
        };
      }),
    [
      contextualQueries,
      filters,
      githubLabelOptions,
      gmailLabelOptions,
      repoOptions,
      searchQueries,
      source,
    ],
  );
}
