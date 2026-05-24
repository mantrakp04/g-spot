import type { ReactNode } from "react";

import { cn } from "@g-spot/ui/lib/utils";
import { useAtom } from "jotai";

import { secondarySidebarCollapsedAtom } from "@/lib/sidebars-store";

/**
 * Hook returning the same shape as the previous context-based API so existing
 * call sites keep working. Backed by a persistent atom now.
 */
export function useSecondarySidebar() {
  const [collapsed, setCollapsed] = useAtom(secondarySidebarCollapsedAtom);
  return {
    collapsed,
    setCollapsed,
    toggle: () => setCollapsed((v) => !v),
  };
}

type SecondarySidebarProps = {
  title: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

/**
 * Uniform shell for all per-app secondary sidebars. Renders a flex column
 * that fills its container (its width is owned by the surrounding
 * ResizablePanel in `AppLayout`). Collapses via `useSecondarySidebar()`
 * (Cmd+B) — when collapsed the parent skips the panel entirely so we don't
 * render anything ourselves.
 */
export function SecondarySidebar({
  title,
  headerAction,
  children,
  footer,
  className,
}: SecondarySidebarProps) {
  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden border-sidebar-border bg-sidebar text-sidebar-foreground",
        className,
      )}
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-sidebar-border px-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {title}
        </div>
        {headerAction}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      {footer ? (
        <div className="shrink-0 border-t border-sidebar-border p-2">{footer}</div>
      ) : null}
    </aside>
  );
}
