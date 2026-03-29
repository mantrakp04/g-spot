import { Octokit } from "octokit";
import type { FilterCondition } from "@g-spot/api/schemas/section-filters";
import type { GitHubPR, GitHubPRPage } from "./types";

const SEARCH_PAGE_SIZE = 7;

const SEARCH_PR_QUERY = `
  query SearchPRs($searchQuery: String!, $cursor: String, $first: Int!) {
    search(query: $searchQuery, type: ISSUE, first: $first, after: $cursor) {
      nodes {
        ... on PullRequest {
          id
          number
          title
          url
          isDraft
          author { login avatarUrl }
          repository { nameWithOwner owner { login } name }
          reviewDecision
          latestReviews(first: 10) {
            nodes { author { login avatarUrl } state }
          }
          commits(last: 1) {
            nodes { commit { statusCheckRollup { state } } }
          }
          additions
          deletions
          updatedAt
        }
      }
      pageInfo { hasNextPage endCursor }
      issueCount
    }
  }
`;

type GraphQLSearchResponse = {
  search: {
    nodes: Array<{
      id: string;
      number: number;
      title: string;
      url: string;
      isDraft: boolean;
      author: { login: string; avatarUrl: string } | null;
      repository: { nameWithOwner: string; owner: { login: string }; name: string };
      reviewDecision: GitHubPR["reviewDecision"];
      latestReviews: {
        nodes: Array<{ author: { login: string; avatarUrl: string } | null; state: string }>;
      } | null;
      commits: {
        nodes: Array<{
          commit: {
            statusCheckRollup: { state: string } | null;
          };
        }>;
      } | null;
      additions: number;
      deletions: number;
      updatedAt: string;
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    issueCount: number;
  };
};

/** Formats a value with operator into GitHub search range syntax */
function formatRangeValue(operator: string, value: string): string {
  switch (operator) {
    case "gt":
      return `>${value}`;
    case "lt":
      return `<${value}`;
    case "gte":
      return `>=${value}`;
    case "lte":
      return `<=${value}`;
    case "between":
      // Expects value like "2024-01-01..2024-12-31"
      return value.includes("..") ? value : `${value}`;
    default:
      return value;
  }
}

function buildSearchQuery(
  filters: FilterCondition[],
  repos?: string[],
  sortAsc?: boolean,
): string {
  const parts: string[] = ["is:pr"];
  let hasStatusFilter = false;

  // Add repo qualifiers from the section's repo list
  // Multiple repo: qualifiers are implicitly OR'd by GitHub search
  if (repos && repos.length > 0) {
    for (const repo of repos) {
      parts.push(`repo:${repo}`);
    }
  }

  for (const filter of filters) {
    const { field, operator, value } = filter;
    const negate = operator === "is_not" || operator === "not_contains";

    switch (field) {
      case "status":
        hasStatusFilter = true;
        parts.push(negate ? `-is:${value}` : `is:${value}`);
        break;
      case "author":
        parts.push(negate ? `-author:${value}` : `author:${value}`);
        break;
      case "reviewer":
        if (negate) {
          parts.push(`-reviewed-by:${value}`);
        } else {
          parts.push(`review-requested:${value}`);
        }
        break;
      case "repo":
        parts.push(negate ? `-repo:${value}` : `repo:${value}`);
        break;
      case "label":
        parts.push(negate ? `-label:${value}` : `label:${value}`);
        break;
      case "draft":
        parts.push(`draft:${value}`);
        break;
      case "review_status":
        parts.push(negate ? `-review:${value}` : `review:${value}`);
        break;
      case "mentions":
        parts.push(negate ? `-mentions:${value}` : `mentions:${value}`);
        break;
      case "involves":
        parts.push(negate ? `-involves:${value}` : `involves:${value}`);
        break;
      case "team_reviewer":
        parts.push(
          negate
            ? `-team-review-requested:${value}`
            : `team-review-requested:${value}`,
        );
        break;
      case "assignee":
        parts.push(negate ? `-assignee:${value}` : `assignee:${value}`);
        break;
      case "milestone":
        parts.push(negate ? `-milestone:"${value}"` : `milestone:"${value}"`);
        break;
      case "created":
      case "updated":
      case "merged":
      case "closed":
        parts.push(`${field}:${formatRangeValue(operator, value)}`);
        break;
      case "comments":
      case "interactions":
        parts.push(`${field}:${formatRangeValue(operator, value)}`);
        break;
      case "head":
        parts.push(negate ? `-head:${value}` : `head:${value}`);
        break;
      case "base":
        parts.push(negate ? `-base:${value}` : `base:${value}`);
        break;
      case "language":
        parts.push(negate ? `-language:${value}` : `language:${value}`);
        break;
    }
  }

  if (!hasStatusFilter) {
    parts.push("is:open");
  }

  // Sort qualifier
  parts.push(sortAsc ? "sort:updated-asc" : "sort:updated-desc");

  return parts.join(" ");
}

function mapStatusCheck(
  state: string | undefined | null,
): GitHubPR["statusCheckRollup"] {
  if (!state) return null;
  const upper = state.toUpperCase();
  if (upper === "SUCCESS") return "SUCCESS";
  if (upper === "FAILURE") return "FAILURE";
  if (upper === "PENDING" || upper === "EXPECTED") return "PENDING";
  if (upper === "ERROR") return "ERROR";
  return null;
}

export async function searchGitHubPRs(
  accessToken: string,
  filters: FilterCondition[],
  cursor?: string | null,
  repos?: string[],
  sortAsc?: boolean,
): Promise<GitHubPRPage> {
  const octokit = new Octokit({ auth: accessToken });
  const searchQuery = buildSearchQuery(filters, repos, sortAsc);

  const response = await octokit.graphql<GraphQLSearchResponse>(
    SEARCH_PR_QUERY,
    {
      searchQuery,
      cursor: cursor ?? null,
      first: SEARCH_PAGE_SIZE,
    },
  );

  const { nodes, pageInfo, issueCount } = response.search;

  const prs: GitHubPR[] = nodes
    .filter((node) => node.id != null)
    .map((node) => {
      const commitNode = node.commits?.nodes?.[0];
      const statusState = commitNode?.commit?.statusCheckRollup?.state ?? null;

      const reviewers =
        node.latestReviews?.nodes
          ?.filter((r) => r.author != null)
          .map((r) => ({
            login: r.author!.login,
            avatarUrl: r.author!.avatarUrl,
            state: r.state,
          })) ?? [];

      return {
        id: node.id,
        number: node.number,
        title: node.title,
        url: node.url,
        isDraft: node.isDraft,
        author: node.author ?? { login: "ghost", avatarUrl: "" },
        repository: {
          nameWithOwner: node.repository.nameWithOwner,
          owner: node.repository.owner.login,
          name: node.repository.name,
        },
        reviewDecision: node.reviewDecision,
        reviewers,
        statusCheckRollup: mapStatusCheck(statusState),
        additions: node.additions,
        deletions: node.deletions,
        updatedAt: node.updatedAt,
      };
    });

  return {
    prs,
    nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : null,
    totalCount: issueCount,
  };
}
