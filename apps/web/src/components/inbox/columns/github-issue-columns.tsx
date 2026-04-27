import type { ColumnDef } from "@tanstack/react-table";

import { ISSUE_COLUMN_META } from "@g-spot/types/filters";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@g-spot/ui/components/avatar";
import { Badge } from "@g-spot/ui/components/badge";
import {
  CircleCheck,
  CircleDot,
  CircleSlash,
  ExternalLink,
  MessageSquare,
  Milestone,
  SmilePlus,
} from "lucide-react";

import type { GitHubIssue } from "@/lib/github/types";
import { GitHubLabels, relativeTime } from "../shared";
import { TruncatedText } from "../truncated-text";

function stateIcon(issue: GitHubIssue) {
  if (issue.state === "OPEN") return <CircleDot className="size-2.5 text-emerald-500" />;
  if (issue.stateReason === "NOT_PLANNED")
    return <CircleSlash className="size-2.5 text-muted-foreground" />;
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
    <Badge variant={stateVariant(issue)} className="gap-1 px-1.5 py-0 text-[10px] uppercase">
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

function MilestoneCell({
  issue,
  truncation,
}: {
  issue: GitHubIssue;
  truncation: "end" | "middle";
}) {
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

function TitleCell({
  issue,
  isUnread,
  truncation,
}: {
  issue: GitHubIssue;
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
          <AvatarImage src={issue.author.avatarUrl} alt={issue.author.login} />
          <AvatarFallback>{issue.author.login.slice(0, 2).toUpperCase()}</AvatarFallback>
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
  );
}

// ── Column definitions ──────────────────────────────────────────────────

export const TRAILING_EXTERNAL_COLUMN_ID = "_trailing_external";

type IssueColumnInput = {
  columnConfig: { id: string; visible: boolean; truncation: "end" | "middle"; label: string | null }[];
  isUnread: (id: string) => boolean;
};

export function buildIssueColumns({
  columnConfig,
  isUnread,
}: IssueColumnInput): ColumnDef<GitHubIssue, unknown>[] {
  const truncationFor = (id: string) =>
    columnConfig.find((c) => c.id === id)?.truncation ?? "end";
  const labelOverride = (id: string) =>
    columnConfig.find((c) => c.id === id)?.label?.trim() || null;
  const metaFor = (id: keyof typeof ISSUE_COLUMN_META) => ISSUE_COLUMN_META[id];

  return [
    {
      id: "title",
      header: () => labelOverride("title") ?? metaFor("title").label,
      cell: ({ row }) => (
        <TitleCell
          issue={row.original}
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
      id: "labels",
      header: () => labelOverride("labels") ?? metaFor("labels").label,
      cell: ({ row }) => <GitHubLabels labels={row.original.labels} />,
      size: metaFor("labels").width ?? 96,
      minSize: metaFor("labels").minWidth,
      maxSize: metaFor("labels").maxWidth,
      meta: {
        align: metaFor("labels").align,
        breakpoint: metaFor("labels").breakpoint,
      },
    },
    {
      id: "assignees",
      header: () => labelOverride("assignees") ?? metaFor("assignees").label,
      cell: ({ row }) => <AssigneesCell issue={row.original} />,
      size: metaFor("assignees").width ?? 120,
      minSize: metaFor("assignees").minWidth,
      maxSize: metaFor("assignees").maxWidth,
      meta: {
        align: metaFor("assignees").align,
        truncation: metaFor("assignees").truncation,
        breakpoint: metaFor("assignees").breakpoint,
      },
    },
    {
      id: "status",
      header: () => labelOverride("status") ?? metaFor("status").label,
      cell: ({ row }) => <StatusCell issue={row.original} />,
      size: metaFor("status").width ?? 112,
      minSize: metaFor("status").minWidth,
      maxSize: metaFor("status").maxWidth,
      meta: {
        align: metaFor("status").align,
        breakpoint: metaFor("status").breakpoint,
      },
    },
    {
      id: "reactions",
      header: () => labelOverride("reactions") ?? metaFor("reactions").label,
      cell: ({ row }) => <ReactionsCell issue={row.original} />,
      size: metaFor("reactions").width ?? 88,
      minSize: metaFor("reactions").minWidth,
      maxSize: metaFor("reactions").maxWidth,
      meta: {
        align: metaFor("reactions").align,
        breakpoint: metaFor("reactions").breakpoint,
      },
    },
    {
      id: "comments",
      header: () => labelOverride("comments") ?? metaFor("comments").label,
      cell: ({ row }) => <CommentsCell issue={row.original} />,
      size: metaFor("comments").width ?? 80,
      minSize: metaFor("comments").minWidth,
      maxSize: metaFor("comments").maxWidth,
      meta: {
        align: metaFor("comments").align,
        truncation: metaFor("comments").truncation,
        breakpoint: metaFor("comments").breakpoint,
      },
    },
    {
      id: "milestone",
      header: () => labelOverride("milestone") ?? metaFor("milestone").label,
      cell: ({ row }) => (
        <MilestoneCell issue={row.original} truncation={truncationFor("milestone")} />
      ),
      size: metaFor("milestone").width ?? 120,
      minSize: metaFor("milestone").minWidth,
      maxSize: metaFor("milestone").maxWidth,
      meta: {
        align: metaFor("milestone").align,
        truncation: metaFor("milestone").truncation,
        breakpoint: metaFor("milestone").breakpoint,
      },
    },
    {
      id: "created",
      header: () => labelOverride("created") ?? metaFor("created").label,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{relativeTime(row.original.createdAt)}</span>
      ),
      size: metaFor("created").width ?? 80,
      minSize: metaFor("created").minWidth,
      maxSize: metaFor("created").maxWidth,
      meta: {
        align: metaFor("created").align,
        truncation: metaFor("created").truncation,
        breakpoint: metaFor("created").breakpoint,
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
