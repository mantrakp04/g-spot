import { Octokit } from "octokit";
import type { FilterCondition } from "@g-spot/types/filters";
import type {
  GitHubIssue,
  GitHubItemPage,
  GitHubPullRequest,
} from "./types";

const SEARCH_PAGE_SIZE = 7;

export type GitHubItemType = "pr" | "issue";

// ─── GraphQL Queries ────────────────────────────────────────────────────────

const SEARCH_PULL_REQUESTS_QUERY = `
  query SearchGitHubPullRequests($searchQuery: String!, $cursor: String, $first: Int!) {
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
            nodes {
              commit {
                statusCheckRollup {
                  state
                  contexts(first: 25) {
                    nodes {
                      ... on CheckRun {
                        __typename
                        name
                        conclusion
                        status
                        detailsUrl
                      }
                      ... on StatusContext {
                        __typename
                        context
                        state
                        targetUrl
                      }
                    }
                  }
                }
              }
            }
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

const SEARCH_ISSUES_QUERY = `
  query SearchGitHubIssues($searchQuery: String!, $cursor: String, $first: Int!) {
    search(query: $searchQuery, type: ISSUE, first: $first, after: $cursor) {
      nodes {
        ... on Issue {
          id
          number
          title
          url
          state
          author { login avatarUrl }
          repository { nameWithOwner owner { login } name }
          comments { totalCount }
          updatedAt
        }
      }
      pageInfo { hasNextPage endCursor }
      issueCount
    }
  }
