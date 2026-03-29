import type { ReactNode } from "react";

import { Badge } from "@g-spot/ui/components/badge";
import { Button } from "@g-spot/ui/components/button";
import {
  Collapsible,
  CollapsibleTrigger,
} from "@g-spot/ui/components/collapsible";
import { cn } from "@g-spot/ui/lib/utils";
import { ChevronDown, ChevronRight, ArrowUpDown, Settings } from "lucide-react";

export type InboxSectionData = {
  id: string;
  name: string;
  source: "github_pr" | "gmail";
  filters: string;
  collapsed: boolean;
  showBadge: boolean;
};

type InboxSectionProps = {
  section: InboxSectionData;
  itemCount: number;
  children: ReactNode;
  onToggleCollapse: (collapsed: boolean) => void;
  onEdit: () => void;
  sortAsc?: boolean;
  onToggleSort?: () => void;
};

export function InboxSection({
  section,
  itemCount,
  children,
  onToggleCollapse,
  onEdit,
  sortAsc = false,
  onToggleSort,
}: InboxSectionProps) {
  const isOpen = !section.collapsed;

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={(open) => onToggleCollapse(!open)}
    >
      <div className="overflow-hidden rounded-lg border border-border/60 bg-card">
        <div className="flex items-center transition-colors hover:bg-muted/50">
          <CollapsibleTrigger className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-2.5 text-left">
            {isOpen ? (
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {section.name}
            </span>
            {section.showBadge && itemCount > 0 && (
              <Badge
                variant="secondary"
                className="ml-1 tabular-nums"
              >
                {itemCount}
              </Badge>
            )}
          </CollapsibleTrigger>
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
              onClick={() => onEdit()}
            >
              <Settings className="size-3" />
            </Button>
          </div>
        </div>

        {isOpen && (
          <div className="border-t border-border/40">{children}</div>
        )}
      </div>
    </Collapsible>
  );
}
