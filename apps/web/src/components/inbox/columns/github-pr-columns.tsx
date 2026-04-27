import type { ColumnDef } from "@tanstack/react-table";

import { PR_COLUMN_META } from "@g-spot/types/filters";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@g-spot/ui/components/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@g-spot/ui/components/popover";
import {
  Check,
  CircleDot,
  CircleX,
  Clock,
  ExternalLink,
  Eye,
  GitPullRequest,
  Loader2,
  Minus,
  XCircle,
} from "lucide-react";

import type { GitHubPullRequest, GitHubStatusCheck } from "@/lib/github/types";
import { ROW_PREVIEW_BLOCK_ATTR } from "../row-preview";
import { GitHubLabels, relativeTime } from "../shared";
import { TruncatedText } from "../truncated-text";

// ── Check helpers ─────────────────────────────────────────────────────────

function checkStatusColor(check: GitHubStatusCheck) {
  if (check.status !== "COMPLETED") return "text-yellow-500";
  switch (check.conclusion) {
    case "SUCCESS":
      return "text-emerald-500";
    case "SKIPPED":
    case "NEUTRAL":
      return "text-muted-foreground";
    default:
      return "text-destructive";
  }
}

function checkStatusIcon(check: GitHubStatusCheck) {
  const color = checkStatusColor(check);
  if (check.status !== "COMPLETED") {
    if (check.status === "IN_PROGRESS")
      return <Loader2 className={`size-3.5 shrink-0 animate-spin ${color}`} />;
    return <Clock className={`size-3.5 shrink-0 ${color}`} />;
  }
  switch (check.conclusion) {
    case "SUCCESS":
      return <Check className={`size-3.5 shrink-0 ${color}`} />;
    case "SKIPPED":
      return <Minus className={`size-3.5 shrink-0 ${color}`} />;
    case "NEUTRAL":
      return <CircleDot className={`size-3.5 shrink-0 ${color}`} />;
    default:
      return <XCircle className={`size-3.5 shrink-0 ${color}`} />;
  }
}

function checkStatusLabel(check: GitHubStatusCheck) {
  if (check.status !== "COMPLETED") {
    if (check.status === "IN_PROGRESS") return "Running";
    return "Pending";
  }
  switch (check.conclusion) {
    case "SUCCESS":
      return "Passed";
    case "FAILURE":
      return "Failed";
    case "CANCELLED":
      return "Cancelled";
    case "TIMED_OUT":
      return "Timed out";
    case "SKIPPED":
      return "Skipped";
    case "ACTION_REQUIRED":
      return "Action required";
    case "NEUTRAL":
      return "Neutral";
    case "STALE":
      return "Stale";
    default:
      return "Unknown";
  }
}

function rollupMeta(status: GitHubPullRequest["statusCheckRollup"]) {
  switch (status) {
    case "SUCCESS":
      return { label: "All checks passed", color: "text-emerald-500", bg: "bg-emerald-500/10" } as const;
    case "FAILURE":
      return { label: "Some checks failed", color: "text-destructive", bg: "bg-destructive/10" } as const;
    case "ERROR":
      return { label: "Checks errored", color: "text-destructive", bg: "bg-destructive/10" } as const;
    case "PENDING":
      return { label: "Checks running", color: "text-yellow-500", bg: "bg-yellow-500/10" } as const;
    default:
      return null;
  }
}

function rollupIcon(status: GitHubPullRequest["statusCheckRollup"]) {
  switch (status) {
    case "SUCCESS":
      return <Check className="size-3.5 text-emerald-500" />;
    case "FAILURE":
    case "ERROR":
      return <XCircle className="size-3.5 text-destructive" />;
    case "PENDING":
      return <Clock className="size-3.5 text-yellow-500" />;
    default:
      return <span className="size-3.5" />;
  }
}

// ── Review helpers ────────────────────────────────────────────────────────

function reviewMeta(decision: GitHubPullRequest["reviewDecision"]) {
  switch (decision) {
    case "APPROVED":
      return { label: "Approved", color: "text-emerald-500", bg: "bg-emerald-500/10" } as const;
    case "CHANGES_REQUESTED":
      return { label: "Changes requested", color: "text-destructive", bg: "bg-destructive/10" } as const;
    case "REVIEW_REQUIRED":
      return { label: "Review required", color: "text-muted-foreground", bg: "bg-muted" } as const;
    default:
      return null;
  }
}

