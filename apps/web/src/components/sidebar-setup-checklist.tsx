import { Badge } from "@g-spot/ui/components/badge";
import { Button } from "@g-spot/ui/components/button";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import { cn } from "@g-spot/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { BotIcon, Check, ChevronRight, Github, Mail, X } from "lucide-react";

import { useSetupChecklistDismissed } from "@/hooks/use-setup-checklist-dismissed";
import { usePiCatalog } from "@/hooks/use-pi";

type SidebarSetupChecklistProps = {
  accountsLoaded: boolean;
  enabled: boolean;
  githubConnected: boolean;
  gmailConnected: boolean;
};

const checklistItems = [
  {
    id: "github",
    label: "Connect GitHub",
    icon: Github,
  },
  {
    id: "gmail",
    label: "Connect Gmail",
    icon: Mail,
  },
  {
    id: "pi",
    label: "Configure Pi agent",
    icon: BotIcon,
  },
] as const;

export function SidebarSetupChecklist({
  accountsLoaded,
  enabled,
  githubConnected,
  gmailConnected,
}: SidebarSetupChecklistProps) {
  const { dismissed, dismiss } = useSetupChecklistDismissed();
  const piCatalog = usePiCatalog(enabled);

  if (!enabled || dismissed) {
    return null;
  }

  const piConfigured = (piCatalog.data?.configuredProviders.length ?? 0) > 0;
  const completionByItem = {
    github: githubConnected,
    gmail: gmailConnected,
    pi: piConfigured,
  } satisfies Record<(typeof checklistItems)[number]["id"], boolean>;
  const completedCount = checklistItems.filter(
    (item) => completionByItem[item.id],
  ).length;
  const isLoading = !accountsLoaded || piCatalog.isLoading;

  return (
    <section className="rounded-lg border border-sidebar-border/70 bg-sidebar-accent/20 p-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Setup
            </span>
            <Badge
              variant="secondary"
              className="h-4 min-w-[1.5rem] px-1 text-[10px] tabular-nums"
            >
              {isLoading ? "..." : `${completedCount}/${checklistItems.length}`}
            </Badge>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Connect the basics before you dive in.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={dismiss}
          aria-label="Hide setup checklist"
        >
          <X className="size-3" />
        </Button>
      </div>

      <div className="mt-2 space-y-1">
        {isLoading ? (
          <>
            <Skeleton className="h-8 rounded-md" />
            <Skeleton className="h-8 rounded-md" />
            <Skeleton className="h-8 rounded-md" />
          </>
        ) : (
          checklistItems.map((item) => {
            const complete = completionByItem[item.id];

            return (
              <Link
                key={item.id}
                to="/settings/connections"
                className={cn(
                  "group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-sidebar-accent",
                  complete && "text-sidebar-foreground",
                )}
              >
                <item.icon
                  className={cn(
                    "size-3.5 shrink-0",
                    complete ? "text-emerald-500" : "text-muted-foreground",
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {complete ? (
                  <Check className="size-3.5 shrink-0 text-emerald-500" />
                ) : (
                  <>
                    <span className="text-[10px] text-muted-foreground">
                      Open
                    </span>
                    <ChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}
