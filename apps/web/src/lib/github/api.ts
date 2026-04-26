import { Octokit } from "octokit";
import type { FilterCondition, FilterRule } from "@g-spot/types/filters";
import { normalizeFilterRule } from "@g-spot/types/filters";
import type {
  GitHubIssue,
  GitHubItemPage,
  GitHubPullRequest,
} from "./types";

const SEARCH_PAGE_SIZE = 7;
const MAX_PARALLEL_SEARCH_QUERIES = 8;

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
type SearchVariables = { searchQuery: string; cursor: string | null; first: number };

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
  filters: FilterRule | FilterCondition[],
  repos?: string[],
  sortAsc?: boolean,
): string {
  const parts: string[] = [itemType === "pr" ? "is:pr" : "is:issue"];

  if (repos) {
    for (const repo of repos) parts.push(`repo:${repo}`);
  }

  const filterRule = normalizeFilterRule(filters);
  const filterQuery = buildGitHubFilterRuleQuery(filterRule);
  const hasStatusFilter = filterRuleHasField(filterRule, "status");
  if (filterQuery) parts.push(filterQuery);

  if (!hasStatusFilter) parts.push("is:open");
  parts.push(sortAsc ? "sort:updated-asc" : "sort:updated-desc");
  return parts.join(" ");
}

function filterRuleHasField(rule: FilterRule, field: string): boolean {
  if (rule.type === "condition") return rule.field === field && rule.value.trim().length > 0;
  return rule.children.some((child) => filterRuleHasField(child, field));
}

function buildGitHubConditionQuery(condition: FilterCondition): string | null {
  const { field, operator, value } = condition;
  if (value.trim().length === 0) return null;

  const negate = operator === "is_not" || operator === "not_contains";

  if (field === "status") {
    return negate ? `-is:${value}` : `is:${value}`;
  }
  if (field === "draft") {
    return `draft:${value}`;
  }
  if (field === "review_status") {
    return negate ? `-review:${value}` : `review:${value}`;
  }
  if (field === "reviewer") {
    return negate ? `-reviewed-by:${value}` : `review-requested:${value}`;
  }
  if (field === "milestone") {
    return negate ? `-milestone:"${value}"` : `milestone:"${value}"`;
  }
  if (RANGE_FIELDS.has(field)) {
    return `${field}:${formatRangeValue(operator, value)}`;
  }
  if (field in SIMPLE_QUALIFIERS) {
    const qualifier = SIMPLE_QUALIFIERS[field]!;
    return negate ? `-${qualifier}:${value}` : `${qualifier}:${value}`;
  }

  return null;
}

function buildGitHubFilterRuleQuery(rule: FilterRule): string | null {
  if (rule.type === "condition") return buildGitHubConditionQuery(rule);

  const children = rule.children
    .map(buildGitHubFilterRuleQuery)
    .filter((query): query is string => query != null && query.length > 0);

  if (children.length === 0) return null;
  if (children.length === 1) return children[0]!;

  const operator = rule.operator === "or" ? " OR " : " AND ";
  return `(${children.join(operator)})`;
}

function toAndClauses(rule: FilterRule): FilterCondition[][] {
  const normalized = normalizeFilterRule(rule);

  if (normalized.type === "condition") {
    return normalized.value.trim().length > 0 ? [[normalized]] : [[]];
  }

  const childClauses = normalized.children.map(toAndClauses);
  if (childClauses.length === 0) return [[]];

  if (normalized.operator === "or") {
    return childClauses.flat();
  }

  return childClauses.reduce<FilterCondition[][]>(
    (acc, clauses) =>
      acc.flatMap((left) =>
        clauses.map((right) => [...left, ...right]),
      ),
    [[]],
  );
}

function buildGitHubAndOnlySearchQuery(
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

  for (const filter of filters) {
    if (filter.field === "status" && filter.value.trim().length > 0) {
      hasStatusFilter = true;
    }
    const query = buildGitHubConditionQuery(filter);
    if (query) parts.push(query);
  }

  if (!hasStatusFilter) parts.push("is:open");
  parts.push(sortAsc ? "sort:updated-asc" : "sort:updated-desc");
  return parts.join(" ");
}

function buildGitHubSearchQueries(
  itemType: GitHubItemType,
  filters: FilterRule,
  repos?: string[],
  sortAsc?: boolean,
): string[] {
  const seen = new Set<string>();
  const queries: string[] = [];
  const clauses = toAndClauses(filters);

  if (clauses.length > MAX_PARALLEL_SEARCH_QUERIES) {
    return [buildGitHubSearchQuery(itemType, filters, repos, sortAsc)];
  }

  for (const clause of clauses) {
    const query = buildGitHubAndOnlySearchQuery(itemType, clause, repos, sortAsc);
    if (seen.has(query)) continue;
    seen.add(query);
    queries.push(query);
  }

  return queries.length > 0
    ? queries
    : [buildGitHubAndOnlySearchQuery(itemType, [], repos, sortAsc)];
}

