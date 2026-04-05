import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarGroup,
  AvatarGroupCount,
} from "@g-spot/ui/components/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@g-spot/ui/components/popover";
import { TableCell, TableRow } from "@g-spot/ui/components/table";
import {
  Check,
  CircleDot,
  CircleX,
  Clock,
  Eye,
  ExternalLink,
  GitPullRequest,
  Loader2,
  Minus,
  XCircle,
} from "lucide-react";

import type { ColumnConfig } from "@g-spot/types/filters";
import { getColumnTruncation, PR_COLUMN_META } from "@g-spot/types/filters";
import type { GitHubPullRequest, GitHubStatusCheck } from "@/lib/github/types";
import { ColumnCell } from "./column-layout";
import { RowPreviewPopover, GitHubPRPreview, ROW_PREVIEW_BLOCK_ATTR } from "./row-preview";
import { relativeTime, GitHubLabels } from "./shared";
import { TruncatedText } from "./truncated-text";

// ── Check helpers ──────────────────────────────────────────────────────────

function checkStatusColor(check: GitHubStatusCheck) {
  if (check.status !== "COMPLETED") return "text-yellow-500";
  switch (check.conclusion) {
    case "SUCCESS":
      return "text-emerald-500";
    case "SKIPPED":
    case "NEUTRAL":
      return "text-muted-foreground";
    default:
      return "text-red-500";
  }
}

function checkStatusIcon(check: GitHubStatusCheck) {
  const color = checkStatusColor(check);
  if (check.status !== "COMPLETED") {
    if (check.status === "IN_PROGRESS") return <Loader2 className={`size-3.5 shrink-0 animate-spin ${color}`} />;
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
    case "SUCCESS": return "Passed";
    case "FAILURE": return "Failed";
    case "CANCELLED": return "Cancelled";
    case "TIMED_OUT": return "Timed out";
    case "SKIPPED": return "Skipped";
    case "ACTION_REQUIRED": return "Action required";
    case "NEUTRAL": return "Neutral";
    case "STALE": return "Stale";
    default: return "Unknown";
  }
}

function rollupMeta(status: GitHubPullRequest["statusCheckRollup"]) {
  switch (status) {
    case "SUCCESS":
      return { label: "All checks passed", color: "text-emerald-500", bg: "bg-emerald-500/10" } as const;
    case "FAILURE":
      return { label: "Some checks failed", color: "text-red-500", bg: "bg-red-500/10" } as const;
    case "ERROR":
      return { label: "Checks errored", color: "text-red-500", bg: "bg-red-500/10" } as const;
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
      return <XCircle className="size-3.5 text-red-500" />;
    case "PENDING":
      return <Clock className="size-3.5 text-yellow-500" />;
    default:
      return <span className="size-3.5" />;
  }
}

// ── Review helpers ─────────────────────────────────────────────────────────

function reviewMeta(decision: GitHubPullRequest["reviewDecision"]) {
  switch (decision) {
    case "APPROVED":
      return { label: "Approved", color: "text-emerald-500", bg: "bg-emerald-500/10" } as const;
    case "CHANGES_REQUESTED":
      return { label: "Changes requested", color: "text-red-500", bg: "bg-red-500/10" } as const;
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
      return <CircleX className="size-3.5 text-red-500" />;
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
      return <CircleX className="size-3.5 shrink-0 text-red-500" />;
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
    case "APPROVED": return "Approved";
    case "CHANGES_REQUESTED": return "Changes requested";
    case "DISMISSED": return "Dismissed";
    case "COMMENTED": return "Commented";
    case "REQUESTED": return "Review requested";
    default: return "Pending";
  }
}

// ── Status Check Popover ───────────────────────────────────────────────────

function StatusCheckPopover({ pr }: { pr: GitHubPullRequest }) {
  const meta = rollupMeta(pr.statusCheckRollup);
  if (!meta) return <span className="size-3.5" />;

  const checks = pr.statusChecks ?? [];
  const passed = checks.filter((c) => c.status === "COMPLETED" && c.conclusion === "SUCCESS").length;
  const failed = checks.filter((c) => c.status === "COMPLETED" && (c.conclusion === "FAILURE" || c.conclusion === "CANCELLED" || c.conclusion === "TIMED_OUT")).length;
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
        {/* Header */}
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

        {/* Check list */}
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

        {/* Footer link */}
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

// ── Review Decision Popover ────────────────────────────────────────────────

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
        {/* Header */}
        <div className={`flex items-center gap-2 px-3 py-2.5 ${meta.bg}`}>
          {reviewDecisionIcon(pr.reviewDecision)}
          <span className={`text-xs font-semibold ${meta.color}`}>{meta.label}</span>
        </div>

        {/* Reviewer list */}
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

        {/* Footer link */}
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

// ── Column Cell Renderers ─────────────────────────────────────────────────

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

export const PR_CELL_RENDERERS: Record<string, (pr: GitHubPullRequest, truncation: "end" | "middle") => React.ReactNode> = {
  title: (pr, truncation) => (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex shrink-0 items-center gap-2">
        <Avatar size="sm">
          <AvatarImage src={pr.author.avatarUrl} alt={pr.author.login} />
          <AvatarFallback>
            {pr.author.login.slice(0, 2).toUpperCase()}
          </AvatarFallback>
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
  ),
  reviewers: (pr) => <ReviewersCell pr={pr} />,
  ci: (pr) => <StatusCheckPopover pr={pr} />,
  review: (pr) => <ReviewDecisionPopover pr={pr} />,
  labels: (pr) => <GitHubLabels labels={pr.labels} />,
  changes: (pr) =>
    pr.additions != null && pr.deletions != null ? (
      <span className="whitespace-nowrap font-mono text-xs">
        <span className="text-emerald-500">+{pr.additions}</span>{" "}
        <span className="text-red-500">-{pr.deletions}</span>
      </span>
    ) : null,
  updated: (pr) => (
    <span className="whitespace-nowrap text-xs text-muted-foreground">
      {relativeTime(pr.updatedAt)}
    </span>
  ),
};

// ── Row ────────────────────────────────────────────────────────────────────

export function GitHubPRRow({
  pr,
  isUnread,
  onMarkRead,
  columns,
}: {
  pr: GitHubPullRequest;
  isUnread?: boolean;
  onMarkRead?: (id: string) => void;
  columns: ColumnConfig[];
}) {
  const visibleColumns = columns.filter((c) => c.visible);

  return (
    <RowPreviewPopover preview={<GitHubPRPreview pr={pr} />}>
    <TableRow
      className="group cursor-pointer"
      onClick={() => {
        onMarkRead?.(pr.id);
        window.open(pr.url, "_blank", "noopener");
      }}
    >
      {visibleColumns.map((col) => {
        const render = PR_CELL_RENDERERS[col.id];
        const meta = PR_COLUMN_META[col.id as keyof typeof PR_COLUMN_META];
        if (!render || !meta) return null;
        return (
          <ColumnCell key={col.id} meta={meta} column={col} className={col.id === "title" ? "pl-3" : undefined}>
            <>
              {col.id === "title" && isUnread ? (
                <span className="size-1.5 shrink-0 rounded-full bg-blue-500" />
              ) : null}
              {col.id === "title" && !isUnread ? (
                <span className="size-1.5 shrink-0 rounded-full bg-transparent" />
              ) : null}
              {render(pr, getColumnTruncation(meta, col))}
            </>
          </ColumnCell>
        );
      })}

      {/* External link indicator on hover */}
      <TableCell className="w-8 pr-3">
        <ExternalLink className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </TableCell>
    </TableRow>
    </RowPreviewPopover>
  );
}