function reviewDecisionIcon(decision: GitHubPullRequest["reviewDecision"]) {
  switch (decision) {
    case "APPROVED":
      return <Check className="size-3.5 text-emerald-500" />;
    case "CHANGES_REQUESTED":
      return <CircleX className="size-3.5 text-destructive" />;
    case "REVIEW_REQUIRED":
      return <GitPullRequest className="size-3.5 text-muted-foreground" />;
    default:
      return <span className="size-3.5" />;
  }
}

function reviewerIcon(state: string) {
  switch (state) {
    case "APPROVED":
      return <Check className="size-3.5 shrink-0 text-emerald-500" />;
    case "CHANGES_REQUESTED":
      return <CircleX className="size-3.5 shrink-0 text-destructive" />;
    case "DISMISSED":
      return <Minus className="size-3.5 shrink-0 text-muted-foreground" />;
    case "REQUESTED":
      return <Eye className="size-3.5 shrink-0 text-yellow-500" />;
    default:
      return <Clock className="size-3.5 shrink-0 text-muted-foreground" />;
  }
}

function reviewerLabel(state: string) {
  switch (state) {
    case "APPROVED":
      return "Approved";
    case "CHANGES_REQUESTED":
      return "Changes requested";
    case "DISMISSED":
      return "Dismissed";
    case "COMMENTED":
      return "Commented";
    case "REQUESTED":
      return "Review requested";
    default:
      return "Pending";
  }
}

// ── Popovers ──────────────────────────────────────────────────────────────

