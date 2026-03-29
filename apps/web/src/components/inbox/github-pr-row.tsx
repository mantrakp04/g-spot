import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarGroup,
  AvatarGroupCount,
} from "@g-spot/ui/components/avatar";
import { TableCell, TableRow } from "@g-spot/ui/components/table";
import {
  Check,
  Circle,
  CircleX,
  Clock,
  ExternalLink,
  XCircle,
} from "lucide-react";

import type { GitHubPR } from "@/lib/github/types";

function relativeTime(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "1d";
  return `${days}d`;
}

function StatusCheckIcon({ status }: { status: GitHubPR["statusCheckRollup"] }) {
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

function ReviewDecisionIcon({
  decision,
}: {
  decision: GitHubPR["reviewDecision"];
}) {
  switch (decision) {
    case "APPROVED":
      return <Check className="size-3.5 text-emerald-500" />;
    case "CHANGES_REQUESTED":
      return <CircleX className="size-3.5 text-red-500" />;
    case "REVIEW_REQUIRED":
      return <Circle className="size-3.5 text-muted-foreground" />;
    default:
      return <span className="size-3.5" />;
  }
}

const MAX_REVIEWERS = 4;

export function GitHubPRRow({ pr }: { pr: GitHubPR }) {
  const visibleReviewers = pr.reviewers.slice(0, MAX_REVIEWERS);
  const extraCount = pr.reviewers.length - MAX_REVIEWERS;

  return (
    <TableRow
      className="group cursor-pointer"
      onClick={() => window.open(pr.url, "_blank", "noopener")}
    >
      {/* Indicator + Avatar + Title */}
      <TableCell className="w-full max-w-0 pl-3">
        <div className="flex items-center gap-2.5">
          <div className="flex shrink-0 items-center gap-2">
            {pr.isDraft ? (
              <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
            ) : (
              <span className="size-1.5 shrink-0 rounded-full bg-blue-500" />
            )}
            <Avatar size="sm">
              <AvatarImage src={pr.author.avatarUrl} alt={pr.author.login} />
              <AvatarFallback>
                {pr.author.login.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight">
              {pr.title}
            </p>
            <p className="truncate text-xs leading-tight text-muted-foreground">
              {pr.author.login} &middot;{" "}
              {pr.repository.nameWithOwner}#{pr.number}
            </p>
          </div>
        </div>
      </TableCell>

      {/* Reviewer avatars */}
      <TableCell className="hidden md:table-cell">
        {visibleReviewers.length > 0 && (
          <AvatarGroup>
            {visibleReviewers.map((r) => (
              <Avatar key={r.login} size="sm">
                <AvatarImage src={r.avatarUrl} alt={r.login} />
                <AvatarFallback>
                  {r.login.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ))}
            {extraCount > 0 && (
              <AvatarGroupCount>+{extraCount}</AvatarGroupCount>
            )}
          </AvatarGroup>
        )}
      </TableCell>

      {/* CI status */}
      <TableCell className="hidden sm:table-cell">
        <div className="flex items-center justify-center">
          <StatusCheckIcon status={pr.statusCheckRollup} />
        </div>
      </TableCell>

      {/* Review decision */}
      <TableCell className="hidden sm:table-cell">
        <div className="flex items-center justify-center">
          <ReviewDecisionIcon decision={pr.reviewDecision} />
        </div>
      </TableCell>

      {/* Changes */}
      <TableCell className="hidden lg:table-cell">
        <span className="font-mono text-xs">
          <span className="text-emerald-500">+{pr.additions}</span>{" "}
          <span className="text-red-500">-{pr.deletions}</span>
        </span>
      </TableCell>

      {/* Updated */}
      <TableCell className="pr-3 text-right">
        <span className="text-xs text-muted-foreground">
          {relativeTime(pr.updatedAt)}
        </span>
      </TableCell>

      {/* External link indicator on hover */}
      <TableCell className="w-8 pr-3">
        <ExternalLink className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </TableCell>
    </TableRow>
  );
}
