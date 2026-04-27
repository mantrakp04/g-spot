import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@g-spot/ui/components/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup, type ResizablePanelHandle } from "@g-spot/ui/components/resizable";
import { Toaster } from "@g-spot/ui/components/sonner";
import { HotkeysProvider, useHotkeys } from "@tanstack/react-hotkeys";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { HeadContent, Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { ChevronsRight } from "lucide-react";

import { AppSidebar } from "@/components/app-sidebar";
import { DraftDock } from "@/components/inbox/draft-dock";
import { RelayHeartbeat } from "@/components/relay-heartbeat";
import { ConfirmDialogProvider } from "@/contexts/confirm-dialog-context";
import { DraftsProvider } from "@/contexts/drafts-context";
import { PiCredentialFlowsProvider } from "@/contexts/pi-credential-flows-context";
import { SectionCountsProvider } from "@/contexts/section-counts-context";
import { ThemeProvider, ThemeScript } from "@/components/tweakcn-theme-provider";
import { getExternalHttpUrl, openExternalUrl } from "@/lib/external-url";
import type { trpc } from "@/utils/trpc";

import "../index.css";

const COLLAPSED_SIDEBAR_TRIGGER_DELAY_MS = 450;

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

function RootShell() {
  const sidebarPanelRef = useRef<ResizablePanelHandle | null>(null);
  const collapsedSidebarTriggerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showCollapsedSidebarTrigger, setShowCollapsedSidebarTrigger] = useState(false);

  const handleToggleSidebar = useCallback(() => {
    const sidebarPanel = sidebarPanelRef.current;
    if (!sidebarPanel) return;

    if (sidebarPanel.isCollapsed()) {
      sidebarPanel.expand();
      return;
    }

    sidebarPanel.collapse();
  }, []);

  const clearCollapsedSidebarTriggerTimer = useCallback(() => {
    if (!collapsedSidebarTriggerTimerRef.current) return;

    clearTimeout(collapsedSidebarTriggerTimerRef.current);
    collapsedSidebarTriggerTimerRef.current = null;
  }, []);

  const handleCollapsedSidebarTriggerEnter = useCallback(() => {
    clearCollapsedSidebarTriggerTimer();
    collapsedSidebarTriggerTimerRef.current = setTimeout(() => {
      setShowCollapsedSidebarTrigger(true);
      collapsedSidebarTriggerTimerRef.current = null;
    }, COLLAPSED_SIDEBAR_TRIGGER_DELAY_MS);
  }, [clearCollapsedSidebarTriggerTimer]);

  const handleCollapsedSidebarTriggerLeave = useCallback(() => {
    clearCollapsedSidebarTriggerTimer();
    setShowCollapsedSidebarTrigger(false);
  }, [clearCollapsedSidebarTriggerTimer]);

  const handleToggleSidebarHotkey = useCallback(() => {
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      (activeElement.isContentEditable ||
        activeElement.matches("input, textarea, select, [role='textbox']"))
    ) {
      return;
    }

    handleToggleSidebar();
  }, [handleToggleSidebar]);

  useEffect(() => {
    if (isSidebarCollapsed) return;

    clearCollapsedSidebarTriggerTimer();
    setShowCollapsedSidebarTrigger(false);
  }, [clearCollapsedSidebarTriggerTimer, isSidebarCollapsed]);

  useEffect(() => clearCollapsedSidebarTriggerTimer, [clearCollapsedSidebarTriggerTimer]);

  useHotkeys([
    {
      hotkey: "Mod+B",
      callback: handleToggleSidebarHotkey,
      options: { meta: { name: "Toggle sidebar" } },
    },
  ]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0 && event.button !== 1) return;

      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.hasAttribute("download")) return;

      const externalUrl = getExternalHttpUrl(anchor.href);
      if (!externalUrl) return;

      event.preventDefault();
      void openExternalUrl(externalUrl);
    };

    document.addEventListener("click", handleClick, true);
    document.addEventListener("auxclick", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("auxclick", handleClick, true);
    };
  }, []);

  return (
    <SectionCountsProvider>
      <DraftsProvider>
        <PiCredentialFlowsProvider>
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
                <div
                  className="fixed top-0 left-0 z-40 flex h-14 w-14 items-start justify-start p-3"
                  onPointerEnter={handleCollapsedSidebarTriggerEnter}
                  onPointerLeave={handleCollapsedSidebarTriggerLeave}
                >
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={handleToggleSidebar}
                    aria-label="Expand sidebar"
                    className={
                      showCollapsedSidebarTrigger
                        ? "opacity-100 transition-opacity duration-150"
                        : "pointer-events-none opacity-0 transition-opacity duration-150"
                    }
                  >
                    <ChevronsRight className="size-4" />
                  </Button>
                </div>
              )}
              <Outlet />
            </ResizablePanel>
          </ResizablePanelGroup>
          <DraftDock />
          <RelayHeartbeat />
        </PiCredentialFlowsProvider>
      </DraftsProvider>
    </SectionCountsProvider>
  );
}

function RootComponent() {
  return (
    <>
      <HeadContent />
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
      >
        <HotkeysProvider>
          <ConfirmDialogProvider>
            <RootShell />
          </ConfirmDialogProvider>
          <Toaster richColors />
        </HotkeysProvider>
      </ThemeProvider>
      <TanStackRouterDevtools position="bottom-right" />
      <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
    </>
  );
}
