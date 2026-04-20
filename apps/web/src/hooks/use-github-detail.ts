import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Octokit } from "octokit";
import type { OAuthConnection } from "@stackframe/react";

import { getConnectedAccountAccessToken } from "@/lib/connected-account";
import { persistedStaleWhileRevalidateQueryOptions } from "@/utils/query-defaults";

export type ReviewKind = "pr" | "issue";

export type ReviewTarget = {
  kind: ReviewKind;
  owner: string;
  repo: string;
  number: number;
};

export const githubDetailKeys = {
  pr: (t: ReviewTarget, accountId: string | null | undefined) =>
    ["github", "pr-detail", accountId ?? null, t.owner, t.repo, t.number] as const,
  prFiles: (t: ReviewTarget, accountId: string | null | undefined) =>
    ["github", "pr-files", accountId ?? null, t.owner, t.repo, t.number] as const,
  prTimeline: (t: ReviewTarget, accountId: string | null | undefined) =>
    ["github", "pr-timeline", accountId ?? null, t.owner, t.repo, t.number] as const,
  prChecks: (t: ReviewTarget, accountId: string | null | undefined) =>
    ["github", "pr-checks", accountId ?? null, t.owner, t.repo, t.number] as const,
  prStack: (t: ReviewTarget, accountId: string | null | undefined) =>
    ["github", "pr-stack", accountId ?? null, t.owner, t.repo, t.number] as const,
  issue: (t: ReviewTarget, accountId: string | null | undefined) =>
    ["github", "issue-detail", accountId ?? null, t.owner, t.repo, t.number] as const,
  issueTimeline: (t: ReviewTarget, accountId: string | null | undefined) =>
    ["github", "issue-timeline", accountId ?? null, t.owner, t.repo, t.number] as const,
  prReviewComments: (t: ReviewTarget, accountId: string | null | undefined) =>
    ["github", "pr-review-comments", accountId ?? null, t.owner, t.repo, t.number] as const,
  prCommits: (t: ReviewTarget, accountId: string | null | undefined) =>
    ["github", "pr-commits", accountId ?? null, t.owner, t.repo, t.number] as const,
  fileContents: (
    t: Pick<ReviewTarget, "owner" | "repo">,
    accountId: string | null | undefined,
    path: string,
    ref: string,
  ) =>
    [
      "github",
      "file-contents",
      accountId ?? null,
      t.owner,
      t.repo,
      ref,
      path,
    ] as const,
  prDeployments: (
    t: ReviewTarget,
    accountId: string | null | undefined,
    sha: string | null | undefined,
  ) =>
    [
      "github",
      "pr-deployments",
      accountId ?? null,
      t.owner,
      t.repo,
      t.number,
      sha ?? null,
    ] as const,
  repoLabels: (
    t: Pick<ReviewTarget, "owner" | "repo">,
    accountId: string | null | undefined,
  ) => ["github", "repo-labels", accountId ?? null, t.owner, t.repo] as const,
  repoAssignees: (
    t: Pick<ReviewTarget, "owner" | "repo">,
    accountId: string | null | undefined,
  ) =>
    ["github", "repo-assignees", accountId ?? null, t.owner, t.repo] as const,
  repoMilestones: (
    t: Pick<ReviewTarget, "owner" | "repo">,
    accountId: string | null | undefined,
  ) =>
    ["github", "repo-milestones", accountId ?? null, t.owner, t.repo] as const,
};

async function octokit(account: OAuthConnection) {
  const accessToken = await getConnectedAccountAccessToken(account, [
    "repo",
    "read:org",
  ]);
  return new Octokit({ auth: accessToken });
}

function requireAccount(account: OAuthConnection | null): OAuthConnection {
  if (!account) throw new Error("No GitHub account connected");
  return account;
}

function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function encodeBase64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