function parseMultiCursor(cursor: string | null | undefined, count: number): (string | null)[] {
  if (!cursor?.startsWith("multi:")) {
    return Array.from({ length: count }, () => null);
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(cursor.slice("multi:".length)));
    if (!Array.isArray(parsed)) throw new Error("Invalid cursor");
    return Array.from({ length: count }, (_, index) =>
      typeof parsed[index] === "string" ? parsed[index] : null,
    );
  } catch {
    return Array.from({ length: count }, () => null);
  }
}

function encodeMultiCursor(cursors: (string | null)[]): string | null {
  return cursors.some((cursor) => cursor != null)
    ? `multi:${encodeURIComponent(JSON.stringify(cursors))}`
    : null;
}

function compareGitHubItems(sortAsc: boolean | undefined) {
  return (a: GitHubPullRequest | GitHubIssue, b: GitHubPullRequest | GitHubIssue) => {
    const aTime = Date.parse(a.updatedAt);
    const bTime = Date.parse(b.updatedAt);
    return sortAsc ? aTime - bTime : bTime - aTime;
  };
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
  filters: FilterRule,
  cursor?: string | null,
  repos?: string[],
  sortAsc?: boolean,
): Promise<GitHubItemPage> {
  const octokit = new Octokit({ auth: accessToken });
  const searchQueries = buildGitHubSearchQueries(itemType, filters, repos, sortAsc);
  const cursors = searchQueries.length > 1
    ? parseMultiCursor(cursor, searchQueries.length)
    : [cursor ?? null];
  const first = searchQueries.length > 1
    ? Math.max(1, Math.ceil(SEARCH_PAGE_SIZE / searchQueries.length))
    : SEARCH_PAGE_SIZE;

  if (itemType === "pr") {
    const responses = await Promise.all(
      searchQueries.map((searchQuery, index) =>
        searchPullRequests(octokit, {
          searchQuery,
          cursor: cursors[index] ?? null,
          first,
        }),
      ),
    );

    const itemsById = new Map<string, GitHubPullRequest>();
    for (const response of responses) {
      for (const node of response.search.nodes) {
        const item = mapPullRequestNode(node);
        itemsById.set(item.id, item);
      }
    }

    const items = [...itemsById.values()]
      .sort(compareGitHubItems(sortAsc))
      .slice(0, SEARCH_PAGE_SIZE);

    return {
      items,
      nextCursor: searchQueries.length > 1
        ? encodeMultiCursor(responses.map((response) =>
            response.search.pageInfo.hasNextPage ? response.search.pageInfo.endCursor : null,
          ))
        : responses[0]!.search.pageInfo.hasNextPage
          ? responses[0]!.search.pageInfo.endCursor
          : null,
      totalCount: searchQueries.length > 1
        ? Math.max(itemsById.size, ...responses.map((response) => response.search.issueCount))
        : responses[0]!.search.issueCount,
    };
  }

  const responses = await Promise.all(
    searchQueries.map((searchQuery, index) =>
      octokit.graphql<IssueSearchResponse>(
        SEARCH_ISSUES_QUERY,
        {
          searchQuery,
          cursor: cursors[index] ?? null,
          first,
        },
      ),
    ),
  );

  const itemsById = new Map<string, GitHubIssue>();
  for (const response of responses) {
    for (const node of response.search.nodes) {
      const item = mapIssueNode(node);
      itemsById.set(item.id, item);
    }
  }

  const items = [...itemsById.values()]
    .sort(compareGitHubItems(sortAsc))
    .slice(0, SEARCH_PAGE_SIZE);

  return {
    items,
    nextCursor: searchQueries.length > 1
      ? encodeMultiCursor(responses.map((response) =>
          response.search.pageInfo.hasNextPage ? response.search.pageInfo.endCursor : null,
        ))
      : responses[0]!.search.pageInfo.hasNextPage
        ? responses[0]!.search.pageInfo.endCursor
        : null,
    totalCount: searchQueries.length > 1
      ? Math.max(itemsById.size, ...responses.map((response) => response.search.issueCount))
      : responses[0]!.search.issueCount,
  };
}

async function searchPullRequests(
  octokit: Octokit,
  variables: SearchVariables,
): Promise<PullRequestSearchResponse> {
  if (hasOrgAccess === false) {
    return octokit.graphql<PullRequestSearchResponse>(
      SEARCH_PULL_REQUESTS_QUERY_USER_ONLY,
      variables,
    );
  }

  try {
    const response = await octokit.graphql<PullRequestSearchResponse>(
      SEARCH_PULL_REQUESTS_QUERY_WITH_TEAMS,
      variables,
    );
    hasOrgAccess = true;
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("required scopes") || message.includes("read:org")) {
      hasOrgAccess = false;
      return octokit.graphql<PullRequestSearchResponse>(
        SEARCH_PULL_REQUESTS_QUERY_USER_ONLY,
        variables,
      );
    }
    throw error;
  }
}
