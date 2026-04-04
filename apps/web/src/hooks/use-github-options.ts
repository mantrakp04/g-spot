import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Octokit } from "octokit";
import type { OAuthConnection } from "@stackframe/react";
import type { FilterCondition } from "@g-spot/types/filters";

import { buildGitHubSearchQuery, type GitHubItemType } from "@/lib/github/api";
import { getOAuthToken } from "@/lib/oauth";
import { githubKeys } from "@/lib/query-keys";
import { persistedStaleWhileRevalidateQueryOptions } from "@/utils/query-defaults";

// ─── Repo Search ────────────────────────────────────────────────────────────

export type RepoOption = {
  value: string;
  label: string;
  ownerAvatar: string;
  description: string;
  isPrivate: boolean;
};

export type RepoPage = {
  repos: RepoOption[];
  nextPage: number | null;
};

const REPO_PAGE_SIZE = 30;

function buildGitHubRepoSearchQuery(query: string): string {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return "";
  return trimmedQuery.includes("/") ? trimmedQuery : `${trimmedQuery} in:name`;
}

function toRepoOption(repo: {
  full_name: string;
  owner: { avatar_url: string } | null;
  description: string | null;
  private: boolean;
}): RepoOption {
  return {
    value: repo.full_name,
    label: repo.full_name,
    ownerAvatar: repo.owner?.avatar_url ?? "",
    description: repo.description ?? "",
    isPrivate: repo.private,
  };
}

