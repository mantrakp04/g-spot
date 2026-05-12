import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@g-spot/ui/components/tooltip";
import { cn } from "@g-spot/ui/lib/utils";
import { CheckCheck, Diff, Eye, Minus, Plus, Undo2 } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { FileIcon } from "react-files-icons";

import type { DiffMode } from "@/lib/tabs-store";

import { ChangeContextMenu } from "./context-menu";
import type { GroupId } from "./use-changes";
import type { ChangeEntry, GitMutations } from "./use-git-mutations";

type Props = {
  change: ChangeEntry;
  group: GroupId;
  selected: boolean;
  selection: string[];
  paths: string[];
  /** Show full path (tree-mode) instead of basename + grey parent. */
  showFullPath?: boolean;
  displayName?: string;
  depth?: number;
  mutations: GitMutations;
  onClick: (e: MouseEvent) => void;
  onDoubleClick: () => void;
  onOpenFile: (path: string) => void;
  onOpenDiff: (path: string, mode: DiffMode) => void;
};

const STATUS_BADGE: Record<
  ChangeEntry["staged"],
  { label: string; className: string; title: string } | null
> = {
  modified: { label: "M", className: "text-yellow-500", title: "Modified" },
  added: { label: "A", className: "text-emerald-500", title: "Added" },
  deleted: { label: "D", className: "text-red-500", title: "Deleted" },
  renamed: { label: "R", className: "text-blue-400", title: "Renamed" },
  copied: { label: "C", className: "text-blue-400", title: "Copied" },
  untracked: { label: "U", className: "text-emerald-400", title: "Untracked" },
  conflicted: { label: "!", className: "text-red-400", title: "Conflicted" },
  typeChanged: { label: "T", className: "text-yellow-500", title: "Type" },
  ignored: { label: "!", className: "text-muted-foreground", title: "Ignored" },
  unknown: null,
};

const GROUP_DIFF_MODE: Record<GroupId, DiffMode> = {
  merge: "uncommitted",
  staged: "staged",
  changes: "unstaged",
};

export function ResourceRow({
  change,
  group,
  selected,
  selection,
  paths,
  showFullPath,
  displayName,
  depth = 0,
  mutations,
  onClick,
  onDoubleClick,
  onOpenFile,
  onOpenDiff,
}: Props) {
  const code =
    group === "staged"
      ? change.staged
      : change.unstaged !== "unknown"
        ? change.unstaged
        : change.staged;
  const badge = STATUS_BADGE[code] ?? null;
  const name = displayName ?? change.path.split("/").pop()!;
  const parent = showFullPath
    ? ""
    : (() => {
        const idx = change.path.lastIndexOf("/");
        return idx === -1 ? "" : change.path.slice(0, idx);
      })();
  const diffMode = GROUP_DIFF_MODE[group];

  const isConflicted = group === "merge";
  const isStaged = group === "staged";
  const isUntracked = change.unstaged === "untracked";

  // When >1 selected and current row is in selection, hover actions act on whole selection.
  const actionPaths = selection.length > 1 && selected ? selection : paths;

  return (
    <ChangeContextMenu
      change={change}
      group={group}
      paths={actionPaths}
      mutations={mutations}
      onOpenFile={onOpenFile}
      onOpenDiff={onOpenDiff}
    >
      <div
        className={cn(
          "group/row relative flex h-6 min-w-0 items-center gap-1.5 px-2 text-left text-xs transition-colors hover:bg-muted/50",
          selected && "bg-accent/40",
        )}
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        role="button"
        tabIndex={0}
      >
        <FileIcon name={name} className="size-3.5 shrink-0" />
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="flex min-w-0 flex-1 items-baseline gap-1.5 truncate">
                <span className="truncate">{name}</span>
                {parent && (
                  <span className="truncate text-[10px] text-muted-foreground">
                    {parent}
                  </span>
                )}
              </span>
            }
          />
          <TooltipContent>{change.path}</TooltipContent>
        </Tooltip>

        {/* Hover toolbar — replaces badge */}
        <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100">
          <RowAction
            label="Open File"
            onClick={(e) => {
              e.stopPropagation();
              onOpenFile(change.path);
            }}
          >
            <Eye className="size-3" />
          </RowAction>
          <RowAction
            label="Open Diff"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDiff(change.path, diffMode);
            }}
          >
            <Diff className="size-3" />
          </RowAction>
          {isConflicted ? (
            <>
              <RowAction
                label="Accept Current"
                onClick={(e) => {
                  e.stopPropagation();
                  mutations.acceptCurrent.mutate({ paths: actionPaths });
                }}
              >
                <CheckCheck className="size-3" />
              </RowAction>
              <RowAction
                label="Stage"
                onClick={(e) => {
                  e.stopPropagation();
                  mutations.stage.mutate({ paths: actionPaths });
                }}
              >
                <Plus className="size-3" />
              </RowAction>
            </>
          ) : isStaged ? (
            <RowAction
              label="Unstage"
              onClick={(e) => {
                e.stopPropagation();
                mutations.unstage.mutate({ paths: actionPaths });
              }}
            >
              <Minus className="size-3" />
            </RowAction>
          ) : (
            <>
              <RowAction
                label="Discard"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isUntracked) {
                    mutations.cleanUntracked.mutate({ paths: actionPaths });
                  } else {
                    mutations.discard.mutate({ paths: actionPaths });
                  }
                }}
              >
                <Undo2 className="size-3" />
              </RowAction>
              <RowAction
                label="Stage"
                onClick={(e) => {
                  e.stopPropagation();
                  mutations.stage.mutate({ paths: actionPaths });
                }}
              >
                <Plus className="size-3" />
              </RowAction>
            </>
          )}
        </div>

        {/* Badge — hidden on hover */}
        {badge && (
          <span
            className={cn(
              "ml-auto shrink-0 font-mono text-[10px] font-bold group-hover/row:hidden",
              badge.className,
            )}
            title={badge.title}
          >
            {badge.label}
          </span>
        )}
      </div>
    </ChangeContextMenu>
  );
}

function RowAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: (e: MouseEvent) => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onClick}
            className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={label}
          >
            {children}
          </button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
