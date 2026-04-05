import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarGroup,
  AvatarGroupCount,
} from "@g-spot/ui/components/avatar";
import { Badge } from "@g-spot/ui/components/badge";
import { TableCell, TableRow } from "@g-spot/ui/components/table";
import {
  CircleDot,
  CircleCheck,
  CircleSlash,
  ExternalLink,
  MessageSquare,
  SmilePlus,
  Milestone,
} from "lucide-react";

import type { ColumnConfig } from "@g-spot/types/filters";
import { getColumnTruncation, ISSUE_COLUMN_META } from "@g-spot/types/filters";
import type { GitHubIssue } from "@/lib/github/types";
import { ColumnCell } from "./column-layout";
import { RowPreviewPopover, GitHubIssuePreview } from "./row-preview";
import { relativeTime, GitHubLabels } from "./shared";
import { TruncatedText } from "./truncated-text";

function stateIcon(issue: GitHubIssue) {
  if (issue.state === "OPEN") {
    return <CircleDot className="size-2.5 text-emerald-500" />;
  }
  if (issue.stateReason === "NOT_PLANNED") {
    return <CircleSlash className="size-2.5 text-muted-foreground" />;
  }
  return <CircleCheck className="size-2.5 text-purple-500" />;
}

function stateLabel(issue: GitHubIssue) {
  if (issue.state === "OPEN") return "Open";
  if (issue.stateReason === "NOT_PLANNED") return "Not planned";
  return "Closed";
}

function stateVariant(issue: GitHubIssue): "secondary" | "outline" {
  return issue.state === "OPEN" ? "secondary" : "outline";
}

const MAX_ASSIGNEES = 3;

// ── Column Cell Renderers ─────────────────────────────────────────────────

function AssigneesCell({ issue }: { issue: GitHubIssue }) {
  if (issue.assignees.length === 0) return null;
  const visible = issue.assignees.slice(0, MAX_ASSIGNEES);
  const extra = issue.assignees.length - MAX_ASSIGNEES;
  return (
    <AvatarGroup>
      {visible.map((a) => (
        <Avatar key={a.login} size="sm">
          <AvatarImage src={a.avatarUrl} alt={a.login} />
          <AvatarFallback>{a.login.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      ))}
      {extra > 0 && <AvatarGroupCount>+{extra}</AvatarGroupCount>}
    </AvatarGroup>
  );
}

function StatusCell({ issue }: { issue: GitHubIssue }) {
  return (
    <Badge
      variant={stateVariant(issue)}
      className="gap-1 px-1.5 py-0 text-[10px] uppercase"
    >
      {stateIcon(issue)}
      {stateLabel(issue)}
    </Badge>
  );
}

function ReactionsCell({ issue }: { issue: GitHubIssue }) {
  if (issue.reactions === 0) return null;
  return (
    <>
      <SmilePlus className="size-3 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">{issue.reactions}</span>
    </>
  );
}

function CommentsCell({ issue }: { issue: GitHubIssue }) {
  return (
    <>
      <MessageSquare className="size-3 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">{issue.comments}</span>
    </>
  );
}

function MilestoneCell({ issue, truncation }: { issue: GitHubIssue; truncation: "end" | "middle" }) {
  if (!issue.milestone) return null;
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <Milestone className="size-3 shrink-0" />
      <TruncatedText
        text={issue.milestone}
        mode={truncation}
        endChars={6}
        className="block max-w-[8rem] truncate"
      />
    </div>
  );
}

function CreatedCell({ issue }: { issue: GitHubIssue }) {
  return (
    <span className="text-xs text-muted-foreground">
      {relativeTime(issue.createdAt)}
    </span>
  );
}

// ── Column registry ───────────────────────────────────────────────────────

export const ISSUE_CELL_RENDERERS: Record<string, (issue: GitHubIssue, truncation: "end" | "middle") => React.ReactNode> = {
  title: (issue, truncation) => (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex shrink-0 items-center gap-2">
        <Avatar size="sm">
          <AvatarImage src={issue.author.avatarUrl} alt={issue.author.login} />
          <AvatarFallback>
            {issue.author.login.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </div>
      <div className="min-w-0 flex-1">
        <TruncatedText
          text={issue.title}
          mode={truncation}
          endChars={10}
          className="block text-sm font-medium leading-tight"
        />
        <p className="truncate text-xs leading-tight text-muted-foreground">
          {issue.author.login} · {issue.repository.nameWithOwner}#{issue.number}
        </p>
      </div>
    </div>
  ),
  labels: (issue) => <GitHubLabels labels={issue.labels} />,
  assignees: (issue) => <AssigneesCell issue={issue} />,
  status: (issue) => <StatusCell issue={issue} />,
  reactions: (issue) => <ReactionsCell issue={issue} />,
  comments: (issue) => <CommentsCell issue={issue} />,
  milestone: (issue, truncation) => <MilestoneCell issue={issue} truncation={truncation} />,
  created: (issue) => <CreatedCell issue={issue} />,
  updated: (issue) => (
    <span className="whitespace-nowrap text-xs text-muted-foreground">
      {relativeTime(issue.updatedAt)}
    </span>
  ),
};

// ── Row ───────────────────────────────────────────────────────────────────

export function GitHubIssueRow({
  issue,
  isUnread,
  onMarkRead,
  columns,
}: {
  issue: GitHubIssue;
  isUnread?: boolean;
  onMarkRead?: (id: string) => void;
  columns: ColumnConfig[];
}) {
  const visibleColumns = columns.filter((c) => c.visible);

  return (
    <RowPreviewPopover preview={<GitHubIssuePreview issue={issue} />}>
    <TableRow
      className="group cursor-pointer"
      onClick={() => {
        onMarkRead?.(issue.id);
        window.open(issue.url, "_blank", "noopener");
      }}
    >
      {visibleColumns.map((col) => {
        const render = ISSUE_CELL_RENDERERS[col.id];
        const meta = ISSUE_COLUMN_META[col.id as keyof typeof ISSUE_COLUMN_META];
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
              {render(issue, getColumnTruncation(meta, col))}
            </>
          </ColumnCell>
        );
      })}

      <TableCell className="w-8 pr-3">
        <ExternalLink className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </TableCell>
    </TableRow>
    </RowPreviewPopover>
  );
}
