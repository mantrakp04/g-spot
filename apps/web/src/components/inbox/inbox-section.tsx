import type { ReactNode } from "react";

import { Badge } from "@g-spot/ui/components/badge";
import { Button } from "@g-spot/ui/components/button";
import { cn } from "@g-spot/ui/lib/utils";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Cog,
  RefreshCw,
} from "lucide-react";

export type InboxSectionData = {
  id: string;
  name: string;
  source: "github_pr" | "github_issue" | "gmail";
  filters: string;
  collapsed: boolean;
  showBadge: boolean;
};

type InboxSectionProps = {
  section: InboxSectionData;
  itemCount: number;
  /** When true, append "+" (e.g. Gmail total count query still in flight). */
  countTotalPending?: boolean;
  children: ReactNode;
  onToggle: () => void;
  onEdit: () => void;
  sortAsc?: boolean;
  onToggleSort?: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
};

export function InboxSection({
  section,
  itemCount,
  countTotalPending,
  children,
  onToggle,
  onEdit,
  sortAsc = false,
  onToggleSort,
  onRefresh,
  isRefreshing,
}: InboxSectionProps) {
  const isOpen = !section.collapsed;

  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <div className="flex items-center transition-colors hover:bg-muted/50">
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-2.5 text-left"
          onClick={onToggle}
        >
          {isOpen ? (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {section.name}
          </span>
          <Badge
            variant="outline"
            className="h-4 shrink-0 px-1.5 text-[10px] uppercase text-muted-foreground"
          >
            {section.source === "github_pr"
              ? "PR"
              : section.source === "github_issue"
                ? "Issue"
                : "Gmail"}
          </Badge>
          {section.showBadge && itemCount > 0 && (
            <Badge
              variant="secondary"
              className="ml-1 tabular-nums"
            >
              {itemCount}{countTotalPending && "+"}
            </Badge>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-0.5 pr-3">
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn(
              "hover:text-foreground",
              sortAsc
                ? "bg-accent text-foreground"
                : "text-muted-foreground",
            )}
            onClick={() => onToggleSort?.()}
          >
            <ArrowUpDown className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onRefresh?.()}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn("size-3", isRefreshing && "animate-spin")} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onEdit()}
          >
            <Cog className="size-3" />
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "border-t border-border/40",
          !isOpen && "hidden",
        )}
      >
        {children}
      </div>
    </div>
  );
}