export function useGitHubPRDetail(
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  return useQuery({
    queryKey: githubDetailKeys.pr(target, account?.providerAccountId),
    enabled: !!account && target.kind === "pr",
    queryFn: async () => {
      const kit = await octokit(requireAccount(account));
      const { data } = await kit.rest.pulls.get({
        owner: target.owner,
        repo: target.repo,
        pull_number: target.number,
      });
      return data;
    },
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

export function useGitHubPRFiles(
  target: ReviewTarget,
  account: OAuthConnection | null,
  range?: { baseSha: string; headSha: string } | null,
) {
  const rangeKey = range ? `${range.baseSha}...${range.headSha}` : "full";
  return useQuery({
    queryKey: [
      ...githubDetailKeys.prFiles(target, account?.providerAccountId),
      rangeKey,
    ],
    enabled: !!account && target.kind === "pr",
    queryFn: async () => {
      const kit = await octokit(requireAccount(account));
      if (range) {
        const { data } = await kit.rest.repos.compareCommits({
          owner: target.owner,
          repo: target.repo,
          base: range.baseSha,
          head: range.headSha,
          per_page: 100,
        });
        return data.files ?? [];
      }
      const { data } = await kit.rest.pulls.listFiles({
        owner: target.owner,
        repo: target.repo,
        pull_number: target.number,
        per_page: 100,
      });
      return data;
    },
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

export function useGitHubPRCommits(
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  return useQuery({
    queryKey: githubDetailKeys.prCommits(target, account?.providerAccountId),
    enabled: !!account && target.kind === "pr",
    queryFn: async () => {
      const kit = await octokit(requireAccount(account));
      const { data } = await kit.rest.pulls.listCommits({
        owner: target.owner,
        repo: target.repo,
        pull_number: target.number,
        per_page: 250,
      });
      return data;
    },
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

/**
 * Fetch full file contents at a given ref for hidden-chunk expansion.
 * Returns null when file is too large / binary / missing.
 */
export function useGitHubFileContents(
  target: Pick<ReviewTarget, "owner" | "repo">,
  account: OAuthConnection | null,
  path: string,
  ref: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: githubDetailKeys.fileContents(
      target,
      account?.providerAccountId,
      path,
      ref ?? "",
    ),
    enabled: !!account && !!ref && enabled,
    queryFn: async (): Promise<string | null> => {
      const kit = await octokit(requireAccount(account));
      try {
        const { data } = await kit.rest.repos.getContent({
          owner: target.owner,
          repo: target.repo,
          path,
          ref: ref!,
        });
        if (Array.isArray(data)) return null;
        if (data.type !== "file") return null;
        // `content` missing / empty indicates > 1MB, symlink, or submodule.
        if (!("content" in data) || !data.content) return null;
        return decodeBase64Utf8(data.content);
      } catch {
        return null;
      }
    },
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

export function useMarkFileViewed(
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      fileSha,
      viewed,
    }: {
      fileSha: string;
      viewed: boolean;
    }) => {
      const kit = await octokit(requireAccount(account));
      const method = viewed ? "PUT" : "DELETE";
      await kit.request(
        `${method} /repos/{owner}/{repo}/pulls/{pull_number}/files/{file_sha}/viewed`,
        {
          owner: target.owner,
          repo: target.repo,
          pull_number: target.number,
          file_sha: fileSha,
        },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: githubDetailKeys.prFiles(
          target,
          account?.providerAccountId,
        ),
      });
    },
  });
}

export type ReactionContent =
  | "+1"
  | "-1"
  | "laugh"
  | "hooray"
  | "confused"
  | "heart"
  | "rocket"
  | "eyes";

export const REACTION_CONTENTS: ReactionContent[] = [
  "+1",
  "-1",
  "laugh",
  "hooray",
  "confused",
  "heart",
  "rocket",
  "eyes",
];

export type ReactionSummary = Partial<Record<ReactionContent, number>>;

export type ReactionScope =
  | { kind: "issue-comment"; commentId: number }
  | { kind: "pr-review-comment"; commentId: number }
  | { kind: "issue"; issueNumber: number };

export type TimelineEvent = {
  id: string | number;
  kind: "comment" | "review" | "commit" | "event";
  author: { login: string; avatarUrl: string } | null;
  body?: string;
  createdAt: string;
  meta?: string;
  reactions?: ReactionSummary;
  reactionScope?: ReactionScope;
};

function toReactionSummary(
  r:
    | {
        "+1"?: number;
        "-1"?: number;
        laugh?: number;
        hooray?: number;
        confused?: number;
        heart?: number;
        rocket?: number;
        eyes?: number;
      }
    | null
    | undefined,
): ReactionSummary {
  if (!r) return {};
  const out: ReactionSummary = {};
  for (const k of REACTION_CONTENTS) {
    const v = (r as Record<string, number | undefined>)[k];
    if (v && v > 0) out[k] = v;
  }
  return out;
}

export function useGitHubPRTimeline(
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  return useQuery({
    queryKey: githubDetailKeys.prTimeline(target, account?.providerAccountId),
    enabled: !!account && target.kind === "pr",
    queryFn: async (): Promise<TimelineEvent[]> => {
      const kit = await octokit(requireAccount(account));
      const [comments, reviews] = await Promise.all([
        kit.rest.issues.listComments({
          owner: target.owner,
          repo: target.repo,
          issue_number: target.number,
          per_page: 100,
        }),
        kit.rest.pulls.listReviews({
          owner: target.owner,
          repo: target.repo,
          pull_number: target.number,
          per_page: 100,
        }),
      ]);
      const events: TimelineEvent[] = [
        ...comments.data.map((c) => ({
          id: c.id,
          kind: "comment" as const,
          author: c.user
            ? { login: c.user.login, avatarUrl: c.user.avatar_url }
            : null,
          body: c.body ?? "",
          createdAt: c.created_at,
          reactions: toReactionSummary(c.reactions),
          reactionScope: {
            kind: "issue-comment" as const,
            commentId: c.id,
          },
        })),
        ...reviews.data.map((r) => ({
          id: `review-${r.id}`,
          kind: "review" as const,
          author: r.user
            ? { login: r.user.login, avatarUrl: r.user.avatar_url }
            : null,
          body: r.body ?? "",
          createdAt: r.submitted_at ?? new Date().toISOString(),
          meta: r.state,
        })),
      ];
      events.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return events;
    },
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

export type CheckItem = {
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
};

export function useGitHubPRChecks(
  target: ReviewTarget,
  account: OAuthConnection | null,
  headSha: string | null | undefined,
) {
  return useQuery({
    queryKey: [
      ...githubDetailKeys.prChecks(target, account?.providerAccountId),
      headSha ?? null,
    ],
    enabled: !!account && !!headSha && target.kind === "pr",
    queryFn: async (): Promise<CheckItem[]> => {
      const kit = await octokit(requireAccount(account));
      const { data } = await kit.rest.checks.listForRef({
        owner: target.owner,
        repo: target.repo,
        ref: headSha!,
        per_page: 100,
      });
      return data.check_runs.map((c) => ({
        name: c.name,
        status: c.status,
        conclusion: c.conclusion,
        detailsUrl: c.details_url,
      }));
    },
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

/**
 * Stack detection: finds PRs whose `head` is our `base` (parent / below us in
 * the stack) and whose `base` is our `head` (children / above us).
 *
 * Uses GitHub search because the stacked-PRs REST surface is limited.
 */
export type StackNode = {
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  isCurrent: boolean;
  url: string;
};

export function useGitHubPRStack(
  target: ReviewTarget,
  account: OAuthConnection | null,
  pr:
    | {
        number: number;
        title: string;
        html_url: string;
        state: string;
        merged: boolean | null | undefined;
        head: { ref: string };
        base: { ref: string };
      }
    | null
    | undefined,
) {
  return useQuery({
    queryKey: [
      ...githubDetailKeys.prStack(target, account?.providerAccountId),
      pr?.head.ref ?? null,
      pr?.base.ref ?? null,
    ],
    enabled: !!account && !!pr && target.kind === "pr",
    queryFn: async (): Promise<StackNode[]> => {
      if (!pr) return [];
      const kit = await octokit(requireAccount(account));
      const [parents, children] = await Promise.all([
        kit.rest.pulls.list({
          owner: target.owner,
          repo: target.repo,
          head: `${target.owner}:${pr.base.ref}`,
          state: "all",
          per_page: 5,
        }),
        kit.rest.pulls.list({
          owner: target.owner,
          repo: target.repo,
          base: pr.head.ref,
          state: "all",
          per_page: 5,
        }),
      ]);

      const toNode = (p: typeof parents.data[number]): StackNode => ({
        number: p.number,
        title: p.title,
        state: p.merged_at ? "merged" : (p.state as "open" | "closed"),
        isCurrent: false,
        url: p.html_url,
      });

      const current: StackNode = {
        number: pr.number,
        title: pr.title,
        state: pr.merged ? "merged" : (pr.state as "open" | "closed"),
        isCurrent: true,
        url: pr.html_url,
      };

      return [
        ...children.data.map(toNode),
        current,
        ...parents.data.map(toNode),
      ];
    },
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

export type ReviewCommentUser = { login: string; avatarUrl: string } | null;

export type ReviewComment = {
  id: number;
  inReplyToId: number | null;
  path: string;
  line: number | null;
  originalLine: number | null;
  side: "LEFT" | "RIGHT";
  position: number | null;
  body: string;
  createdAt: string;
  user: ReviewCommentUser;
  threadId: string | null;
  isResolved: boolean;
};

type ReviewThreadGQL = {
  id: string;
  isResolved: boolean;
  comments: { nodes: Array<{ databaseId: number | null }> };
};

type ReviewThreadsQuery = {
  repository: {
    pullRequest: {
      reviewThreads: {
        nodes: ReviewThreadGQL[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } | null;
  } | null;
};

async function fetchAllReviewThreads(
  kit: InstanceType<typeof Octokit>,
  target: ReviewTarget,
): Promise<Map<number, { threadId: string; isResolved: boolean }>> {
  const byCommentId = new Map<
    number,
    { threadId: string; isResolved: boolean }
  >();
  let cursor: string | null = null;
  while (true) {
    const res: ReviewThreadsQuery = await kit.graphql(
      `query($owner:String!,$repo:String!,$number:Int!,$cursor:String){
        repository(owner:$owner,name:$repo){
          pullRequest(number:$number){
            reviewThreads(first:100,after:$cursor){
              nodes{
                id
                isResolved
                comments(first:100){ nodes{ databaseId } }
              }
              pageInfo{ hasNextPage endCursor }
            }
          }
        }
      }`,
      {
        owner: target.owner,
        repo: target.repo,
        number: target.number,
        cursor,
      },
    );
    const threads = res.repository?.pullRequest?.reviewThreads;
    if (!threads) break;
    for (const t of threads.nodes) {
      for (const c of t.comments.nodes) {
        if (c.databaseId != null) {
          byCommentId.set(c.databaseId, {
            threadId: t.id,
            isResolved: t.isResolved,
          });
        }
      }
    }
    if (!threads.pageInfo.hasNextPage) break;
    cursor = threads.pageInfo.endCursor;
    if (!cursor) break;
  }
  return byCommentId;
}

export function useGitHubPRReviewComments(
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  return useQuery({
    queryKey: githubDetailKeys.prReviewComments(target, account?.providerAccountId),
    enabled: !!account && target.kind === "pr",
    queryFn: async (): Promise<Record<string, ReviewComment[]>> => {
      const kit = await octokit(requireAccount(account));
      const [{ data }, threadMap] = await Promise.all([
        kit.rest.pulls.listReviewComments({
          owner: target.owner,
          repo: target.repo,
          pull_number: target.number,
          per_page: 100,
        }),
        fetchAllReviewThreads(kit, target),
      ]);
      const normalized: ReviewComment[] = data.map((c) => {
        const thread = threadMap.get(c.id);
        return {
          id: c.id,
          inReplyToId: c.in_reply_to_id ?? null,
          path: c.path,
          line: c.line ?? null,
          originalLine: c.original_line ?? null,
          side: (c.side ?? "RIGHT") as "LEFT" | "RIGHT",
          position: c.position ?? null,
          body: c.body ?? "",
          createdAt: c.created_at,
          user: c.user
            ? { login: c.user.login, avatarUrl: c.user.avatar_url }
            : null,
          threadId: thread?.threadId ?? null,
          isResolved: thread?.isResolved ?? false,
        };
      });
      const grouped: Record<string, ReviewComment[]> = {};
      for (const c of normalized) {
        (grouped[c.path] ??= []).push(c);
      }
      for (const path of Object.keys(grouped)) {
        grouped[path]!.sort((a, b) => {
          const ap = a.position ?? a.line ?? 0;
          const bp = b.position ?? b.line ?? 0;
          if (ap !== bp) return ap - bp;
          return a.createdAt.localeCompare(b.createdAt);
        });
      }
      return grouped;
    },
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

export function useReplyReviewComment(
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { commentId: number; body: string }) => {
      const kit = await octokit(requireAccount(account));
      const { data } = await kit.rest.pulls.createReplyForReviewComment({
        owner: target.owner,
        repo: target.repo,
        pull_number: target.number,
        comment_id: args.commentId,
        body: args.body,
      });
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: githubDetailKeys.prReviewComments(
          target,
          account?.providerAccountId,
        ),
      });
      void queryClient.invalidateQueries({
        queryKey: githubDetailKeys.prTimeline(
          target,
          account?.providerAccountId,
        ),
      });
    },
  });
}

export function useResolveReviewThread(
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { threadId: string; resolve: boolean }) => {
      const kit = await octokit(requireAccount(account));
      const mutation = args.resolve
        ? `mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ id isResolved } } }`
        : `mutation($id:ID!){ unresolveReviewThread(input:{threadId:$id}){ thread{ id isResolved } } }`;
      return kit.graphql(mutation, { id: args.threadId });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: githubDetailKeys.prReviewComments(
          target,
          account?.providerAccountId,
        ),
      });
    },
  });
}

export function useGitHubIssueDetail(
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  return useQuery({
    queryKey: githubDetailKeys.issue(target, account?.providerAccountId),
    enabled: !!account && target.kind === "issue",
    queryFn: async () => {
      const kit = await octokit(requireAccount(account));
      const { data } = await kit.rest.issues.get({
        owner: target.owner,
        repo: target.repo,
        issue_number: target.number,
      });
      return data;
    },
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

export function useGitHubIssueTimeline(
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  return useQuery({
    queryKey: githubDetailKeys.issueTimeline(target, account?.providerAccountId),
    enabled: !!account && target.kind === "issue",
    queryFn: async (): Promise<TimelineEvent[]> => {
      const kit = await octokit(requireAccount(account));
      const { data } = await kit.rest.issues.listComments({
        owner: target.owner,
        repo: target.repo,
        issue_number: target.number,
        per_page: 100,
      });
      return data.map((c) => ({
        id: c.id,
        kind: "comment",
        author: c.user
          ? { login: c.user.login, avatarUrl: c.user.avatar_url }
          : null,
        body: c.body ?? "",
        createdAt: c.created_at,
        reactions: toReactionSummary(c.reactions),
        reactionScope: { kind: "issue-comment", commentId: c.id },
      }));
    },
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

export type DeploymentSummary = {
  id: number;
  environment: string;
  state: string;
  url: string | null;
  logUrl: string | null;
  updatedAt: string;
  creator: { login: string; avatarUrl: string } | null;
};

export function useGitHubPRDeployments(
  target: ReviewTarget,
  account: OAuthConnection | null,
  headSha: string | null | undefined,
) {
  return useQuery({
    queryKey: githubDetailKeys.prDeployments(
      target,
      account?.providerAccountId,
      headSha,
    ),
    enabled: !!account && !!headSha && target.kind === "pr",
    queryFn: async (): Promise<DeploymentSummary[]> => {
      const kit = await octokit(requireAccount(account));
      const { data: deployments } = await kit.rest.repos.listDeployments({
        owner: target.owner,
        repo: target.repo,
        sha: headSha!,
        per_page: 10,
      });
      const withStatus = await Promise.all(
        deployments.map(async (d) => {
          const { data: statuses } =
            await kit.rest.repos.listDeploymentStatuses({
              owner: target.owner,
              repo: target.repo,
              deployment_id: d.id,
              per_page: 1,
            });
          const s = statuses[0];
          return {
            id: d.id,
            environment: d.environment ?? "unknown",
            state: s?.state ?? "pending",
            url: s?.environment_url ?? null,
            logUrl: s?.log_url ?? s?.target_url ?? null,
            updatedAt: s?.updated_at ?? d.updated_at,
            creator: d.creator
              ? { login: d.creator.login, avatarUrl: d.creator.avatar_url }
              : null,
          } satisfies DeploymentSummary;
        }),
      );
      const byEnv = new Map<string, DeploymentSummary>();
      for (const dep of withStatus) {
        const prev = byEnv.get(dep.environment);
        if (!prev || prev.updatedAt < dep.updatedAt) {
          byEnv.set(dep.environment, dep);
        }
      }
      return Array.from(byEnv.values()).sort((a, b) =>
        a.environment.localeCompare(b.environment),
      );
    },
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

export function useGitHubRepoLabels(
  target: Pick<ReviewTarget, "owner" | "repo">,
  account: OAuthConnection | null,
) {
  return useQuery({
    queryKey: githubDetailKeys.repoLabels(target, account?.providerAccountId),
    enabled: !!account,
    queryFn: async () => {
      const kit = await octokit(requireAccount(account));
      const { data } = await kit.rest.issues.listLabelsForRepo({
        owner: target.owner,
        repo: target.repo,
        per_page: 100,
      });
      return data;
    },
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

export function useGitHubRepoAssignees(
  target: Pick<ReviewTarget, "owner" | "repo">,
  account: OAuthConnection | null,
) {
  return useQuery({
    queryKey: githubDetailKeys.repoAssignees(target, account?.providerAccountId),
    enabled: !!account,
    queryFn: async () => {
      const kit = await octokit(requireAccount(account));
      const { data } = await kit.rest.issues.listAssignees({
        owner: target.owner,
        repo: target.repo,
        per_page: 100,
      });
      return data;
    },
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

export function useGitHubRepoMilestones(
  target: Pick<ReviewTarget, "owner" | "repo">,
  account: OAuthConnection | null,
) {
  return useQuery({
    queryKey: githubDetailKeys.repoMilestones(
      target,
      account?.providerAccountId,
    ),
    enabled: !!account,
    queryFn: async () => {
      const kit = await octokit(requireAccount(account));
      const { data } = await kit.rest.issues.listMilestones({
        owner: target.owner,
        repo: target.repo,
        state: "open",
        per_page: 100,
      });
      return data;
    },
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

function invalidateIssueQueries(
  qc: ReturnType<typeof useQueryClient>,
  target: ReviewTarget,
  accountId: string | null | undefined,
) {
  qc.invalidateQueries({ queryKey: githubDetailKeys.issue(target, accountId) });
  qc.invalidateQueries({
    queryKey: githubDetailKeys.issueTimeline(target, accountId),
  });
  qc.invalidateQueries({ queryKey: githubDetailKeys.pr(target, accountId) });
  qc.invalidateQueries({
    queryKey: githubDetailKeys.prTimeline(target, accountId),
  });
}

type IssueKit = Awaited<ReturnType<typeof octokit>>;

function useIssueUpdateMutation<TArgs>(
  target: ReviewTarget,
  account: OAuthConnection | null,
  run: (kit: IssueKit, target: ReviewTarget, args: TArgs) => Promise<void>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: TArgs) => {
      const kit = await octokit(requireAccount(account));
      await run(kit, target, args);
    },
    onSuccess: () =>
      invalidateIssueQueries(qc, target, account?.providerAccountId),
  });
}

export function useIssueLabelsMutation(
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  return useIssueUpdateMutation<{ name: string; enabled: boolean }>(
    target,
    account,
    async (kit, t, { name, enabled }) => {
      if (enabled) {
        await kit.rest.issues.addLabels({
          owner: t.owner,
          repo: t.repo,
          issue_number: t.number,
          labels: [name],
        });
      } else {
        await kit.rest.issues.removeLabel({
          owner: t.owner,
          repo: t.repo,
          issue_number: t.number,
          name,
        });
      }
    },
  );
}

export function useIssueAssigneesMutation(
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  return useIssueUpdateMutation<{ login: string; enabled: boolean }>(
    target,
    account,
    async (kit, t, { login, enabled }) => {
      if (enabled) {
        await kit.rest.issues.addAssignees({
          owner: t.owner,
          repo: t.repo,
          issue_number: t.number,
          assignees: [login],
        });
      } else {
        await kit.rest.issues.removeAssignees({
          owner: t.owner,
          repo: t.repo,
          issue_number: t.number,
          assignees: [login],
        });
      }
    },
  );
}

export function useIssueMilestoneMutation(
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  return useIssueUpdateMutation<{ milestone: number | null }>(
    target,
    account,
    async (kit, t, { milestone }) => {
      await kit.rest.issues.update({
        owner: t.owner,
        repo: t.repo,
        issue_number: t.number,
        milestone,
      });
    },
  );
}

export function useIssueStateMutation(
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  return useIssueUpdateMutation<{ state: "open" | "closed" }>(
    target,
    account,
    async (kit, t, { state }) => {
      await kit.rest.issues.update({
        owner: t.owner,
        repo: t.repo,
        issue_number: t.number,
        state,
      });
    },
  );
}

export function useReactionMutation(
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      scope,
      content,
      existingReactionId,
    }: {
      scope: ReactionScope;
      content: ReactionContent;
      existingReactionId: number | null;
    }) => {
      const kit = await octokit(requireAccount(account));
      if (existingReactionId != null) {
        if (scope.kind === "issue-comment") {
          await kit.rest.reactions.deleteForIssueComment({
            owner: target.owner,
            repo: target.repo,
            comment_id: scope.commentId,
            reaction_id: existingReactionId,
          });
        } else if (scope.kind === "pr-review-comment") {
          await kit.rest.reactions.deleteForPullRequestComment({
            owner: target.owner,
            repo: target.repo,
            comment_id: scope.commentId,
            reaction_id: existingReactionId,
          });
        } else {
          await kit.rest.reactions.deleteForIssue({
            owner: target.owner,
            repo: target.repo,
            issue_number: scope.issueNumber,
            reaction_id: existingReactionId,
          });
        }
        return null;
      }
      if (scope.kind === "issue-comment") {
        const { data } = await kit.rest.reactions.createForIssueComment({
          owner: target.owner,
          repo: target.repo,
          comment_id: scope.commentId,
          content,
        });
        return data.id;
      }
      if (scope.kind === "pr-review-comment") {
        const { data } =
          await kit.rest.reactions.createForPullRequestReviewComment({
            owner: target.owner,
            repo: target.repo,
            comment_id: scope.commentId,
            content,
          });
        return data.id;
      }
      const { data } = await kit.rest.reactions.createForIssue({
        owner: target.owner,
        repo: target.repo,
        issue_number: scope.issueNumber,
        content,
      });
      return data.id;
    },
    onSuccess: () => {
      const accountId = account?.providerAccountId;
      qc.invalidateQueries({
        queryKey: githubDetailKeys.prTimeline(target, accountId),
      });
      qc.invalidateQueries({
        queryKey: githubDetailKeys.issueTimeline(target, accountId),
      });
      qc.invalidateQueries({
        queryKey: githubDetailKeys.prReviewComments(target, accountId),
      });
    },
  });
}

export function useApplySuggestionMutation(
  target: Pick<ReviewTarget, "owner" | "repo">,
  account: OAuthConnection | null,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      path,
      branch,
      startLine,
      endLine,
      replacement,
    }: {
      path: string;
      branch: string;
      startLine: number;
      endLine: number;
      replacement: string;
    }) => {
      const kit = await octokit(requireAccount(account));
      const { data } = await kit.rest.repos.getContent({
        owner: target.owner,
        repo: target.repo,
        path,
        ref: branch,
      });
      if (Array.isArray(data) || data.type !== "file" || !("content" in data)) {
        throw new Error(
          `Cannot apply suggestion to ${path}@${branch}: file unavailable (binary, missing, directory, or too large)`,
        );
      }
      const current = decodeBase64Utf8(data.content);
      const lines = current.split("\n");
      const before = lines.slice(0, Math.max(0, startLine - 1));
      const after = lines.slice(endLine);
      const replacementLines = replacement.split("\n");
      const next = [...before, ...replacementLines, ...after].join("\n");
      const encoded = encodeBase64Utf8(next);
      await kit.rest.repos.createOrUpdateFileContents({
        owner: target.owner,
        repo: target.repo,
        path,
        message: "Apply suggestion",
        content: encoded,
        sha: data.sha,
        branch,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["github", "pr-files"] });
      qc.invalidateQueries({ queryKey: ["github", "pr-timeline"] });
      qc.invalidateQueries({ queryKey: ["github", "pr-review-comments"] });
      qc.invalidateQueries({ queryKey: ["github", "file-contents"] });
    },
  });
}
