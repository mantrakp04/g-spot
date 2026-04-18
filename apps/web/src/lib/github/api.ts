import { Octokit } from "octokit";
import type { FilterCondition } from "@g-spot/types/filters";
import type {
  GitHubIssue,
  GitHubItemPage,
  GitHubPullRequest,
} from "./types";

const SEARCH_PAGE_SIZE = 7;

export type GitHubItemType = "pr" | "issue";

const PR_QUERY_BODY = (reviewRequestFragment: string) => `
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
          reviewRequests(first: 10) {
            nodes { requestedReviewer { ${reviewRequestFragment} } }
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
          labels(first: 10) {
            nodes { name color }
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

const SEARCH_PULL_REQUESTS_QUERY_WITH_TEAMS = PR_QUERY_BODY(
  "... on User { login avatarUrl } ... on Team { name avatarUrl }",
);
const SEARCH_PULL_REQUESTS_QUERY_USER_ONLY = PR_QUERY_BODY(
  "... on User { login avatarUrl }",
);

let hasOrgAccess: boolean | null = null;

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
          stateReason
          author { login avatarUrl }
          repository { nameWithOwner owner { login } name }
          labels(first: 10) {
            nodes { name color }
          }
          assignees(first: 5) {
            nodes { login avatarUrl }
          }
          reactions { totalCount }
          milestone { title }
          comments { totalCount }
          createdAt
          updatedAt
        }
      }
      pageInfo { hasNextPage endCursor }
      issueCount
    }
  }
`;

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
  reviewRequests: {
    nodes: Array<{ requestedReviewer: { login?: string; name?: string; avatarUrl?: string } | null }>;
  } | null;
  commits: {
    nodes: Array<{
      commit: {
        statusCheckRollup: {
          state: string;
          contexts: {
            nodes: Array<
              | {
                  __typename: "CheckRun";
                  name: string;
                  conclusion: string | null;
                  status: string;
                  detailsUrl: string | null;
                }
              | {
                  __typename: "StatusContext";
                  context: string;
                  state: string;
                  targetUrl: string | null;
                }
            >;
          } | null;
        } | null;
      };
    }>;
  } | null;
  labels: { nodes: Array<{ name: string; color: string }> } | null;
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
  stateReason: GitHubIssue["stateReason"];
  author: { login: string; avatarUrl: string } | null;
  repository: { nameWithOwner: string; owner: { login: string }; name: string };
  labels: { nodes: Array<{ name: string; color: string }> } | null;
  assignees: { nodes: Array<{ login: string; avatarUrl: string }> } | null;
  reactions: { totalCount: number };
  milestone: { title: string } | null;
  comments: { totalCount: number };
  createdAt: string;
  updatedAt: string;
};

type SearchPageInfo = {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  issueCount: number;
};

type PullRequestSearchResponse = { search: { nodes: PullRequestNode[] } & SearchPageInfo };
type IssueSearchResponse = { search: { nodes: IssueNode[] } & SearchPageInfo };

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
  "created",
  "updated",
  "merged",
  "closed",
  "comments",
  "interactions",
]);

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
    default:
      return value;
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
      const qualifier = SIMPLE_QUALIFIERS[field]!;
      parts.push(negate ? `-${qualifier}:${value}` : `${qualifier}:${value}`);
    }
  }

  if (!hasStatusFilter) parts.push("is:open");
  parts.push(sortAsc ? "sort:updated-asc" : "sort:updated-desc");
  return parts.join(" ");
}

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
  const valid = [
    "SUCCESS",
    "FAILURE",
    "NEUTRAL",
    "CANCELLED",
    "TIMED_OUT",
    "ACTION_REQUIRED",
    "SKIPPED",
    "STALE",
  ] as const;
  return (valid as readonly string[]).includes(upper)
    ? (upper as (typeof valid)[number])
    : null;
}

function mapCheckStatus(
  status: string | null | undefined,
): GitHubPullRequest["statusChecks"][number]["status"] {
  if (!status) return null;
  const upper = status.toUpperCase();
  const valid = [
    "QUEUED",
    "IN_PROGRESS",
    "COMPLETED",
    "WAITING",
    "PENDING",
    "REQUESTED",
  ] as const;
  return (valid as readonly string[]).includes(upper)
    ? (upper as (typeof valid)[number])
    : null;
}

function mapStatusChecks(node: PullRequestNode): GitHubPullRequest["statusChecks"] {
  const contexts = node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes;
  if (!contexts) return [];

  return contexts.map((context) => {
    if (context.__typename === "CheckRun") {
      return {
        name: context.name,
        conclusion: mapCheckConclusion(context.conclusion),
        status: mapCheckStatus(context.status),
        detailsUrl: context.detailsUrl,
      };
    }

    const stateUpper = context.state.toUpperCase();
    return {
      name: context.context,
      conclusion: stateUpper === "SUCCESS"
        ? "SUCCESS"
        : stateUpper === "FAILURE" || stateUpper === "ERROR"
          ? "FAILURE"
          : null,
      status: stateUpper === "PENDING" ? "PENDING" : "COMPLETED",
      detailsUrl: context.targetUrl,
    };
  });
}

function mapPullRequestNode(node: PullRequestNode): GitHubPullRequest {
  const statusState = node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null;
  const reviewed =
    node.latestReviews?.nodes
      ?.filter((review) => review.author != null)
      .map((review) => ({
        login: review.author!.login,
        avatarUrl: review.author!.avatarUrl,
        state: review.state,
      }))
    ?? [];
  const reviewedLogins = new Set(reviewed.map((review) => review.login));
  const requested =
    node.reviewRequests?.nodes
      ?.filter(
        (request) =>
          request.requestedReviewer != null
          && (request.requestedReviewer.login || request.requestedReviewer.name),
      )
      .map((request) => ({
        login: request.requestedReviewer!.login ?? request.requestedReviewer!.name!,
        avatarUrl: request.requestedReviewer!.avatarUrl ?? "",
        state: "REQUESTED",
      }))
      .filter((reviewer) => !reviewedLogins.has(reviewer.login))
    ?? [];
  const reviewers = [...reviewed, ...requested];

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
    labels: node.labels?.nodes?.map((label) => ({ name: label.name, color: label.color })) ?? [],
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
    stateReason: node.stateReason,
    author: mapAuthor(node.author),
    repository: mapRepository(node.repository),
    labels: node.labels?.nodes?.map((label) => ({ name: label.name, color: label.color })) ?? [],
    assignees:
      node.assignees?.nodes?.map((assignee) => ({
        login: assignee.login,
        avatarUrl: assignee.avatarUrl,
      })) ?? [],
    reactions: node.reactions.totalCount,
    milestone: node.milestone?.title ?? null,
    comments: node.comments.totalCount,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}

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
    let response: PullRequestSearchResponse;

    if (hasOrgAccess === false) {
      response = await octokit.graphql<PullRequestSearchResponse>(
        SEARCH_PULL_REQUESTS_QUERY_USER_ONLY,
        variables,
      );
    } else {
      try {
        response = await octokit.graphql<PullRequestSearchResponse>(
          SEARCH_PULL_REQUESTS_QUERY_WITH_TEAMS,
          variables,
        );
        hasOrgAccess = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("required scopes") || message.includes("read:org")) {
          hasOrgAccess = false;
          response = await octokit.graphql<PullRequestSearchResponse>(
            SEARCH_PULL_REQUESTS_QUERY_USER_ONLY,
            variables,
          );
        } else {
          throw error;
        }
      }
    }

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
