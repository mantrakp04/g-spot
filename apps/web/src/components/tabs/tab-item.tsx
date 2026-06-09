import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@g-spot/ui/components/context-menu";
import { cn } from "@g-spot/ui/lib/utils";
import {
  Columns2,
  FileText,
  FolderTree,
  GitBranch,
  GitCompare,
  Rows2,
  Sparkles,
  TerminalSquare,
  X,
} from "lucide-react";
import type { MouseEvent } from "react";

import type { Tab } from "@/lib/tabs-store";

type TabItemProps = {
  tab: Tab;
  active: boolean;
  highlighted?: boolean;
  onFocus: () => void;
  onClose: () => void;
  onCloseOthers?: () => void;
  onCloseToRight?: () => void;
  onSplitRight?: () => void;
  onSplitDown?: () => void;
  canCloseOthers?: boolean;
  canCloseToRight?: boolean;
};

export function TabItem({
  tab,
  active,
  highlighted = false,
  onFocus,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onSplitRight,
  onSplitDown,
  canCloseOthers = false,
  canCloseToRight = false,
}: TabItemProps) {
  const Icon =
    tab.kind === "terminal"
      ? TerminalSquare
      : tab.kind === "file"
        ? FileText
        : tab.kind === "diff"
          ? GitCompare
          : tab.kind === "file-tree"
            ? FolderTree
            : tab.kind === "changes"
              ? GitBranch
              : Sparkles;
  const handleAuxClick = (event: MouseEvent<HTMLElement>) => {
    if (event.button === 1) {
      event.preventDefault();
      onClose();
    }
  };
  const handleClose = (event: MouseEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    onClose();
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<button type="button" />}
        role="tab"
        aria-selected={active}
        data-active={active}
        data-highlighted={highlighted}
        onClick={onFocus}
        onAuxClick={handleAuxClick}
        className={cn(
          "group relative flex h-9 min-w-0 max-w-[14rem] shrink-0 items-center gap-2 px-3 text-xs font-medium",
          "transition-colors duration-100",
          "border-r border-sidebar-border",
          active
            ? "bg-background text-foreground"
            : highlighted
              ? "bg-primary/10 text-foreground shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.24)] hover:bg-primary/15"
              : "text-muted-foreground hover:bg-background/40 hover:text-foreground",
        )}
      >
        <Icon className={cn("size-3.5 shrink-0", active ? "opacity-100" : "opacity-70")} />
        <span className="min-w-0 flex-1 truncate text-left">{tab.title || "Untitled"}</span>
        <span
          role="button"
          aria-label="Close tab"
          tabIndex={-1}
          onClick={handleClose}
          className={cn(
            "grid size-4 place-items-center rounded-sm text-muted-foreground/80",
            "opacity-0 transition-opacity hover:bg-muted hover:text-foreground",
            "group-hover:opacity-100",
            active && "opacity-100",
          )}
        >
          <X className="size-3" />
        </span>
        {active && (
          <span
            aria-hidden
            className="absolute inset-x-2 -bottom-px h-px bg-primary"
          />
        )}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={onClose}>
          Close
          <ContextMenuShortcut>⌘W</ContextMenuShortcut>
        </ContextMenuItem>
        {onCloseOthers && (
          <ContextMenuItem disabled={!canCloseOthers} onClick={onCloseOthers}>
            Close Others
          </ContextMenuItem>
        )}
        {onCloseToRight && (
          <ContextMenuItem disabled={!canCloseToRight} onClick={onCloseToRight}>
            Close to the Right
          </ContextMenuItem>
        )}
        {(onSplitRight || onSplitDown) && <ContextMenuSeparator />}
        {onSplitRight && (
          <ContextMenuItem onClick={onSplitRight}>
            <Columns2 className="size-3.5" />
            Split Right
          </ContextMenuItem>
        )}
        {onSplitDown && (
          <ContextMenuItem onClick={onSplitDown}>
            <Rows2 className="size-3.5" />
            Split Down
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
