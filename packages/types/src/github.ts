export type GitHubActor = {
  login: string;
  avatarUrl: string;
};

export type GitHubRepository = {
  nameWithOwner: string;
  owner: string;
  name: string;
};

export type GitHubStatusCheckRollup =
  | "SUCCESS"
  | "FAILURE"
  | "PENDING"
  | "ERROR"
  | null;

export type GitHubCheckConclusion =
  | "SUCCESS"
  | "FAILURE"
  | "NEUTRAL"
  | "CANCELLED"
  | "TIMED_OUT"
  | "ACTION_REQUIRED"
  | "SKIPPED"
  | "STALE"
  | null;

export type GitHubStatusCheck = {
  name: string;
  conclusion: GitHubCheckConclusion;
  status: "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "WAITING" | "PENDING" | "REQUESTED" | null;
  detailsUrl: string | null;
};

export type GitHubReviewDecision =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "REVIEW_REQUIRED"
  | null;

type GitHubItemBase = {
  id: string;
  number: number;
  title: string;
  url: string;
  author: GitHubActor;
  repository: GitHubRepository;
  updatedAt: string;
};

export type GitHubPullRequest = GitHubItemBase & {
  itemType: "pull_request";
  isDraft: boolean;
  reviewDecision: GitHubReviewDecision;
  reviewers: Array<{ login: string; avatarUrl: string; state: string }>;
  statusCheckRollup: GitHubStatusCheckRollup;
  statusChecks: GitHubStatusCheck[];
  additions: number;
  deletions: number;
};

export type GitHubIssue = GitHubItemBase & {
  itemType: "issue";
  state: "OPEN" | "CLOSED";
  comments: number;
};

export type GitHubPullRequestPage = {
  pullRequests: GitHubPullRequest[];
  nextCursor: string | null;
  totalCount: number;
};

export type GitHubIssuePage = {
  issues: GitHubIssue[];
  nextCursor: string | null;
  totalCount: number;
};

export type GitHubItem = GitHubPullRequest | GitHubIssue;

export type GitHubItemPage = {
  items: GitHubItem[];
  nextCursor: string | null;
  totalCount: number;
};

export type GitHubPR = GitHubPullRequest;
export type GitHubPRPage = GitHubPullRequestPage;