export function useGitHubRepoSearch(
  account: OAuthConnection | null,
  query: string,
) {
  const normalizedQuery = query.trim();

  return useInfiniteQuery({
    queryKey: githubKeys.repoSearch(account?.providerAccountId, normalizedQuery),
    queryFn: async ({ pageParam }): Promise<RepoPage> => {
      const token = await getOAuthToken(account!);
      const octokit = new Octokit({ auth: token });

      if (normalizedQuery.endsWith("/")) {
        return fetchOwnerRepos(octokit, normalizedQuery.slice(0, -1), pageParam);
      }

      if (normalizedQuery.length >= 2) {
        const searchQuery = buildGitHubRepoSearchQuery(normalizedQuery);
        const { data } = await octokit.rest.search.repos({
          q: searchQuery,
          per_page: REPO_PAGE_SIZE,
          page: pageParam,
          sort: "updated",
        });
        return {
          repos: data.items.map(toRepoOption),
          nextPage: data.total_count > pageParam * REPO_PAGE_SIZE ? pageParam + 1 : null,
        };
      }

      const { data } = await octokit.rest.repos.listForAuthenticatedUser({
        per_page: REPO_PAGE_SIZE,
        page: pageParam,
        sort: "pushed",
        type: "all",
      });
      return {
        repos: data.map(toRepoOption),
        nextPage: data.length >= REPO_PAGE_SIZE ? pageParam + 1 : null,
      };
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
    enabled: !!account,
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

async function fetchOwnerRepos(
  octokit: Octokit,
  owner: string,
  page: number,
): Promise<RepoPage> {
  try {
    const { data } = await octokit.rest.repos.listForUser({
      username: owner,
      per_page: REPO_PAGE_SIZE,
      page,
      sort: "pushed",
    });
    return {
      repos: data.map(toRepoOption),
      nextPage: data.length >= REPO_PAGE_SIZE ? page + 1 : null,
    };
  } catch {
    try {
      const { data } = await octokit.rest.repos.listForOrg({
        org: owner,
        per_page: REPO_PAGE_SIZE,
        page,
        sort: "pushed",
      });
      return {
        repos: data.map(toRepoOption),
        nextPage: data.length >= REPO_PAGE_SIZE ? page + 1 : null,
      };
    } catch {
      return { repos: [], nextPage: null };
    }
  }
}

// ─── Labels & Users ─────────────────────────────────────────────────────────

export function useGitHubLabels(
  account: OAuthConnection | null,
  repos: string[],
) {
  return useQuery({
    queryKey: githubKeys.labels(account?.providerAccountId, repos),
    queryFn: async () => {
      const token = await getOAuthToken(account!);
      const octokit = new Octokit({ auth: token });

      const allLabels = await Promise.all(
        repos.map(async (repo) => {
          const [owner, name] = repo.split("/");
          try {
            const { data } = await octokit.rest.issues.listLabelsForRepo({
              owner: owner!,
              repo: name!,
            });
            return data.map((label) => label.name);
          } catch {
            return [];
          }
        }),
      );

      const unique = [...new Set(allLabels.flat())].sort();
      return unique.map((name) => ({ value: name, label: name }));
    },
    enabled: !!account && repos.length > 0,
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

export type FilterSuggestionOption = {
  value: string;
  label: string;
};

export async function fetchGitHubUserSearch(
  account: OAuthConnection,
  query: string,
): Promise<FilterSuggestionOption[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const token = await getOAuthToken(account);
  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.rest.search.users({
    q: trimmedQuery,
    per_page: 10,
  });

  return dedupeSuggestions(
    data.items.map((user) => ({ value: user.login, label: user.login })),
  );
}

export function useGitHubUsers(
  account: OAuthConnection | null,
  query: string,
) {
  return useQuery({
    queryKey: githubKeys.users(account?.providerAccountId, query),
    queryFn: async () => fetchGitHubUserSearch(account!, query),
    enabled: !!account && query.length >= 2,
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

export function useGitHubProfile(account: OAuthConnection | null) {
  return useQuery({
    queryKey: githubKeys.profile(account?.providerAccountId),
    queryFn: async () => {
      const token = await getOAuthToken(account!);
      const octokit = new Octokit({ auth: token });
      const { data } = await octokit.rest.users.getAuthenticated();
      return { login: data.login, avatarUrl: data.avatar_url, name: data.name };
    },
    enabled: !!account,
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

// ─── Unified Filter Suggestions ─────────────────────────────────────────────

const FILTER_SUGGESTION_RESULT_LIMIT = 25;

/**
 * GraphQL fragments per field, keyed by item type.
 * PR fragments include review-related fields that issues don't have.
 */
const SUGGESTION_FRAGMENTS: Record<GitHubItemType, Record<string, string>> = {
  pr: {
    author: `author { login }`,
    reviewer: `
      reviewRequests(first: 20) {
        nodes { requestedReviewer { __typename ... on User { login } } }
      }
      latestReviews(first: 20) { nodes { author { login } } }
    `,
    team_reviewer: `
      reviewRequests(first: 20) {
        nodes {
          requestedReviewer {
            __typename
            ... on Team { slug organization { login } }
          }
        }
      }
    `,
    assignee: `assignees(first: 20) { nodes { login } }`,
    mentions: `
      author { login }
      assignees(first: 20) { nodes { login } }
      participants(first: 20) { nodes { login } }
      latestReviews(first: 20) { nodes { author { login } } }
    `,
    involves: `
      author { login }
      assignees(first: 20) { nodes { login } }
      participants(first: 20) { nodes { login } }
      latestReviews(first: 20) { nodes { author { login } } }
    `,
    repo: `repository { nameWithOwner }`,
    label: `labels(first: 20) { nodes { name } }`,
    milestone: `milestone { title }`,
    language: `repository { primaryLanguage { name } }`,
    head: `headRefName`,
    base: `baseRefName`,
  },
  issue: {
    author: `author { login }`,
    assignee: `assignees(first: 20) { nodes { login } }`,
    mentions: `
      author { login }
      assignees(first: 20) { nodes { login } }
      participants(first: 20) { nodes { login } }
    `,
    involves: `
      author { login }
      assignees(first: 20) { nodes { login } }
      participants(first: 20) { nodes { login } }
    `,
    repo: `repository { nameWithOwner }`,
    label: `labels(first: 20) { nodes { name } }`,
    milestone: `milestone { title }`,
    language: `repository { primaryLanguage { name } }`,
  },
};

type SuggestionNode = {
  author?: { login: string } | null;
  repository?: { nameWithOwner: string; primaryLanguage: { name: string } | null };
  labels?: { nodes: Array<{ name: string }> };
  assignees?: { nodes: Array<{ login: string }> };
  participants?: { nodes: Array<{ login: string }> };
  reviewRequests?: {
    nodes: Array<{
      requestedReviewer:
        | { __typename: "User"; login: string }
        | { __typename: "Team"; slug: string; organization: { login: string } | null }
        | null;
    }>;
  };
  latestReviews?: { nodes: Array<{ author: { login: string } | null }> } | null;
  milestone?: { title: string } | null;
  headRefName?: string | null;
  baseRefName?: string | null;
};

type SuggestionResponse = {
  search: { nodes: SuggestionNode[] };
};

function dedupeSuggestions(options: FilterSuggestionOption[]): FilterSuggestionOption[] {
  const seen = new Set<string>();
  const deduped: FilterSuggestionOption[] = [];
  for (const option of options) {
    if (!option.value || seen.has(option.value)) continue;
    seen.add(option.value);
    deduped.push(option);
  }
  return deduped.sort((a, b) => a.label.localeCompare(b.label));
}

function pushUserSuggestion(options: FilterSuggestionOption[], login: string | null | undefined) {
  if (login) options.push({ value: login, label: login });
}

function extractSuggestions(field: string, node: SuggestionNode, options: FilterSuggestionOption[]) {
  switch (field) {
    case "author":
      pushUserSuggestion(options, node.author?.login);
      break;
    case "reviewer":
      node.latestReviews?.nodes.forEach((r) => pushUserSuggestion(options, r.author?.login));
      node.reviewRequests?.nodes.forEach((r) => {
        if (r.requestedReviewer?.__typename === "User") {
          pushUserSuggestion(options, r.requestedReviewer.login);
        }
      });
      break;
    case "team_reviewer":
      node.reviewRequests?.nodes.forEach((r) => {
        if (r.requestedReviewer?.__typename === "Team") {
          const team = r.requestedReviewer;
          const value = team.organization?.login
            ? `${team.organization.login}/${team.slug}`
            : team.slug;
          options.push({ value, label: value });
        }
      });
      break;
    case "assignee":
      node.assignees?.nodes.forEach((a) => pushUserSuggestion(options, a.login));
      break;
    case "mentions":
    case "involves":
      node.participants?.nodes.forEach((p) => pushUserSuggestion(options, p.login));
      pushUserSuggestion(options, node.author?.login);
      node.assignees?.nodes.forEach((a) => pushUserSuggestion(options, a.login));
      node.latestReviews?.nodes?.forEach((r) => pushUserSuggestion(options, r.author?.login));
      break;
    case "repo":
      if (node.repository?.nameWithOwner) {
        options.push({ value: node.repository.nameWithOwner, label: node.repository.nameWithOwner });
      }
      break;
    case "label":
      node.labels?.nodes.forEach((l) => options.push({ value: l.name, label: l.name }));
      break;
    case "milestone":
      if (node.milestone?.title) {
        options.push({ value: node.milestone.title, label: node.milestone.title });
      }
      break;
    case "language":
      if (node.repository?.primaryLanguage?.name) {
        options.push({ value: node.repository.primaryLanguage.name, label: node.repository.primaryLanguage.name });
      }
      break;
    case "head":
      if (node.headRefName) options.push({ value: node.headRefName, label: node.headRefName });
      break;
    case "base":
      if (node.baseRefName) options.push({ value: node.baseRefName, label: node.baseRefName });
      break;
  }
}

function isMissingGitHubOrgScopeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("requires one of the following scopes") &&
    (error.message.includes("read:org") || error.message.includes("read:discussion"))
  );
}

export async function fetchGitHubFilterSuggestions(
  itemType: GitHubItemType,
  account: OAuthConnection,
  field: string,
  filters: FilterCondition[],
  repos: string[],
): Promise<FilterSuggestionOption[]> {
  const fragments = SUGGESTION_FRAGMENTS[itemType];
  const fragment = fragments[field];
  if (!fragment) return [];

  const token = await getOAuthToken(account);
  const octokit = new Octokit({ auth: token });
  const searchQuery = buildGitHubSearchQuery(itemType, filters, repos);
  const graphqlType = itemType === "pr" ? "PullRequest" : "Issue";

  const query = `
    query FilterSuggestions($searchQuery: String!, $first: Int!) {
      search(query: $searchQuery, type: ISSUE, first: $first) {
        nodes { ... on ${graphqlType} { ${fragment} } }
      }
    }
  `;

  let data: SuggestionResponse;
  try {
    data = await octokit.graphql<SuggestionResponse>(query, {
      searchQuery,
      first: FILTER_SUGGESTION_RESULT_LIMIT,
    });
  } catch (error) {
    if (field === "team_reviewer" && isMissingGitHubOrgScopeError(error)) return [];
    throw error;
  }

  const options: FilterSuggestionOption[] = [];
  for (const node of data.search.nodes) {
    extractSuggestions(field, node, options);
  }
  return dedupeSuggestions(options);
}
