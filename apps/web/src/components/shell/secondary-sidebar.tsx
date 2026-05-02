import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { cn } from "@g-spot/ui/lib/utils";

type SecondarySidebarContextValue = {
  collapsed: boolean;
  setCollapsed: (next: boolean) => void;
  toggle: () => void;
};

const SecondarySidebarContext = createContext<SecondarySidebarContextValue | null>(null);

export function SecondarySidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const toggle = useCallback(() => setCollapsed((c) => !c), []);
  const value = useMemo(
    () => ({ collapsed, setCollapsed, toggle }),
    [collapsed, toggle],
  );
  return (
    <SecondarySidebarContext.Provider value={value}>
      {children}
    </SecondarySidebarContext.Provider>
  );
}

export function useSecondarySidebar() {
  const ctx = useContext(SecondarySidebarContext);
  if (!ctx) throw new Error("useSecondarySidebar must be used within SecondarySidebarProvider");
  return ctx;
}

type SecondarySidebarProps = {
  title: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

/**
 * Uniform shell for all per-app secondary sidebars. Renders a fixed-width
 * column with header, scrollable body, optional footer. Collapses via
 * `useSecondarySidebar()` (Cmd+B).
 */
export function SecondarySidebar({
  title,
  headerAction,
  children,
  footer,
  className,
}: SecondarySidebarProps) {
  const { collapsed } = useSecondarySidebar();

  if (collapsed) return null;

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
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
