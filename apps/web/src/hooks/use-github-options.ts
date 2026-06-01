import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { InfiniteData, QueryPersister } from "@tanstack/react-query";
import type { Octokit } from "octokit";
import type { OAuthConnection } from "@hexclave/react";
import type { FilterCondition } from "@g-spot/types/filters";

import { buildGitHubSearchQuery, type GitHubItemType } from "@/lib/github/api";
import { getGitHubOctokit } from "@/lib/github/client";
import { githubKeys } from "@/lib/query-keys";
import { persistedStaleWhileRevalidateQueryOptions } from "@/utils/query-defaults";

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

  const { persister, ...infiniteDefaults } = persistedStaleWhileRevalidateQueryOptions;

  return useInfiniteQuery<
    RepoPage,
    Error,
    InfiniteData<RepoPage, number>,
    ReturnType<typeof githubKeys.repoSearch>,
    number
  >({
    queryKey: githubKeys.repoSearch(account?.providerAccountId, normalizedQuery),
    queryFn: async ({ pageParam }): Promise<RepoPage> => {
      const octokit = await getGitHubOctokit(account!);

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
    ...infiniteDefaults,
    persister: persister as QueryPersister<RepoPage, ReturnType<typeof githubKeys.repoSearch>, number>,
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

export function useGitHubLabels(
  account: OAuthConnection | null,
  repos: string[],
) {
  return useQuery({
    queryKey: githubKeys.labels(account?.providerAccountId, repos),
    queryFn: async () => {
      const octokit = await getGitHubOctokit(account!);

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

  const octokit = await getGitHubOctokit(account);
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
    queryFn: () => fetchGitHubUserSearch(account!, query),
    enabled: !!account && query.length >= 2,
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

export async function fetchGitHubProfileForConnection(
  account: OAuthConnection,
) {
  const octokit = await getGitHubOctokit(account);
  const { data } = await octokit.rest.users.getAuthenticated();
  return { login: data.login, avatarUrl: data.avatar_url, name: data.name };
}

export function useGitHubProfile(account: OAuthConnection | null) {
  return useQuery({
    queryKey: githubKeys.profile(account?.providerAccountId),
    queryFn: () => fetchGitHubProfileForConnection(account!),
    enabled: !!account,
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

const FILTER_SUGGESTION_RESULT_LIMIT = 25;

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

type SuggestionField = {
  fragment: string;
  extract: (node: SuggestionNode, options: FilterSuggestionOption[]) => void;
};

const authorField: SuggestionField = {
  fragment: `author { login }`,
  extract: (node, options) => pushUserSuggestion(options, node.author?.login),
};

const assigneeField: SuggestionField = {
  fragment: `assignees(first: 20) { nodes { login } }`,
  extract: (node, options) =>
    node.assignees?.nodes.forEach((assignee) => pushUserSuggestion(options, assignee.login)),
};

const repoField: SuggestionField = {
  fragment: `repository { nameWithOwner }`,
  extract: (node, options) => {
    if (node.repository?.nameWithOwner) {
      options.push({ value: node.repository.nameWithOwner, label: node.repository.nameWithOwner });
    }
  },
};

const labelField: SuggestionField = {
  fragment: `labels(first: 20) { nodes { name } }`,
  extract: (node, options) =>
    node.labels?.nodes.forEach((label) => options.push({ value: label.name, label: label.name })),
};

const milestoneField: SuggestionField = {
  fragment: `milestone { title }`,
  extract: (node, options) => {
    if (node.milestone?.title) {
      options.push({ value: node.milestone.title, label: node.milestone.title });
    }
  },
};

const languageField: SuggestionField = {
  fragment: `repository { primaryLanguage { name } }`,
  extract: (node, options) => {
    if (node.repository?.primaryLanguage?.name) {
      options.push({
        value: node.repository.primaryLanguage.name,
        label: node.repository.primaryLanguage.name,
      });
    }
  },
};

const prMentionsField: SuggestionField = {
  fragment: `
    author { login }
    assignees(first: 20) { nodes { login } }
    participants(first: 20) { nodes { login } }
    latestReviews(first: 20) { nodes { author { login } } }
  `,
  extract: (node, options) => {
    node.participants?.nodes.forEach((participant) => pushUserSuggestion(options, participant.login));
    pushUserSuggestion(options, node.author?.login);
    node.assignees?.nodes.forEach((assignee) => pushUserSuggestion(options, assignee.login));
    node.latestReviews?.nodes?.forEach((review) => pushUserSuggestion(options, review.author?.login));
  },
};

const issueMentionsField: SuggestionField = {
  fragment: `
    author { login }
    assignees(first: 20) { nodes { login } }
    participants(first: 20) { nodes { login } }
  `,
  extract: (node, options) => {
    node.participants?.nodes.forEach((participant) => pushUserSuggestion(options, participant.login));
    pushUserSuggestion(options, node.author?.login);
    node.assignees?.nodes.forEach((assignee) => pushUserSuggestion(options, assignee.login));
    node.latestReviews?.nodes?.forEach((review) => pushUserSuggestion(options, review.author?.login));
  },
};

const SUGGESTION_FIELDS: Record<GitHubItemType, Record<string, SuggestionField>> = {
  pr: {
    author: authorField,
    reviewer: {
      fragment: `
        reviewRequests(first: 20) {
          nodes { requestedReviewer { __typename ... on User { login } } }
        }
        latestReviews(first: 20) { nodes { author { login } } }
      `,
      extract: (node, options) => {
        node.latestReviews?.nodes.forEach((review) => pushUserSuggestion(options, review.author?.login));
        node.reviewRequests?.nodes.forEach((request) => {
          if (request.requestedReviewer?.__typename === "User") {
            pushUserSuggestion(options, request.requestedReviewer.login);
          }
        });
      },
    },
    team_reviewer: {
      fragment: `
        reviewRequests(first: 20) {
          nodes {
            requestedReviewer {
              __typename
              ... on Team { slug organization { login } }
            }
          }
        }
      `,
      extract: (node, options) => {
        node.reviewRequests?.nodes.forEach((request) => {
          if (request.requestedReviewer?.__typename === "Team") {
            const team = request.requestedReviewer;
            const value = team.organization?.login
              ? `${team.organization.login}/${team.slug}`
              : team.slug;
            options.push({ value, label: value });
          }
        });
      },
    },
    assignee: assigneeField,
    mentions: prMentionsField,
    involves: prMentionsField,
    repo: repoField,
    label: labelField,
    milestone: milestoneField,
    language: languageField,
    head: {
      fragment: `headRefName`,
      extract: (node, options) => {
        if (node.headRefName) options.push({ value: node.headRefName, label: node.headRefName });
      },
    },
    base: {
      fragment: `baseRefName`,
      extract: (node, options) => {
        if (node.baseRefName) options.push({ value: node.baseRefName, label: node.baseRefName });
      },
    },
  },
  issue: {
    author: authorField,
    assignee: assigneeField,
    mentions: issueMentionsField,
    involves: issueMentionsField,
    repo: repoField,
    label: labelField,
    milestone: milestoneField,
    language: languageField,
  },
};

function isMissingGitHubOrgScopeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("requires one of the following scopes")
    && (error.message.includes("read:org") || error.message.includes("read:discussion"))
  );
}

export async function fetchGitHubFilterSuggestions(
  itemType: GitHubItemType,
  account: OAuthConnection,
  field: string,
  filters: FilterCondition[],
  repos: string[],
): Promise<FilterSuggestionOption[]> {
  const spec = SUGGESTION_FIELDS[itemType][field];
  if (!spec) return [];

  const octokit = await getGitHubOctokit(account);
  const searchQuery = buildGitHubSearchQuery(itemType, filters, repos);
  const graphqlType = itemType === "pr" ? "PullRequest" : "Issue";

  const query = `
    query FilterSuggestions($searchQuery: String!, $first: Int!) {
      search(query: $searchQuery, type: ISSUE, first: $first) {
        nodes { ... on ${graphqlType} { ${spec.fragment} } }
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
    spec.extract(node, options);
  }
  return dedupeSuggestions(options);
}
