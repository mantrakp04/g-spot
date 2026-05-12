import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@g-spot/ui/components/context-menu";
import { type ReactNode } from "react";

import type { DiffMode } from "@/lib/tabs-store";

import type { GroupId } from "./use-changes";
import type { ChangeEntry, GitMutations } from "./use-git-mutations";

type Props = {
  change: ChangeEntry;
  group: GroupId;
  paths: string[];
  mutations: GitMutations;
  onOpenFile: (path: string) => void;
  onOpenDiff: (path: string, mode: DiffMode) => void;
  children: ReactNode;
};

const FALLBACK_DIFF_MODE: Record<GroupId, DiffMode> = {
  merge: "uncommitted",
  staged: "staged",
  changes: "unstaged",
};

export function ChangeContextMenu({
  change,
  group,
  paths,
  mutations,
  onOpenFile,
  onOpenDiff,
  children,
}: Props) {
  const isStaged = group === "staged";
  const isUntracked = change.unstaged === "untracked";
  const isConflicted = group === "merge";
  const diffMode = FALLBACK_DIFF_MODE[group];

  const copyPath = async (relative: boolean) => {
    try {
      await navigator.clipboard.writeText(
        relative ? change.path : change.path,
      );
    } catch {
      /* ignore */
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div className="contents" />}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onClick={() => onOpenFile(change.path)}>
          Open File
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onOpenDiff(change.path, diffMode)}>
          Open Diff
        </ContextMenuItem>
        <ContextMenuSeparator />
        {isConflicted && (
          <>
            <ContextMenuItem
              onClick={() => mutations.acceptCurrent.mutate({ paths })}
            >
              Accept Current
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => mutations.acceptIncoming.mutate({ paths })}
            >
              Accept Incoming
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => mutations.acceptBoth.mutate({ paths })}
            >
              Accept Both
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {isStaged ? (
          <ContextMenuItem
            onClick={() => mutations.unstage.mutate({ paths })}
          >
            Unstage Changes
          </ContextMenuItem>
        ) : (
          <ContextMenuItem
            onClick={() => mutations.stage.mutate({ paths })}
          >
            Stage Changes
          </ContextMenuItem>
        )}
        <ContextMenuItem
          variant="destructive"
          onClick={() => {
            if (isUntracked) {
              mutations.cleanUntracked.mutate({ paths });
            } else {
              mutations.discard.mutate({ paths });
            }
          }}
        >
          Discard Changes
        </ContextMenuItem>
        <ContextMenuSeparator />
        {isUntracked && (
          <ContextMenuItem
            onClick={() => mutations.addToGitignore.mutate(paths)}
          >
            Add to .gitignore
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => copyPath(true)}>
          Copy Path
        </ContextMenuItem>
        <ContextMenuItem onClick={() => copyPath(true)}>
          Copy Relative Path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
