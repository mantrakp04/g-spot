import type { ReactNode } from "react";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useResizableLayout,
} from "@g-spot/ui/components/resizable";
import { useAtomValue } from "jotai";

import {
  secondarySidebarCollapsedAtom,
  sidebarsSwappedAtom,
} from "@/lib/sidebars-store";

const SIDEBAR_PANEL_ID = "secondary-sidebar";
const MAIN_PANEL_ID = "secondary-main";

const browserStorage =
  typeof window !== "undefined" ? window.localStorage : undefined;

/**
 * Per-app layout: a uniform `[secondary sidebar][main content]` row backed
 * by a horizontal resizable panel group. The sidebar can be collapsed
 * (Cmd+B) and, when paired with a right-side panel further down the tree,
 * swapped to the opposite side via the global swap toggle.
 */
export function AppLayout({
  sidebar,
  children,
}: {
  sidebar?: ReactNode;
  children: ReactNode;
}) {
  const collapsed = useAtomValue(secondarySidebarCollapsedAtom);
  const swapped = useAtomValue(sidebarsSwappedAtom);

  const { defaultLayout, onLayoutChanged } = useResizableLayout({
    id: "gspot.shell.secondary",
    panelIds: [SIDEBAR_PANEL_ID, MAIN_PANEL_ID],
    storage: browserStorage,
  });

  if (!sidebar) {
    return (
      <div className="flex h-full min-h-0 min-w-0">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
      </div>
    );
  }

  const sidebarPanel = (
    <ResizablePanel
      id={SIDEBAR_PANEL_ID}
      defaultSize="18"
      minSize="10"
      maxSize="40"
      className="min-w-[200px]"
    >
      {sidebar}
    </ResizablePanel>
  );

  const mainPanel = (
    <ResizablePanel id={MAIN_PANEL_ID} minSize="40">
      <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </ResizablePanel>
  );

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      className="min-h-0 min-w-0 flex-1"
    >
      {!collapsed && !swapped && (
        <>
          {sidebarPanel}
          <ResizableHandle />
        </>
      )}
      {mainPanel}
      {!collapsed && swapped && (
        <>
          <ResizableHandle />
          {sidebarPanel}
        </>
      )}
    </ResizablePanelGroup>
  );
}
