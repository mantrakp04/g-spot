import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@g-spot/ui/components/avatar";
import { Badge } from "@g-spot/ui/components/badge";
import { TableCell, TableRow } from "@g-spot/ui/components/table";
import { CircleDot, ExternalLink, MessageSquare } from "lucide-react";

import type { GitHubIssue } from "@/lib/github/types";

function relativeTime(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "1d";
  return `${days}d`;
}

export function GitHubIssueRow({
  issue,
  isUnread,
  onMarkRead,
}: {
  issue: GitHubIssue;
  isUnread?: boolean;
  onMarkRead?: (id: string) => void;
}) {
  return (
    <TableRow
      className="group cursor-pointer"
      onClick={() => {
        onMarkRead?.(issue.id);
        window.open(issue.url, "_blank", "noopener");
      }}
    >
      <TableCell className="w-full max-w-0 pl-3">
        <div className="flex items-center gap-2.5">
          <div className="flex shrink-0 items-center gap-2">
            {isUnread ? (
              <span className="size-1.5 shrink-0 rounded-full bg-blue-500" />
            ) : (
              <span className="size-1.5 shrink-0 rounded-full bg-transparent" />
            )}
            <Avatar size="sm">
              <AvatarImage src={issue.author.avatarUrl} alt={issue.author.login} />
              <AvatarFallback>
                {issue.author.login.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium leading-tight">
                {issue.title}
              </p>
            </div>
            <p className="truncate text-xs leading-tight text-muted-foreground">
              {issue.author.login} &middot;{" "}
              {issue.repository.nameWithOwner}#{issue.number}
            </p>
          </div>
        </div>
      </TableCell>

      <TableCell className="hidden sm:table-cell">
        <div className="flex items-center justify-center">
          <Badge variant={issue.state === "OPEN" ? "secondary" : "outline"} className="gap-1 px-1.5 py-0 text-[10px] uppercase">
            <CircleDot className="size-2.5" />
            {issue.state === "OPEN" ? "Open" : "Closed"}
          </Badge>
        </div>
      </TableCell>

      <TableCell className="hidden md:table-cell">
        <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
          <MessageSquare className="size-3" />
          <span>{issue.comments}</span>
        </div>
      </TableCell>

      <TableCell className="pr-3 text-right">
        <span className="text-xs text-muted-foreground">
          {relativeTime(issue.updatedAt)}
        </span>
      </TableCell>

      <TableCell className="w-8 pr-3">
        <ExternalLink className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </TableCell>
    </TableRow>
  );
}
