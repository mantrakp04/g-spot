import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { Octokit } from "octokit";
import type { OAuthConnection } from "@stackframe/react";

async function getToken(account: OAuthConnection): Promise<string> {
  const result = await account.getAccessToken();
  if (result.status !== "ok") throw new Error("Failed to get GitHub access token");
  return result.data.accessToken;
}

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

/**
 * Search ALL GitHub repos with infinite scroll pagination.
 * Supports org/user prefix search like "stack-auth/" to find all repos for an org.
 */
export function useGitHubRepoSearch(
  account: OAuthConnection | null,
  query: string,
) {
  return useInfiniteQuery({
    queryKey: ["github", "repo-search", query] as const,
    queryFn: async ({ pageParam }): Promise<RepoPage> => {
      const token = await getToken(account!);
      const octokit = new Octokit({ auth: token });

      // If query looks like "org/" or "user/", list that owner's repos
      if (query.endsWith("/")) {
        return fetchOwnerRepos(octokit, query.slice(0, -1), pageParam);
      }

      // Regular search across all of GitHub
      if (query.length >= 2) {
        const { data } = await octokit.rest.search.repos({
          q: query,
          per_page: REPO_PAGE_SIZE,
          page: pageParam,
          sort: "stars",
        });
        return {
          repos: data.items.map(toRepoOption),
          nextPage: data.total_count > pageParam * REPO_PAGE_SIZE ? pageParam + 1 : null,
        };
      }

      // Default: show user's own repos
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
    staleTime: 5 * 60 * 1000,
  });
}

/** Try listing repos as user first, then fall back to org */
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
    queryKey: ["github", "labels", repos] as const,
    queryFn: async () => {
      const token = await getToken(account!);
      const octokit = new Octokit({ auth: token });

      const allLabels = await Promise.all(
        repos.map(async (repo) => {
          const [owner, name] = repo.split("/");
          try {
            const { data } = await octokit.rest.issues.listLabelsForRepo({
              owner: owner!,
              repo: name!,
            });
            return data.map((l) => l.name);
          } catch {
            return [];
          }
        }),
      );

      const unique = [...new Set(allLabels.flat())].sort();
      return unique.map((name) => ({ value: name, label: name }));
    },
    staleTime: 10 * 60 * 1000,
    enabled: !!account && repos.length > 0,
  });
}

export function useGitHubUsers(
  account: OAuthConnection | null,
  query: string,
) {
  return useQuery({
    queryKey: ["github", "users", query] as const,
    queryFn: async () => {
      const token = await getToken(account!);
      const octokit = new Octokit({ auth: token });
      const { data } = await octokit.rest.search.users({
        q: query,
        per_page: 10,
      });
      return data.items.map((user) => ({
        value: user.login,
        label: user.login,
        avatar: user.avatar_url,
      }));
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!account && query.length >= 2,
  });
}

/** Fetch the authenticated user's GitHub profile info */
export function useGitHubProfile(account: OAuthConnection | null) {
  return useQuery({
    queryKey: ["github", "profile"] as const,
    queryFn: async () => {
      const token = await getToken(account!);
      const octokit = new Octokit({ auth: token });
      const { data } = await octokit.rest.users.getAuthenticated();
      return { login: data.login, avatarUrl: data.avatar_url, name: data.name };
    },
    staleTime: 30 * 60 * 1000,
    enabled: !!account,
  });
}