`;

// ─── Raw Response Types ─────────────────────────────────────────────────────

type PullRequestNode = {
  id: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  author: { login: string; avatarUrl: string } | null;
  repository: { nameWithOwner: string; owner: { login: string }; name: string };
  reviewDecision: GitHubPullRequest["reviewDecision"];
  latestReviews: {
    nodes: Array<{ author: { login: string; avatarUrl: string } | null; state: string }>;
  } | null;
  commits: {
    nodes: Array<{
      commit: {
        statusCheckRollup: {
          state: string;
          contexts: {
            nodes: Array<
              | { __typename: "CheckRun"; name: string; conclusion: string | null; status: string; detailsUrl: string | null }
              | { __typename: "StatusContext"; context: string; state: string; targetUrl: string | null }
            >;
          } | null;
        } | null;
      };
    }>;
  } | null;
  additions: number;
  deletions: number;
  updatedAt: string;
};

type IssueNode = {
  id: string;
  number: number;
  title: string;
  url: string;
  state: GitHubIssue["state"];
  author: { login: string; avatarUrl: string } | null;
  repository: { nameWithOwner: string; owner: { login: string }; name: string };
  comments: { totalCount: number };
  updatedAt: string;
};

type SearchPageInfo = {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  issueCount: number;
};

type PullRequestSearchResponse = { search: { nodes: PullRequestNode[] } & SearchPageInfo };
type IssueSearchResponse = { search: { nodes: IssueNode[] } & SearchPageInfo };

// ─── Unified Search Query Builder ───────────────────────────────────────────

/** Simple `qualifier:value` / `-qualifier:value` fields */
const SIMPLE_QUALIFIERS: Record<string, string> = {
  author: "author",
  assignee: "assignee",
  mentions: "mentions",
  involves: "involves",
  repo: "repo",
  label: "label",
  language: "language",
  head: "head",
  base: "base",
  team_reviewer: "team-review-requested",
};

const RANGE_FIELDS = new Set([
  "created", "updated", "merged", "closed", "comments", "interactions",
]);

function formatRangeValue(operator: string, value: string): string {
  switch (operator) {
    case "gt": return `>${value}`;
    case "lt": return `<${value}`;
    case "gte": return `>=${value}`;
    case "lte": return `<=${value}`;
    default: return value;
  }
}

export function buildGitHubSearchQuery(
  itemType: GitHubItemType,
  filters: FilterCondition[],
  repos?: string[],
  sortAsc?: boolean,
): string {
  const parts: string[] = [itemType === "pr" ? "is:pr" : "is:issue"];
  let hasStatusFilter = false;

  if (repos) {
    for (const repo of repos) parts.push(`repo:${repo}`);
  }

  for (const { field, operator, value } of filters) {
    const negate = operator === "is_not" || operator === "not_contains";

    if (field === "status") {
      hasStatusFilter = true;
      parts.push(negate ? `-is:${value}` : `is:${value}`);
    } else if (field === "draft") {
      parts.push(`draft:${value}`);
    } else if (field === "review_status") {
      parts.push(negate ? `-review:${value}` : `review:${value}`);
    } else if (field === "reviewer") {
      parts.push(negate ? `-reviewed-by:${value}` : `review-requested:${value}`);
    } else if (field === "milestone") {
      parts.push(negate ? `-milestone:"${value}"` : `milestone:"${value}"`);
    } else if (RANGE_FIELDS.has(field)) {
      parts.push(`${field}:${formatRangeValue(operator, value)}`);
    } else if (field in SIMPLE_QUALIFIERS) {
      const q = SIMPLE_QUALIFIERS[field]!;
      parts.push(negate ? `-${q}:${value}` : `${q}:${value}`);
    }
  }

  if (!hasStatusFilter) parts.push("is:open");
  parts.push(sortAsc ? "sort:updated-asc" : "sort:updated-desc");
  return parts.join(" ");
}

// ─── Response Mapping ───────────────────────────────────────────────────────

function mapStatusCheck(
  state: string | undefined | null,
): GitHubPullRequest["statusCheckRollup"] {
  if (!state) return null;
  const upper = state.toUpperCase();
  if (upper === "SUCCESS") return "SUCCESS";
  if (upper === "FAILURE") return "FAILURE";
  if (upper === "PENDING" || upper === "EXPECTED") return "PENDING";
  if (upper === "ERROR") return "ERROR";
  return null;
}

function mapAuthor(author: { login: string; avatarUrl: string } | null) {
  return author ?? { login: "ghost", avatarUrl: "" };
}

function mapRepository(repo: { nameWithOwner: string; owner: { login: string }; name: string }) {
  return { nameWithOwner: repo.nameWithOwner, owner: repo.owner.login, name: repo.name };
}

function mapCheckConclusion(
  conclusion: string | null | undefined,
): GitHubPullRequest["statusChecks"][number]["conclusion"] {
  if (!conclusion) return null;
  const upper = conclusion.toUpperCase();
  const valid = ["SUCCESS", "FAILURE", "NEUTRAL", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "SKIPPED", "STALE"] as const;
  return (valid as readonly string[]).includes(upper)
    ? (upper as (typeof valid)[number])
    : null;
}

function mapCheckStatus(
  status: string | null | undefined,
): GitHubPullRequest["statusChecks"][number]["status"] {
  if (!status) return null;
  const upper = status.toUpperCase();
  const valid = ["QUEUED", "IN_PROGRESS", "COMPLETED", "WAITING", "PENDING", "REQUESTED"] as const;
  return (valid as readonly string[]).includes(upper)
    ? (upper as (typeof valid)[number])
    : null;
}

function mapStatusChecks(node: PullRequestNode): GitHubPullRequest["statusChecks"] {
  const contexts = node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes;
  if (!contexts) return [];
  return contexts.map((ctx) => {
    if (ctx.__typename === "CheckRun") {
      return {
        name: ctx.name,
        conclusion: mapCheckConclusion(ctx.conclusion),
        status: mapCheckStatus(ctx.status),
        detailsUrl: ctx.detailsUrl,
      };
    }
    // StatusContext
    const stateUpper = ctx.state.toUpperCase();
    return {
      name: ctx.context,
      conclusion: stateUpper === "SUCCESS" ? "SUCCESS" as const
        : stateUpper === "FAILURE" || stateUpper === "ERROR" ? "FAILURE" as const
        : null,
      status: stateUpper === "PENDING" ? "PENDING" as const : "COMPLETED" as const,
      detailsUrl: ctx.targetUrl,
    };
  });
}

function mapPullRequestNode(node: PullRequestNode): GitHubPullRequest {
  const statusState = node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null;
  const reviewers =
    node.latestReviews?.nodes
      ?.filter((r) => r.author != null)
      .map((r) => ({ login: r.author!.login, avatarUrl: r.author!.avatarUrl, state: r.state }))
    ?? [];

  return {
    id: node.id,
    number: node.number,
    title: node.title,
    url: node.url,
    itemType: "pull_request",
    isDraft: node.isDraft,
    author: mapAuthor(node.author),
    repository: mapRepository(node.repository),
    reviewDecision: node.reviewDecision,
    reviewers,
    statusCheckRollup: mapStatusCheck(statusState),
    statusChecks: mapStatusChecks(node),
    additions: node.additions,
    deletions: node.deletions,
    updatedAt: node.updatedAt,
  };
}

function mapIssueNode(node: IssueNode): GitHubIssue {
  return {
    id: node.id,
    number: node.number,
    title: node.title,
    url: node.url,
    itemType: "issue",
    state: node.state,
    author: mapAuthor(node.author),
    repository: mapRepository(node.repository),
    comments: node.comments.totalCount,
    updatedAt: node.updatedAt,
  };
}

// ─── Search ─────────────────────────────────────────────────────────────────

export async function searchGitHubItems(
  itemType: GitHubItemType,
  accessToken: string,
  filters: FilterCondition[],
  cursor?: string | null,
  repos?: string[],
  sortAsc?: boolean,
): Promise<GitHubItemPage> {
  const octokit = new Octokit({ auth: accessToken });
  const searchQuery = buildGitHubSearchQuery(itemType, filters, repos, sortAsc);
  const variables = { searchQuery, cursor: cursor ?? null, first: SEARCH_PAGE_SIZE };

  if (itemType === "pr") {
    const response = await octokit.graphql<PullRequestSearchResponse>(
      SEARCH_PULL_REQUESTS_QUERY,
      variables,
    );
    const { nodes, pageInfo, issueCount } = response.search;
    return {
      items: nodes.map(mapPullRequestNode),
      nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : null,
      totalCount: issueCount,
    };
  }

  const response = await octokit.graphql<IssueSearchResponse>(
    SEARCH_ISSUES_QUERY,
    variables,
  );
  const { nodes, pageInfo, issueCount } = response.search;
  return {
    items: nodes.map(mapIssueNode),
    nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : null,
    totalCount: issueCount,
  };
}