function StatusCheckPopover({ pr }: { pr: GitHubPullRequest }) {
  const meta = rollupMeta(pr.statusCheckRollup);
  if (!meta) return <span className="size-3.5" />;

  const checks = pr.statusChecks ?? [];
  const passed = checks.filter((c) => c.status === "COMPLETED" && c.conclusion === "SUCCESS").length;
  const failed = checks.filter(
    (c) =>
      c.status === "COMPLETED" &&
      (c.conclusion === "FAILURE" || c.conclusion === "CANCELLED" || c.conclusion === "TIMED_OUT"),
  ).length;
  const pending = checks.filter((c) => c.status !== "COMPLETED").length;

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        render={
          <button
            type="button"
            {...{ [ROW_PREVIEW_BLOCK_ATTR]: "" }}
            className="flex items-center justify-center rounded-sm p-1 transition-colors hover:bg-muted"
            onClick={(e) => {
              e.stopPropagation();
              window.open(`${pr.url}/checks`, "_blank", "noopener");
            }}
          >
            {rollupIcon(pr.statusCheckRollup)}
          </button>
        }
      />
      <PopoverContent
        side="bottom"
        align="center"
        sideOffset={4}
        className="w-72 p-0"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div className={`flex items-center gap-2 px-3 py-2.5 ${meta.bg}`}>
          {rollupIcon(pr.statusCheckRollup)}
          <span className={`text-xs font-semibold ${meta.color}`}>{meta.label}</span>
          {checks.length > 0 && (
            <span className="ml-auto text-[10px] text-muted-foreground">
              {passed > 0 && `${passed} passed`}
              {failed > 0 && `${passed > 0 ? ", " : ""}${failed} failed`}
              {pending > 0 && `${passed > 0 || failed > 0 ? ", " : ""}${pending} pending`}
            </span>
          )}
        </div>

        {checks.length > 0 ? (
          <div className="max-h-52 overflow-y-auto">
            {checks.map((check) => (
              <a
                key={check.name}
                href={check.detailsUrl ?? `${pr.url}/checks`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 px-3 py-1.5 transition-colors hover:bg-muted/60"
                onClick={(e) => e.stopPropagation()}
              >
                {checkStatusIcon(check)}
                <span className="min-w-0 flex-1 truncate text-xs">{check.name}</span>
                <span className={`shrink-0 text-[10px] ${checkStatusColor(check)}`}>
                  {checkStatusLabel(check)}
                </span>
              </a>
            ))}
          </div>
        ) : (
          <div className="px-3 py-3 text-center text-xs text-muted-foreground">
            No individual check details available
          </div>
        )}

        <a
          href={`${pr.url}/checks`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 border-t border-border/40 px-3 py-2 text-[10px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          onClick={(e) => e.stopPropagation()}
        >
          View all checks on GitHub
          <ExternalLink className="size-2.5" />
        </a>
      </PopoverContent>
    </Popover>
  );
}

function ReviewDecisionPopover({ pr }: { pr: GitHubPullRequest }) {
  const meta = reviewMeta(pr.reviewDecision);
  if (!meta) return <span className="size-3.5" />;

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        render={
          <button
            type="button"
            {...{ [ROW_PREVIEW_BLOCK_ATTR]: "" }}
            className="flex items-center justify-center rounded-sm p-1 transition-colors hover:bg-muted"
            onClick={(e) => {
              e.stopPropagation();
              window.open(pr.url, "_blank", "noopener");
            }}
          >
            {reviewDecisionIcon(pr.reviewDecision)}
          </button>
        }
      />
      <PopoverContent
        side="bottom"
        align="center"
        sideOffset={4}
        className="w-64 p-0"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div className={`flex items-center gap-2 px-3 py-2.5 ${meta.bg}`}>
          {reviewDecisionIcon(pr.reviewDecision)}
          <span className={`text-xs font-semibold ${meta.color}`}>{meta.label}</span>
        </div>

        {pr.reviewers.length > 0 ? (
          <div className="max-h-52 overflow-y-auto">
            {pr.reviewers.map((r) => (
              <a
                key={r.login}
                href={`${pr.url}#pullrequestreview-`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 px-3 py-1.5 transition-colors hover:bg-muted/60"
                onClick={(e) => e.stopPropagation()}
              >
                {reviewerIcon(r.state)}
                <Avatar size="sm">
                  <AvatarImage src={r.avatarUrl} alt={r.login} />
                  <AvatarFallback>{r.login.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-xs">{r.login}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {reviewerLabel(r.state)}
                </span>
              </a>
            ))}
          </div>
        ) : (
          <div className="px-3 py-3 text-center text-xs text-muted-foreground">
            No reviews yet
          </div>
        )}

        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 border-t border-border/40 px-3 py-2 text-[10px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          onClick={(e) => e.stopPropagation()}
        >
          View PR on GitHub
          <ExternalLink className="size-2.5" />
        </a>
      </PopoverContent>
    </Popover>
  );
}

// ── Cells ────────────────────────────────────────────────────────────────

const MAX_REVIEWERS = 4;

function ReviewersCell({ pr }: { pr: GitHubPullRequest }) {
  const visible = pr.reviewers.slice(0, MAX_REVIEWERS);
  const extra = pr.reviewers.length - MAX_REVIEWERS;
  if (visible.length === 0) return null;
  return (
    <AvatarGroup>
      {visible.map((r) => (
        <Avatar key={r.login} size="sm">
          <AvatarImage src={r.avatarUrl} alt={r.login} />
          <AvatarFallback>{r.login.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      ))}
      {extra > 0 && <AvatarGroupCount>+{extra}</AvatarGroupCount>}
    </AvatarGroup>
  );
}

function TitleCell({
  pr,
  isUnread,
  truncation,
}: {
  pr: GitHubPullRequest;
  isUnread: boolean;
  truncation: "end" | "middle";
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex shrink-0 items-center gap-2">
        {isUnread ? (
          <span className="size-1.5 shrink-0 rounded-full bg-blue-500" />
        ) : (
          <span className="size-1.5 shrink-0 rounded-full bg-transparent" />
        )}
        <Avatar size="sm">
          <AvatarImage src={pr.author.avatarUrl} alt={pr.author.login} />
          <AvatarFallback>{pr.author.login.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      </div>
      <div className="min-w-0 flex-1">
        <TruncatedText
          text={pr.title}
          mode={truncation}
          endChars={10}
          className="block text-sm font-medium leading-tight"
        />
        <p className="truncate text-xs leading-tight text-muted-foreground">
          {pr.author.login} · {pr.repository.nameWithOwner}#{pr.number}
        </p>
      </div>
    </div>
  );
}

// ── Column definitions ──────────────────────────────────────────────────

export const TRAILING_EXTERNAL_COLUMN_ID = "_trailing_external";

type PrColumnInput = {
  columnConfig: { id: string; visible: boolean; truncation: "end" | "middle"; label: string | null }[];
  isUnread: (id: string) => boolean;
};

export function buildPrColumns({
  columnConfig,
  isUnread,
}: PrColumnInput): ColumnDef<GitHubPullRequest, unknown>[] {
  const truncationFor = (id: string) =>
    columnConfig.find((c) => c.id === id)?.truncation ?? "end";
  const labelOverride = (id: string) =>
    columnConfig.find((c) => c.id === id)?.label?.trim() || null;
  const metaFor = (id: keyof typeof PR_COLUMN_META) => PR_COLUMN_META[id];

  return [
    {
      id: "title",
      header: () => labelOverride("title") ?? metaFor("title").label,
      cell: ({ row }) => (
        <TitleCell
          pr={row.original}
          isUnread={isUnread(row.original.id)}
          truncation={truncationFor("title")}
        />
      ),
      size: metaFor("title").width ?? 360,
      minSize: metaFor("title").minWidth,
      maxSize: metaFor("title").maxWidth,
      meta: {
        align: metaFor("title").align,
        truncation: metaFor("title").truncation,
        breakpoint: metaFor("title").breakpoint,
        cellClassName: "pl-3",
        headerClassName: "pl-3",
      },
    },
    {
      id: "reviewers",
      header: () => labelOverride("reviewers") ?? metaFor("reviewers").label,
      cell: ({ row }) => <ReviewersCell pr={row.original} />,
      size: metaFor("reviewers").width ?? 112,
      minSize: metaFor("reviewers").minWidth,
      maxSize: metaFor("reviewers").maxWidth,
      meta: {
        align: metaFor("reviewers").align,
        truncation: metaFor("reviewers").truncation,
        breakpoint: metaFor("reviewers").breakpoint,
      },
    },
    {
      id: "ci",
      header: () => labelOverride("ci") ?? metaFor("ci").label,
      cell: ({ row }) => <StatusCheckPopover pr={row.original} />,
      size: metaFor("ci").width ?? 48,
      minSize: metaFor("ci").minWidth,
      maxSize: metaFor("ci").maxWidth,
      enableResizing: false,
      meta: {
        align: metaFor("ci").align,
        breakpoint: metaFor("ci").breakpoint,
      },
    },
    {
      id: "review",
      header: () => labelOverride("review") ?? metaFor("review").label,
      cell: ({ row }) => <ReviewDecisionPopover pr={row.original} />,
      size: metaFor("review").width ?? 56,
      minSize: metaFor("review").minWidth,
      maxSize: metaFor("review").maxWidth,
      enableResizing: false,
      meta: {
        align: metaFor("review").align,
        breakpoint: metaFor("review").breakpoint,
      },
    },
    {
      id: "labels",
      header: () => labelOverride("labels") ?? metaFor("labels").label,
      cell: ({ row }) => <GitHubLabels labels={row.original.labels} />,
      size: metaFor("labels").width ?? 120,
      minSize: metaFor("labels").minWidth,
      maxSize: metaFor("labels").maxWidth,
      meta: {
        align: metaFor("labels").align,
        breakpoint: metaFor("labels").breakpoint,
      },
    },
    {
      id: "changes",
      header: () => labelOverride("changes") ?? metaFor("changes").label,
      cell: ({ row }) => {
        const pr = row.original;
        if (pr.additions == null || pr.deletions == null) return null;
        return (
          <span className="whitespace-nowrap font-mono text-xs">
            <span className="text-emerald-500">+{pr.additions}</span>{" "}
            <span className="text-destructive">-{pr.deletions}</span>
          </span>
        );
      },
      size: metaFor("changes").width ?? 96,
      minSize: metaFor("changes").minWidth,
      maxSize: metaFor("changes").maxWidth,
      meta: {
        align: metaFor("changes").align,
        truncation: metaFor("changes").truncation,
        breakpoint: metaFor("changes").breakpoint,
      },
    },
    {
      id: "updated",
      header: () => labelOverride("updated") ?? metaFor("updated").label,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {relativeTime(row.original.updatedAt)}
        </span>
      ),
      size: metaFor("updated").width ?? 80,
      minSize: metaFor("updated").minWidth,
      maxSize: metaFor("updated").maxWidth,
      meta: {
        align: metaFor("updated").align,
        truncation: metaFor("updated").truncation,
        breakpoint: metaFor("updated").breakpoint,
      },
    },
    // Trailing external-link indicator (not persisted, not resizable)
    {
      id: TRAILING_EXTERNAL_COLUMN_ID,
      header: () => null,
      cell: () => (
        <ExternalLink className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      ),
      size: 32,
      minSize: 32,
      maxSize: 32,
      enableResizing: false,
      enableHiding: false,
      meta: {
        align: "center",
        cellClassName: "pr-3",
        headerClassName: "w-8",
      },
    },
  ];
}
