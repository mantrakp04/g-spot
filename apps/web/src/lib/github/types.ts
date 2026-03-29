export type GitHubPR = {
  id: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  author: { login: string; avatarUrl: string };
  repository: { nameWithOwner: string; owner: string; name: string };
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  reviewers: Array<{ login: string; avatarUrl: string; state: string }>;
  statusCheckRollup: "SUCCESS" | "FAILURE" | "PENDING" | "ERROR" | null;
  additions: number;
  deletions: number;
  updatedAt: string;
};

export type GitHubPRPage = {
  prs: GitHubPR[];
  nextCursor: string | null;
  totalCount: number;
};
