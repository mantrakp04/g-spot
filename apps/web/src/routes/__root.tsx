import { useCallback, useRef, useState } from "react";

import { Button } from "@g-spot/ui/components/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup, type ResizablePanelHandle } from "@g-spot/ui/components/resizable";
import { Toaster } from "@g-spot/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { HeadContent, Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { ChevronsRight } from "lucide-react";

import { AppSidebar } from "@/components/app-sidebar";
import { DraftDock } from "@/components/inbox/draft-dock";
import { DraftsProvider } from "@/contexts/drafts-context";
import { SectionCountsProvider } from "@/contexts/section-counts-context";
import { ThemeProvider, ThemeScript } from "@/components/tweakcn-theme-provider";
import type { trpc } from "@/utils/trpc";

import "../index.css";

export interface RouterAppContext {
  trpc: typeof trpc;
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  head: () => ({
    meta: [
      {
        title: "g-spot",
      },
      {
        name: "description",
        content: "g-spot is a web application",
      },
    ],
    links: [
      {
        rel: "icon",
        type: "image/png",
        href: "/logo.png",
      },
    ],
  }),
});

function RootComponent() {
  const sidebarPanelRef = useRef<ResizablePanelHandle | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const handleToggleSidebar = useCallback(() => {
    const sidebarPanel = sidebarPanelRef.current;
    if (!sidebarPanel) return;

    if (sidebarPanel.isCollapsed()) {
      sidebarPanel.expand();
      return;
    }

    sidebarPanel.collapse();
  }, []);

  return (
    <>
      <HeadContent />
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
      >
        <SectionCountsProvider>
          <DraftsProvider>
            <ResizablePanelGroup orientation="horizontal" className="h-full">
              <ResizablePanel
                panelRef={sidebarPanelRef}
                defaultSize="15"
                minSize="10"
                maxSize="25"
                collapsible
                collapsedSize={0}
                onResize={(panelSize) => setIsSidebarCollapsed(panelSize.asPercentage === 0)}
              >
                <AppSidebar onToggleCollapse={handleToggleSidebar} />
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel defaultSize="85" className="overflow-hidden">
                {isSidebarCollapsed && (
                  <div className="fixed top-3 left-3 z-40">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      onClick={handleToggleSidebar}
                      aria-label="Expand sidebar"
                    >
                      <ChevronsRight className="size-4" />
                    </Button>
                  </div>
                )}
                <Outlet />
              </ResizablePanel>
            </ResizablePanelGroup>
            <DraftDock />
          </DraftsProvider>
        </SectionCountsProvider>
        <Toaster richColors />
      </ThemeProvider>
      <TanStackRouterDevtools position="bottom-right" />
      <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
    </>
  );
}
