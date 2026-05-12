import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@g-spot/ui/components/tooltip";
import { cn } from "@g-spot/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

type GroupAction = {
  label: string;
  icon: ReactNode;
  onClick: (e: MouseEvent) => void;
  destructive?: boolean;
};

type Props = {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  actions?: GroupAction[];
  children: ReactNode;
  selectedCount?: number;
  onClearSelection?: () => void;
  selectionActions?: GroupAction[];
};

export function ResourceGroup({
  title,
  count,
  expanded,
  onToggle,
  actions,
  children,
  selectedCount = 0,
  onClearSelection,
  selectionActions,
}: Props) {
  return (
    <div className="group/group flex flex-col">
      <div
        className="sticky top-0 z-10 flex h-7 items-center gap-1.5 bg-background/95 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground backdrop-blur"
      >
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 hover:text-foreground"
        >
          <ChevronRight
            className={cn(
              "size-3 shrink-0 transition-transform",
              expanded && "rotate-90",
            )}
          />
          <span className="truncate">{title}</span>
          <span className="rounded bg-muted px-1 text-[10px] font-mono text-foreground/70">
            {count}
          </span>
        </button>
        {actions && actions.length > 0 && (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover/group:opacity-100 group-focus-within/group:opacity-100">
            {actions.map((a) => (
              <Tooltip key={a.label}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={a.onClick}
                      aria-label={a.label}
                      className={cn(
                        "grid size-5 place-items-center rounded hover:bg-muted",
                        a.destructive && "hover:text-destructive",
                      )}
                    >
                      {a.icon}
                    </button>
                  }
                />
                <TooltipContent>{a.label}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}
      </div>
      {expanded && <div className="flex flex-col">{children}</div>}
      {selectedCount > 1 && expanded && (
        <div className="sticky bottom-0 mx-2 mb-1 flex items-center gap-2 rounded-md border border-border bg-background/95 px-2 py-1 text-[10px] backdrop-blur">
          <span className="text-muted-foreground">{selectedCount} selected</span>
          {selectionActions?.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={a.onClick}
              className={cn(
                "rounded px-1.5 py-0.5 hover:bg-muted",
                a.destructive && "hover:text-destructive",
              )}
            >
              {a.label}
            </button>
          ))}
          {onClearSelection && (
            <button
              type="button"
              onClick={onClearSelection}
              className="ml-auto rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
