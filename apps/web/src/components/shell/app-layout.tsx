import type { ReactNode } from "react";

/**
 * Per-app layout: a uniform `[secondary sidebar][main content]` row.
 * Plug in via each route's component.
 */
export function AppLayout({
  sidebar,
  children,
}: {
  sidebar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 min-w-0">
      {sidebar}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
