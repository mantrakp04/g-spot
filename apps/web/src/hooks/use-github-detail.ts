import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Octokit } from "octokit";
import type { OAuthConnection } from "@stackframe/react";

import {
  getGitHubOctokit,
  requireGitHubAccount,
} from "@/lib/github/client";
import { normalizePullRequestFiles } from "@/lib/github/pr-files";
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
  repoBranches: (
    t: Pick<ReviewTarget, "owner" | "repo">,
    accountId: string | null | undefined,
  ) =>
    ["github", "repo-branches", accountId ?? null, t.owner, t.repo] as const,
};

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

const GITHUB_CONSISTENCY_OVERRIDE_TTL_MS = 2 * 60 * 1000;

type DetailConsistencyOverride<T> = {
  requestedAt: number;
  apply: (data: T) => T;
  isSatisfied: (data: T) => boolean;
};

const detailConsistencyOverrides = new Map<
  string,
  DetailConsistencyOverride<unknown>[]
>();

function detailConsistencyKey(queryKey: readonly unknown[]) {
  return JSON.stringify(queryKey);
}

function rememberDetailConsistencyOverride<T>(
  queryKey: readonly unknown[],
  override: Omit<DetailConsistencyOverride<T>, "requestedAt">,
) {
  const key = detailConsistencyKey(queryKey);
  const existing =
    (detailConsistencyOverrides.get(key) as
      | DetailConsistencyOverride<T>[]
      | undefined) ?? [];
  detailConsistencyOverrides.set(key, [
    ...existing,
    { ...override, requestedAt: Date.now() },
  ] as DetailConsistencyOverride<unknown>[]);
}

function hasDetailConsistencyOverride(queryKey: readonly unknown[]) {
  const overrides = detailConsistencyOverrides.get(detailConsistencyKey(queryKey));
  return !!overrides && overrides.length > 0;
}

function applyDetailConsistencyOverrides<T>(
  queryKey: readonly unknown[],
  data: T,
) {
  const key = detailConsistencyKey(queryKey);
  const overrides = detailConsistencyOverrides.get(key) as
    | DetailConsistencyOverride<T>[]
    | undefined;
  if (!overrides?.length) return data;

  const now = Date.now();
  let next = data;
  const active: DetailConsistencyOverride<T>[] = [];
  for (const override of overrides) {
    const expired =
      now - override.requestedAt > GITHUB_CONSISTENCY_OVERRIDE_TTL_MS;
    if (expired || override.isSatisfied(next)) continue;
    next = override.apply(next);
    active.push(override);
  }

  if (active.length > 0) {
    detailConsistencyOverrides.set(
      key,
      active as DetailConsistencyOverride<unknown>[],
    );
  } else {
    detailConsistencyOverrides.delete(key);
  }

  return next;
}

export function useGitHubPRDetail(
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  const accountId = account?.providerAccountId;
  const queryKey = githubDetailKeys.pr(target, accountId);
  return useQuery({
    queryKey,
    enabled: !!account && target.kind === "pr",
    queryFn: async () => {
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
      const { data } = await kit.rest.pulls.get({
        owner: target.owner,
        repo: target.repo,
        pull_number: target.number,
      });
      return applyDetailConsistencyOverrides(queryKey, data);
    },
    refetchInterval: () =>
      hasDetailConsistencyOverride(queryKey) ? 3000 : false,
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
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
      if (range) {
        const { data } = await kit.rest.repos.compareCommits({
          owner: target.owner,
          repo: target.repo,
          base: range.baseSha,
          head: range.headSha,
          per_page: 100,
        });
        return normalizePullRequestFiles(data.files ?? [], {
          owner: target.owner,
          repo: target.repo,
          number: target.number,
          rangeKey,
        });
      }
      const { data } = await kit.rest.pulls.listFiles({
        owner: target.owner,
        repo: target.repo,
        pull_number: target.number,
        per_page: 100,
      });
      return normalizePullRequestFiles(data, {
        owner: target.owner,
        repo: target.repo,
        number: target.number,
        rangeKey,
      });
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
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
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
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
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
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
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
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
  appSlug: string | null;
  checkSuiteId: number | null;
  externalId: string | null;
};

const CHECK_RERUN_OVERRIDE_TTL_MS = 2 * 60 * 1000;

type CheckRerunOverride = {
  requestedAt: number;
  previousCompletedAt: string | null;
};

const checkRerunOverrides = new Map<string, Map<number, CheckRerunOverride>>();

function prChecksQueryKey(
  target: ReviewTarget,
  accountId: string | null | undefined,
  headSha: string | null | undefined,
) {
  return [
    ...githubDetailKeys.prChecks(target, accountId),
    headSha ?? null,
  ] as const;
}

function checkRerunOverrideKey(
  target: ReviewTarget,
  accountId: string | null | undefined,
  headSha: string | null | undefined,
) {
  return JSON.stringify(prChecksQueryKey(target, accountId, headSha));
}

function hasCheckRerunOverride(
  target: ReviewTarget,
  accountId: string | null | undefined,
  headSha: string | null | undefined,
) {
  const byCheck = checkRerunOverrides.get(
    checkRerunOverrideKey(target, accountId, headSha),
  );
  return !!byCheck && byCheck.size > 0;
}

function rememberCheckRerun(
  target: ReviewTarget,
  accountId: string | null | undefined,
  headSha: string | null | undefined,
  check: CheckItem,
) {
  const key = checkRerunOverrideKey(target, accountId, headSha);
  const byCheck =
    checkRerunOverrides.get(key) ?? new Map<number, CheckRerunOverride>();
  byCheck.set(check.id, {
    requestedAt: Date.now(),
    previousCompletedAt: check.completedAt,
  });
  checkRerunOverrides.set(key, byCheck);
}

function applyCheckRerunOverrides(
  target: ReviewTarget,
  accountId: string | null | undefined,
  headSha: string | null | undefined,
  checks: CheckItem[],
) {
  const key = checkRerunOverrideKey(target, accountId, headSha);
  const byCheck = checkRerunOverrides.get(key);
  if (!byCheck) return checks;

  const now = Date.now();
  let changed = false;
  const next = checks.map((check) => {
    const override = byCheck.get(check.id);
    if (!override) return check;

    const expired = now - override.requestedAt > CHECK_RERUN_OVERRIDE_TTL_MS;
    const isFailedCompletion =
      check.conclusion === "failure" ||
      check.conclusion === "timed_out" ||
      check.conclusion === "cancelled";
    const completedAt = check.completedAt ? Date.parse(check.completedAt) : NaN;
    const isFreshCompletion =
      check.completedAt !== override.previousCompletedAt &&
      (!Number.isFinite(completedAt) || completedAt > override.requestedAt - 1000);

    if (
      expired ||
      check.status !== "completed" ||
      !isFailedCompletion ||
      isFreshCompletion
    ) {
      byCheck.delete(check.id);
      return check;
    }

    changed = true;
    return {
      ...check,
      status: "queued",
      conclusion: null,
      startedAt: null,
      completedAt: null,
    };
  });

  if (byCheck.size === 0) {
    checkRerunOverrides.delete(key);
  }

  return changed ? next : checks;
}

export function useGitHubPRChecks(
  target: ReviewTarget,
  account: OAuthConnection | null,
  headSha: string | null | undefined,
) {
  const accountId = account?.providerAccountId;
  return useQuery({
    queryKey: prChecksQueryKey(target, accountId, headSha),
    enabled: !!account && !!headSha && target.kind === "pr",
    queryFn: async (): Promise<CheckItem[]> => {
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
      const { data } = await kit.rest.checks.listForRef({
        owner: target.owner,
        repo: target.repo,
        ref: headSha!,
        per_page: 100,
      });
      const checks = data.check_runs.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        conclusion: c.conclusion,
        detailsUrl: c.details_url,
        startedAt: c.started_at ?? null,
        completedAt: c.completed_at ?? null,
        appSlug: c.app?.slug ?? null,
        checkSuiteId: c.check_suite?.id ?? null,
        externalId: c.external_id ?? null,
      }));
      return applyCheckRerunOverrides(target, accountId, headSha, checks);
    },
    refetchInterval: (query) => {
      const checks = query.state.data;
      if (hasCheckRerunOverride(target, accountId, headSha)) return 3000;
      return checks?.some((check) => check.status !== "completed")
        ? 3000
        : false;
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
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
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
  htmlUrl: string;
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
  const accountId = account?.providerAccountId;
  const queryKey = githubDetailKeys.prReviewComments(target, accountId);
  return useQuery({
    queryKey,
    enabled: !!account && target.kind === "pr",
    queryFn: async (): Promise<Record<string, ReviewComment[]>> => {
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
      const [data, threadMap] = await Promise.all([
        kit.paginate(kit.rest.pulls.listReviewComments, {
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
          htmlUrl: c.html_url,
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
      return applyDetailConsistencyOverrides(queryKey, grouped);
    },
    refetchInterval: () =>
      hasDetailConsistencyOverride(queryKey) ? 3000 : false,
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
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
      const { data } = await kit.rest.pulls.createReplyForReviewComment({
        owner: target.owner,
        repo: target.repo,
        pull_number: target.number,
        comment_id: args.commentId,
        body: args.body,
      });
      return data;
    },
    onSuccess: async (comment) => {
      rememberDetailConsistencyOverride(
        githubDetailKeys.prReviewComments(
          target,
          account?.providerAccountId,
        ),
        {
          apply: (prev: Record<string, ReviewComment[]>) => {
            const path = comment.path;
            const existing = prev[path] ?? [];
            if (existing.some((item) => item.id === comment.id)) return prev;
            return {
              ...prev,
              [path]: [
                ...existing,
                {
                  id: comment.id,
                  htmlUrl: comment.html_url,
                  inReplyToId: comment.in_reply_to_id ?? null,
                  path,
                  line: comment.line ?? null,
                  originalLine: comment.original_line ?? null,
                  side: (comment.side ?? "RIGHT") as "LEFT" | "RIGHT",
                  position: comment.position ?? null,
                  body: comment.body ?? "",
                  createdAt: comment.created_at,
                  user: comment.user
                    ? {
                        login: comment.user.login,
                        avatarUrl: comment.user.avatar_url,
                      }
                    : null,
                  threadId: null,
                  isResolved: false,
                },
              ],
            };
          },
          isSatisfied: (data: Record<string, ReviewComment[]>) =>
            Object.values(data)
              .flat()
              .some((item) => item.id === comment.id),
        },
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: githubDetailKeys.prReviewComments(
            target,
            account?.providerAccountId,
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: githubDetailKeys.prTimeline(
            target,
            account?.providerAccountId,
          ),
        }),
      ]);
    },
  });
}

export function useResolveReviewThread(
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  const qc = useQueryClient();
  const accountId = account?.providerAccountId;
  return useMutation({
    mutationFn: async (args: { threadId: string; resolve: boolean }) => {
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
      const mutation = args.resolve
        ? `mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ id isResolved } } }`
        : `mutation($id:ID!){ unresolveReviewThread(input:{threadId:$id}){ thread{ id isResolved } } }`;
      return kit.graphql(mutation, { id: args.threadId });
    },
    onMutate: async ({ threadId, resolve }) => {
      const key = githubDetailKeys.prReviewComments(target, accountId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Record<string, ReviewComment[]>>(key);
      if (prev) {
        const next: Record<string, ReviewComment[]> = {};
        for (const path of Object.keys(prev)) {
          next[path] = prev[path]!.map((c) =>
            c.threadId === threadId ? { ...c, isResolved: resolve } : c,
          );
        }
        qc.setQueryData(key, next);
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(
          githubDetailKeys.prReviewComments(target, accountId),
          ctx.prev,
        );
      }
    },
    onSuccess: (_data, { threadId, resolve }) => {
      const apply = (
        prev: Record<string, ReviewComment[]>,
      ): Record<string, ReviewComment[]> => {
        const next: Record<string, ReviewComment[]> = {};
        for (const path of Object.keys(prev)) {
          next[path] = prev[path]!.map((comment) =>
            comment.threadId === threadId
              ? { ...comment, isResolved: resolve }
              : comment,
          );
        }
        return next;
      };
      const isSatisfied = (data: Record<string, ReviewComment[]>) => {
        const matching = Object.values(data)
          .flat()
          .filter((comment) => comment.threadId === threadId);
        return (
          matching.length > 0 &&
          matching.every((comment) => comment.isResolved === resolve)
        );
      };
      rememberDetailConsistencyOverride(
        githubDetailKeys.prReviewComments(target, accountId),
        { apply, isSatisfied },
      );
    },
    onSettled: async () => {
      await qc.invalidateQueries({
        queryKey: githubDetailKeys.prReviewComments(target, accountId),
      });
    },
  });
}

export function useGitHubIssueDetail(
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  const accountId = account?.providerAccountId;
  const queryKey = githubDetailKeys.issue(target, accountId);
  return useQuery({
    queryKey,
    enabled: !!account && target.kind === "issue",
    queryFn: async () => {
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
      const { data } = await kit.rest.issues.get({
        owner: target.owner,
        repo: target.repo,
        issue_number: target.number,
      });
      return applyDetailConsistencyOverrides(queryKey, data);
    },
    refetchInterval: () =>
      hasDetailConsistencyOverride(queryKey) ? 3000 : false,
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
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
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
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
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
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
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
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
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
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
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
  return Promise.all([
    qc.invalidateQueries({
      queryKey: githubDetailKeys.issue(target, accountId),
    }),
    qc.invalidateQueries({
      queryKey: githubDetailKeys.issueTimeline(target, accountId),
    }),
    qc.invalidateQueries({ queryKey: githubDetailKeys.pr(target, accountId) }),
    qc.invalidateQueries({
      queryKey: githubDetailKeys.prTimeline(target, accountId),
    }),
  ]);
}

type IssueDetail = NonNullable<ReturnType<typeof useGitHubIssueDetail>["data"]>;
type PRDetail = NonNullable<ReturnType<typeof useGitHubPRDetail>["data"]>;
type RepoLabel = NonNullable<
  ReturnType<typeof useGitHubRepoLabels>["data"]
>[number];
type RepoAssignee = NonNullable<
  ReturnType<typeof useGitHubRepoAssignees>["data"]
>[number];
type RepoMilestone = NonNullable<
  ReturnType<typeof useGitHubRepoMilestones>["data"]
>[number];

function patchIssueAndPR(
  qc: ReturnType<typeof useQueryClient>,
  target: ReviewTarget,
  accountId: string | null | undefined,
  patchIssue: (prev: IssueDetail) => IssueDetail,
  patchPR: (prev: PRDetail) => PRDetail,
) {
  const issueKey = githubDetailKeys.issue(target, accountId);
  const prKey = githubDetailKeys.pr(target, accountId);
  const prevIssue = qc.getQueryData<IssueDetail>(issueKey);
  const prevPR = qc.getQueryData<PRDetail>(prKey);
  if (prevIssue) qc.setQueryData<IssueDetail>(issueKey, patchIssue(prevIssue));
  if (prevPR) qc.setQueryData<PRDetail>(prKey, patchPR(prevPR));
  return { prevIssue, prevPR };
}

function rollbackIssueAndPR(
  qc: ReturnType<typeof useQueryClient>,
  target: ReviewTarget,
  accountId: string | null | undefined,
  snapshot: { prevIssue?: IssueDetail; prevPR?: PRDetail },
) {
  if (snapshot.prevIssue) {
    qc.setQueryData(
      githubDetailKeys.issue(target, accountId),
      snapshot.prevIssue,
    );
  }
  if (snapshot.prevPR) {
    qc.setQueryData(githubDetailKeys.pr(target, accountId), snapshot.prevPR);
  }
}

function rememberIssueAndPRConsistency(
  target: ReviewTarget,
  accountId: string | null | undefined,
  args: {
    patchIssue: (prev: IssueDetail) => IssueDetail;
    patchPR: (prev: PRDetail) => PRDetail;
    issueSatisfied: (data: IssueDetail) => boolean;
    prSatisfied: (data: PRDetail) => boolean;
  },
) {
  rememberDetailConsistencyOverride(githubDetailKeys.issue(target, accountId), {
    apply: args.patchIssue,
    isSatisfied: args.issueSatisfied,
  });
  rememberDetailConsistencyOverride(githubDetailKeys.pr(target, accountId), {
    apply: args.patchPR,
    isSatisfied: args.prSatisfied,
  });
}

function hasNamedItem(items: unknown[] | null | undefined, name: string) {
  return (items ?? []).some((item) =>
    typeof item === "string"
      ? item === name
      : (item as { name?: string }).name === name,
  );
}

function hasLoginItem(
  items: Array<{ login?: string }> | null | undefined,
  login: string,
) {
  return (items ?? []).some((item) => item.login === login);
}

export function useIssueLabelsMutation(
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  const qc = useQueryClient();
  const accountId = account?.providerAccountId;
  return useMutation({
    mutationFn: async ({
      name,
      enabled,
    }: {
      name: string;
      enabled: boolean;
    }) => {
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
      if (enabled) {
        await kit.rest.issues.addLabels({
          owner: target.owner,
          repo: target.repo,
          issue_number: target.number,
          labels: [name],
        });
      } else {
        await kit.rest.issues.removeLabel({
          owner: target.owner,
          repo: target.repo,
          issue_number: target.number,
          name,
        });
      }
    },
    onMutate: async ({ name, enabled }) => {
      await qc.cancelQueries({
        queryKey: githubDetailKeys.issue(target, accountId),
      });
      await qc.cancelQueries({
        queryKey: githubDetailKeys.pr(target, accountId),
      });
      const repoLabels =
        qc.getQueryData<RepoLabel[]>(
          githubDetailKeys.repoLabels(target, accountId),
        ) ?? [];
      const labelObj = repoLabels.find((l) => l.name === name);
      const applyLabels = <T extends { labels: unknown[] }>(src: T): T => {
        const existing = src.labels;
        if (enabled) {
          const already = existing.some((l) =>
            typeof l === "string" ? l === name : (l as { name?: string }).name === name,
          );
          if (already) return src;
          return {
            ...src,
            labels: [
              ...existing,
              labelObj ?? { name, color: "ededed", description: null },
            ],
          };
        }
        return {
          ...src,
          labels: existing.filter((l) =>
            typeof l === "string"
              ? l !== name
              : (l as { name?: string }).name !== name,
          ),
        };
      };
      return patchIssueAndPR(qc, target, accountId, applyLabels, applyLabels);
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) rollbackIssueAndPR(qc, target, accountId, ctx);
    },
    onSuccess: (_data, { name, enabled }) => {
      const repoLabels =
        qc.getQueryData<RepoLabel[]>(
          githubDetailKeys.repoLabels(target, accountId),
        ) ?? [];
      const labelObj = repoLabels.find((l) => l.name === name);
      const applyLabels = <T extends { labels: unknown[] }>(src: T): T => {
        const existing = src.labels;
        if (enabled) {
          if (hasNamedItem(existing, name)) return src;
          return {
            ...src,
            labels: [
              ...existing,
              labelObj ?? { name, color: "ededed", description: null },
            ],
          };
        }
        return {
          ...src,
          labels: existing.filter((l) =>
            typeof l === "string"
              ? l !== name
              : (l as { name?: string }).name !== name,
          ),
        };
      };
      const isSatisfied = <T extends { labels: unknown[] }>(data: T) =>
        hasNamedItem(data.labels, name) === enabled;
      rememberIssueAndPRConsistency(target, accountId, {
        patchIssue: applyLabels,
        patchPR: applyLabels,
        issueSatisfied: isSatisfied,
        prSatisfied: isSatisfied,
      });
    },
    onSettled: async () => {
      await invalidateIssueQueries(qc, target, accountId);
    },
  });
}

export function useIssueAssigneesMutation(
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  const qc = useQueryClient();
  const accountId = account?.providerAccountId;
  return useMutation({
    mutationFn: async ({
      login,
      enabled,
    }: {
      login: string;
      enabled: boolean;
    }) => {
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
      if (enabled) {
        await kit.rest.issues.addAssignees({
          owner: target.owner,
          repo: target.repo,
          issue_number: target.number,
          assignees: [login],
        });
      } else {
        await kit.rest.issues.removeAssignees({
          owner: target.owner,
          repo: target.repo,
          issue_number: target.number,
          assignees: [login],
        });
      }
    },
    onMutate: async ({ login, enabled }) => {
      await qc.cancelQueries({
        queryKey: githubDetailKeys.issue(target, accountId),
      });
      await qc.cancelQueries({
        queryKey: githubDetailKeys.pr(target, accountId),
      });
      const repoAssignees =
        qc.getQueryData<RepoAssignee[]>(
          githubDetailKeys.repoAssignees(target, accountId),
        ) ?? [];
      const user = repoAssignees.find((a) => a.login === login);
      const applyAssignees = <
        T extends { assignees?: Array<{ login: string }> | null },
      >(
        src: T,
      ): T => {
        const existing = src.assignees ?? [];
        if (enabled) {
          if (existing.some((a) => a.login === login)) return src;
          const next = user ?? {
            login,
            id: -1,
            avatar_url: "",
            type: "User",
          };
          return { ...src, assignees: [...existing, next] as typeof existing };
        }
        return {
          ...src,
          assignees: existing.filter((a) => a.login !== login),
        };
      };
      return patchIssueAndPR(
        qc,
        target,
        accountId,
        applyAssignees,
        applyAssignees,
      );
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) rollbackIssueAndPR(qc, target, accountId, ctx);
    },
    onSuccess: (_data, { login, enabled }) => {
      const repoAssignees =
        qc.getQueryData<RepoAssignee[]>(
          githubDetailKeys.repoAssignees(target, accountId),
        ) ?? [];
      const user = repoAssignees.find((a) => a.login === login);
      const applyAssignees = <
        T extends { assignees?: Array<{ login: string }> | null },
      >(
        src: T,
      ): T => {
        const existing = src.assignees ?? [];
        if (enabled) {
          if (hasLoginItem(existing, login)) return src;
          const next = user ?? {
            login,
            id: -1,
            avatar_url: "",
            type: "User",
          };
          return { ...src, assignees: [...existing, next] as typeof existing };
        }
        return {
          ...src,
          assignees: existing.filter((a) => a.login !== login),
        };
      };
      const isSatisfied = <
        T extends { assignees?: Array<{ login: string }> | null },
      >(
        data: T,
      ) => hasLoginItem(data.assignees, login) === enabled;
      rememberIssueAndPRConsistency(target, accountId, {
        patchIssue: applyAssignees,
        patchPR: applyAssignees,
        issueSatisfied: isSatisfied,
        prSatisfied: isSatisfied,
      });
    },
    onSettled: async () => {
      await invalidateIssueQueries(qc, target, accountId);
    },
  });
}

export function useIssueMilestoneMutation(
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  const qc = useQueryClient();
  const accountId = account?.providerAccountId;
  return useMutation({
    mutationFn: async ({ milestone }: { milestone: number | null }) => {
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
      await kit.rest.issues.update({
        owner: target.owner,
        repo: target.repo,
        issue_number: target.number,
        milestone,
      });
    },
    onMutate: async ({ milestone }) => {
      await qc.cancelQueries({
        queryKey: githubDetailKeys.issue(target, accountId),
      });
      await qc.cancelQueries({
        queryKey: githubDetailKeys.pr(target, accountId),
      });
      const milestones =
        qc.getQueryData<RepoMilestone[]>(
          githubDetailKeys.repoMilestones(target, accountId),
        ) ?? [];
      const next =
        milestone == null
          ? null
          : (milestones.find((m) => m.number === milestone) ?? null);
      const apply = <T extends { milestone?: unknown }>(src: T): T =>
        ({ ...src, milestone: next } as T);
      return patchIssueAndPR(qc, target, accountId, apply, apply);
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) rollbackIssueAndPR(qc, target, accountId, ctx);
    },
    onSuccess: (_data, { milestone }) => {
      const milestones =
        qc.getQueryData<RepoMilestone[]>(
          githubDetailKeys.repoMilestones(target, accountId),
        ) ?? [];
      const next =
        milestone == null
          ? null
          : (milestones.find((m) => m.number === milestone) ?? null);
      const apply = <T extends { milestone?: unknown }>(src: T): T =>
        ({ ...src, milestone: next } as T);
      const isSatisfied = <T extends { milestone?: { number?: number } | null }>(
        data: T,
      ) => (data.milestone?.number ?? null) === milestone;
      rememberIssueAndPRConsistency(target, accountId, {
        patchIssue: apply,
        patchPR: apply,
        issueSatisfied: isSatisfied,
        prSatisfied: isSatisfied,
      });
    },
    onSettled: async () => {
      await invalidateIssueQueries(qc, target, accountId);
    },
  });
}

export function useIssueStateMutation(
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  const qc = useQueryClient();
  const accountId = account?.providerAccountId;
  return useMutation({
    mutationFn: async ({ state }: { state: "open" | "closed" }) => {
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
      await kit.rest.issues.update({
        owner: target.owner,
        repo: target.repo,
        issue_number: target.number,
        state,
      });
    },
    onMutate: async ({ state }) => {
      await qc.cancelQueries({
        queryKey: githubDetailKeys.issue(target, accountId),
      });
      await qc.cancelQueries({
        queryKey: githubDetailKeys.pr(target, accountId),
      });
      const apply = <T extends { state?: string }>(src: T): T =>
        ({ ...src, state } as T);
      return patchIssueAndPR(qc, target, accountId, apply, apply);
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) rollbackIssueAndPR(qc, target, accountId, ctx);
    },
    onSuccess: (_data, { state }) => {
      const apply = <T extends { state?: string }>(src: T): T =>
        ({ ...src, state } as T);
      const isSatisfied = <T extends { state?: string }>(data: T) =>
        data.state === state;
      rememberIssueAndPRConsistency(target, accountId, {
        patchIssue: apply,
        patchPR: apply,
        issueSatisfied: isSatisfied,
        prSatisfied: isSatisfied,
      });
    },
    onSettled: async () => {
      await invalidateIssueQueries(qc, target, accountId);
    },
  });
}

export function useGitHubViewer(account: OAuthConnection | null) {
  return useQuery({
    queryKey: ["github", "viewer", account?.providerAccountId ?? null] as const,
    enabled: !!account,
    queryFn: async () => {
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
      const { data } = await kit.rest.users.getAuthenticated();
      return data;
    },
    staleTime: 60 * 60 * 1000,
  });
}

function reactionScopeKey(scope: ReactionScope): string {
  if (scope.kind === "issue-comment") return `ic:${scope.commentId}`;
  if (scope.kind === "pr-review-comment") return `prc:${scope.commentId}`;
  return `i:${scope.issueNumber}`;
}

export const myReactionsKey = (
  target: ReviewTarget,
  accountId: string | null | undefined,
  scope: ReactionScope,
) =>
  [
    "github",
    "my-reactions",
    accountId ?? null,
    target.owner,
    target.repo,
    reactionScopeKey(scope),
  ] as const;

export type MyReactions = Partial<Record<ReactionContent, number>>;

export function useMyReactions(
  target: ReviewTarget,
  account: OAuthConnection | null,
  scope: ReactionScope,
  enabled: boolean,
) {
  return useQuery({
    queryKey: myReactionsKey(target, account?.providerAccountId, scope),
    enabled: !!account && enabled,
    queryFn: async (): Promise<MyReactions> => {
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
      const viewer = await kit.rest.users.getAuthenticated();
      const me = viewer.data.login;
      const list = await (scope.kind === "issue-comment"
        ? kit.rest.reactions.listForIssueComment({
            owner: target.owner,
            repo: target.repo,
            comment_id: scope.commentId,
            per_page: 100,
          })
        : scope.kind === "pr-review-comment"
          ? kit.rest.reactions.listForPullRequestReviewComment({
              owner: target.owner,
              repo: target.repo,
              comment_id: scope.commentId,
              per_page: 100,
            })
          : kit.rest.reactions.listForIssue({
              owner: target.owner,
              repo: target.repo,
              issue_number: scope.issueNumber,
              per_page: 100,
            }));
      const out: MyReactions = {};
      for (const r of list.data) {
        if (r.user?.login === me) {
          out[r.content as ReactionContent] = r.id;
        }
      }
      return out;
    },
    staleTime: 60 * 1000,
  });
}

function patchReactionCount(
  qc: ReturnType<typeof useQueryClient>,
  target: ReviewTarget,
  accountId: string | null | undefined,
  scope: ReactionScope,
  content: ReactionContent,
  delta: number,
) {
  const mutate = (events: TimelineEvent[] | undefined) => {
    if (!events) return events;
    return events.map((ev) => {
      if (!ev.reactionScope) return ev;
      if (reactionScopeKey(ev.reactionScope) !== reactionScopeKey(scope))
        return ev;
      const current = ev.reactions?.[content] ?? 0;
      const nextCount = Math.max(0, current + delta);
      const nextReactions: ReactionSummary = { ...(ev.reactions ?? {}) };
      if (nextCount === 0) {
        delete nextReactions[content];
      } else {
        nextReactions[content] = nextCount;
      }
      return { ...ev, reactions: nextReactions };
    });
  };
  qc.setQueryData<TimelineEvent[]>(
    githubDetailKeys.prTimeline(target, accountId),
    mutate,
  );
  qc.setQueryData<TimelineEvent[]>(
    githubDetailKeys.issueTimeline(target, accountId),
    mutate,
  );
}

export function useReactionMutation(
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  const qc = useQueryClient();
  const accountId = account?.providerAccountId;
  return useMutation({
    mutationFn: async ({
      scope,
      content,
    }: {
      scope: ReactionScope;
      content: ReactionContent;
    }) => {
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
      // Resolve viewer's existing reaction for this content via cache or fresh fetch.
      const cached = qc.getQueryData<MyReactions>(
        myReactionsKey(target, accountId, scope),
      );
      let existingId = cached?.[content];
      if (existingId == null) {
        const viewer = await kit.rest.users.getAuthenticated();
        const me = viewer.data.login;
        const list = await (scope.kind === "issue-comment"
          ? kit.rest.reactions.listForIssueComment({
              owner: target.owner,
              repo: target.repo,
              comment_id: scope.commentId,
              content,
              per_page: 100,
            })
          : scope.kind === "pr-review-comment"
            ? kit.rest.reactions.listForPullRequestReviewComment({
                owner: target.owner,
                repo: target.repo,
                comment_id: scope.commentId,
                content,
                per_page: 100,
              })
            : kit.rest.reactions.listForIssue({
                owner: target.owner,
                repo: target.repo,
                issue_number: scope.issueNumber,
                content,
                per_page: 100,
              }));
        const mine = list.data.find((r) => r.user?.login === me);
        existingId = mine?.id;
      }
      if (existingId != null) {
        if (scope.kind === "issue-comment") {
          await kit.rest.reactions.deleteForIssueComment({
            owner: target.owner,
            repo: target.repo,
            comment_id: scope.commentId,
            reaction_id: existingId,
          });
        } else if (scope.kind === "pr-review-comment") {
          await kit.rest.reactions.deleteForPullRequestComment({
            owner: target.owner,
            repo: target.repo,
            comment_id: scope.commentId,
            reaction_id: existingId,
          });
        } else {
          await kit.rest.reactions.deleteForIssue({
            owner: target.owner,
            repo: target.repo,
            issue_number: scope.issueNumber,
            reaction_id: existingId,
          });
        }
        return { action: "removed" as const, reactionId: existingId };
      }
      if (scope.kind === "issue-comment") {
        const { data } = await kit.rest.reactions.createForIssueComment({
          owner: target.owner,
          repo: target.repo,
          comment_id: scope.commentId,
          content,
        });
        return { action: "added" as const, reactionId: data.id };
      }
      if (scope.kind === "pr-review-comment") {
        const { data } =
          await kit.rest.reactions.createForPullRequestReviewComment({
            owner: target.owner,
            repo: target.repo,
            comment_id: scope.commentId,
            content,
          });
        return { action: "added" as const, reactionId: data.id };
      }
      const { data } = await kit.rest.reactions.createForIssue({
        owner: target.owner,
        repo: target.repo,
        issue_number: scope.issueNumber,
        content,
      });
      return { action: "added" as const, reactionId: data.id };
    },
    onMutate: async ({ scope, content }) => {
      const myKey = myReactionsKey(target, accountId, scope);
      await qc.cancelQueries({ queryKey: myKey });
      await qc.cancelQueries({
        queryKey: githubDetailKeys.prTimeline(target, accountId),
      });
      await qc.cancelQueries({
        queryKey: githubDetailKeys.issueTimeline(target, accountId),
      });
      const prevMine = qc.getQueryData<MyReactions>(myKey) ?? {};
      const hadMine = prevMine[content] != null;
      const delta = hadMine ? -1 : 1;
      const nextMine: MyReactions = { ...prevMine };
      if (hadMine) {
        delete nextMine[content];
      } else {
        // placeholder id; reconciled on success
        nextMine[content] = -1;
      }
      qc.setQueryData<MyReactions>(myKey, nextMine);
      patchReactionCount(qc, target, accountId, scope, content, delta);
      const prevPrTimeline = qc.getQueryData<TimelineEvent[]>(
        githubDetailKeys.prTimeline(target, accountId),
      );
      const prevIssueTimeline = qc.getQueryData<TimelineEvent[]>(
        githubDetailKeys.issueTimeline(target, accountId),
      );
      return { prevMine, prevPrTimeline, prevIssueTimeline, delta };
    },
    onError: (_err, { scope }, ctx) => {
      if (!ctx) return;
      qc.setQueryData<MyReactions>(
        myReactionsKey(target, accountId, scope),
        ctx.prevMine,
      );
      if (ctx.prevPrTimeline !== undefined) {
        qc.setQueryData(
          githubDetailKeys.prTimeline(target, accountId),
          ctx.prevPrTimeline,
        );
      }
      if (ctx.prevIssueTimeline !== undefined) {
        qc.setQueryData(
          githubDetailKeys.issueTimeline(target, accountId),
          ctx.prevIssueTimeline,
        );
      }
    },
    onSuccess: (result, { scope, content }) => {
      const myKey = myReactionsKey(target, accountId, scope);
      const current = qc.getQueryData<MyReactions>(myKey) ?? {};
      const next: MyReactions = { ...current };
      if (result.action === "added") {
        next[content] = result.reactionId;
      } else {
        delete next[content];
      }
      qc.setQueryData<MyReactions>(myKey, next);
    },
    onSettled: async () => {
      await Promise.all([
        qc.invalidateQueries({
          queryKey: githubDetailKeys.prTimeline(target, accountId),
        }),
        qc.invalidateQueries({
          queryKey: githubDetailKeys.issueTimeline(target, accountId),
        }),
        qc.invalidateQueries({
          queryKey: githubDetailKeys.prReviewComments(target, accountId),
        }),
      ]);
    },
  });
}

export function usePRDraftMutation(
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  const qc = useQueryClient();
  const accountId = account?.providerAccountId;
  return useMutation({
    mutationFn: async ({
      draft,
      nodeId,
    }: {
      draft: boolean;
      nodeId: string;
    }) => {
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
      const mutation = draft
        ? `mutation($id:ID!){ convertPullRequestToDraft(input:{pullRequestId:$id}){ pullRequest{ id isDraft } } }`
        : `mutation($id:ID!){ markPullRequestReadyForReview(input:{pullRequestId:$id}){ pullRequest{ id isDraft } } }`;
      return kit.graphql(mutation, { id: nodeId });
    },
    onMutate: async ({ draft }) => {
      const key = githubDetailKeys.pr(target, accountId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<PRDetail>(key);
      if (prev) {
        qc.setQueryData<PRDetail>(key, { ...prev, draft } as PRDetail);
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(githubDetailKeys.pr(target, accountId), ctx.prev);
      }
    },
    onSuccess: (_data, { draft }) => {
      rememberDetailConsistencyOverride<PRDetail>(
        githubDetailKeys.pr(target, accountId),
        {
          apply: (prev) => ({ ...prev, draft } as PRDetail),
          isSatisfied: (data) => data.draft === draft,
        },
      );
    },
    onSettled: async () => {
      await qc.invalidateQueries({
        queryKey: githubDetailKeys.pr(target, accountId),
      });
    },
  });
}

export function useRerunCheckMutation(
  target: ReviewTarget,
  account: OAuthConnection | null,
  headSha: string | null | undefined,
) {
  const qc = useQueryClient();
  const accountId = account?.providerAccountId;
  return useMutation({
    mutationFn: async ({ check }: { check: CheckItem }) => {
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
      // GitHub's rerun endpoints all require the parent workflow run to be
      // fully completed — you can't retry a job while its siblings are still
      // running. We branch by check owner and surface a friendly error if the
      // run isn't done.
      const isActions =
        check.appSlug === "github-actions" ||
        (check.detailsUrl?.includes("/actions/") ?? false);
      if (isActions) {
        const urlMatch = check.detailsUrl?.match(
          /\/actions\/runs\/(\d+)\/job\/(\d+)/,
        );
        const runId = urlMatch ? Number(urlMatch[1]) : NaN;
        const jobId = Number.isFinite(Number(check.externalId))
          ? Number(check.externalId)
          : urlMatch
            ? Number(urlMatch[2])
            : NaN;
        // Prefer the failed-jobs endpoint — reruns every failed job in the run
        // in one call, which is almost always what the user wants.
        if (Number.isFinite(runId)) {
          const { data: run } = await kit.rest.actions.getWorkflowRun({
            owner: target.owner,
            repo: target.repo,
            run_id: runId,
          });
          if (run.status !== "completed") {
            throw new Error(
              "Workflow is still running — wait for it to finish before retrying.",
            );
          }
          await kit.rest.actions.reRunWorkflowFailedJobs({
            owner: target.owner,
            repo: target.repo,
            run_id: runId,
          });
          return;
        }
        if (Number.isFinite(jobId)) {
          await kit.rest.actions.reRunJobForWorkflowRun({
            owner: target.owner,
            repo: target.repo,
            job_id: jobId,
          });
          return;
        }
      }
      // Third-party Apps (Vercel, CircleCI, etc.) — suite-level rerequest has
      // the broadest coverage; per-run rerequest as last resort.
      if (check.checkSuiteId) {
        try {
          await kit.rest.checks.rerequestSuite({
            owner: target.owner,
            repo: target.repo,
            check_suite_id: check.checkSuiteId,
          });
          return;
        } catch {
          // fall through
        }
      }
      await kit.rest.checks.rerequestRun({
        owner: target.owner,
        repo: target.repo,
        check_run_id: check.id,
      });
    },
    onMutate: async ({ check }) => {
      const key = prChecksQueryKey(target, accountId, headSha);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<CheckItem[]>(key);
      if (prev) {
        const next = prev.map((c) =>
          c.id === check.id
            ? {
                ...c,
                status: "queued",
                conclusion: null,
                startedAt: null,
                completedAt: null,
              }
            : c,
        );
        qc.setQueryData<CheckItem[]>(key, next);
      }
      return { prev, key };
    },
    onSuccess: (_data, { check }) => {
      rememberCheckRerun(target, accountId, headSha, check);
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: async () => {
      await qc.refetchQueries({
        queryKey: prChecksQueryKey(target, accountId, headSha),
        type: "active",
      });
    },
  });
}

export function useRequestReviewersMutation(
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  const qc = useQueryClient();
  const accountId = account?.providerAccountId;
  return useMutation({
    mutationFn: async ({
      login,
      enabled,
    }: {
      login: string;
      enabled: boolean;
    }) => {
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
      if (enabled) {
        await kit.rest.pulls.requestReviewers({
          owner: target.owner,
          repo: target.repo,
          pull_number: target.number,
          reviewers: [login],
        });
      } else {
        await kit.rest.pulls.removeRequestedReviewers({
          owner: target.owner,
          repo: target.repo,
          pull_number: target.number,
          reviewers: [login],
        });
      }
    },
    onMutate: async ({ login, enabled }) => {
      const prKey = githubDetailKeys.pr(target, accountId);
      await qc.cancelQueries({ queryKey: prKey });
      const prev = qc.getQueryData<PRDetail>(prKey);
      if (prev) {
        const existing = (prev.requested_reviewers ?? []) as Array<{
          login: string;
          avatar_url?: string;
          id?: number;
        }>;
        const repoAssignees =
          qc.getQueryData<RepoAssignee[]>(
            githubDetailKeys.repoAssignees(target, accountId),
          ) ?? [];
        const user = repoAssignees.find((a) => a.login === login);
        let next: typeof existing;
        if (enabled) {
          if (existing.some((r) => r.login === login)) {
            next = existing;
          } else {
            next = [
              ...existing,
              user ?? {
                login,
                id: -1,
                avatar_url: "",
              },
            ];
          }
        } else {
          next = existing.filter((r) => r.login !== login);
        }
        qc.setQueryData<PRDetail>(prKey, {
          ...prev,
          requested_reviewers: next,
        } as PRDetail);
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(githubDetailKeys.pr(target, accountId), ctx.prev);
      }
    },
    onSuccess: (_data, { login, enabled }) => {
      const repoAssignees =
        qc.getQueryData<RepoAssignee[]>(
          githubDetailKeys.repoAssignees(target, accountId),
        ) ?? [];
      const user = repoAssignees.find((a) => a.login === login);
      rememberDetailConsistencyOverride<PRDetail>(
        githubDetailKeys.pr(target, accountId),
        {
          apply: (prev) => {
            const existing = (prev.requested_reviewers ?? []) as Array<{
              login: string;
              avatar_url?: string;
              id?: number;
            }>;
            const next = enabled
              ? hasLoginItem(existing, login)
                ? existing
                : [
                    ...existing,
                    user ?? {
                      login,
                      id: -1,
                      avatar_url: "",
                    },
                  ]
              : existing.filter((r) => r.login !== login);
            return { ...prev, requested_reviewers: next } as PRDetail;
          },
          isSatisfied: (data) =>
            hasLoginItem(data.requested_reviewers, login) === enabled,
        },
      );
    },
    onSettled: async () => {
      await qc.invalidateQueries({
        queryKey: githubDetailKeys.pr(target, accountId),
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
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
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
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["github", "pr-files"] }),
        qc.invalidateQueries({ queryKey: ["github", "pr-timeline"] }),
        qc.invalidateQueries({ queryKey: ["github", "pr-review-comments"] }),
        qc.invalidateQueries({ queryKey: ["github", "file-contents"] }),
      ]);
    },
  });
}

export function useGitHubRepoBranches(
  target: Pick<ReviewTarget, "owner" | "repo">,
  account: OAuthConnection | null,
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: githubDetailKeys.repoBranches(target, account?.providerAccountId),
    enabled: !!account && enabled,
    queryFn: async () => {
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
      const branches = await kit.paginate(kit.rest.repos.listBranches, {
        owner: target.owner,
        repo: target.repo,
        per_page: 100,
      });
      return branches.map((b) => ({ name: b.name, protected: b.protected }));
    },
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

export function useUpdatePRBaseMutation(
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  const qc = useQueryClient();
  const accountId = account?.providerAccountId;
  return useMutation({
    mutationFn: async (base: string) => {
      const kit = await getGitHubOctokit(requireGitHubAccount(account));
      const { data } = await kit.rest.pulls.update({
        owner: target.owner,
        repo: target.repo,
        pull_number: target.number,
        base,
      });
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({
          queryKey: githubDetailKeys.pr(target, accountId),
        }),
        qc.invalidateQueries({
          queryKey: githubDetailKeys.prFiles(target, accountId),
        }),
        qc.invalidateQueries({
          queryKey: githubDetailKeys.prCommits(target, accountId),
        }),
        qc.invalidateQueries({
          queryKey: githubDetailKeys.prTimeline(target, accountId),
        }),
        qc.invalidateQueries({
          queryKey: githubDetailKeys.prStack(target, accountId),
        }),
      ]);
    },
  });
}
