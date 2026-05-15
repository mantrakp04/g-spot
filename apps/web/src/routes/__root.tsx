import { useEffect } from "react";

import { Toaster } from "@g-spot/ui/components/sonner";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import type { QueryClient } from "@tanstack/react-query";
import { HeadContent, Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { useAtom } from "jotai";

import { GlobalCommandPalette } from "@/components/search/global-command-palette";
import { AppIconRail } from "@/components/shell/app-icon-rail";
import { reapTerminalSessions } from "@/components/terminal/terminal-sessions";
import { useTabs } from "@/lib/tabs-store";
import { useSecondarySidebar } from "@/components/shell/secondary-sidebar";
import { rightSidebarCollapsedAtom } from "@/lib/sidebars-store";
import { DraftDock } from "@/components/inbox/draft-dock";
import { RelayHeartbeat } from "@/components/relay-heartbeat";
import { ConfirmDialogProvider } from "@/contexts/confirm-dialog-context";
import { DraftsProvider } from "@/contexts/drafts-context";
import { PiCredentialFlowsProvider } from "@/contexts/pi-credential-flows-context";
import { SectionCountsProvider } from "@/contexts/section-counts-context";
import { ThemeProvider } from "@/components/tweakcn-theme-provider";
import { getExternalHttpUrl, openExternalUrl } from "@/lib/external-url";
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
      { title: "g-spot" },
      { name: "description", content: "g-spot is a web application" },
    ],
    links: [{ rel: "icon", type: "image/png", href: "/logo.png" }],
  }),
});

function SidebarHotkeys() {
  const { toggle: toggleSecondary } = useSecondarySidebar();
  const [, setRightCollapsed] = useAtom(rightSidebarCollapsedAtom);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "b") {
        event.preventDefault();
        toggleSecondary();
        return;
      }

      if (key === "l") {
        event.preventDefault();
        setRightCollapsed((v) => !v);
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [setRightCollapsed, toggleSecondary]);

  return null;
}

function ExternalLinkInterceptor() {
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

  return null;
}

function TerminalSessionReaper() {
  const tabs = useTabs();
  useEffect(() => {
    const liveIds = new Set(tabs.filter((t) => t.kind === "terminal").map((t) => t.id));
    reapTerminalSessions(liveIds);
  }, [tabs]);
  return null;
}

function RootShell() {
  return (
    <SectionCountsProvider>
      <DraftsProvider>
        <PiCredentialFlowsProvider>
          <SidebarHotkeys />
          <ExternalLinkInterceptor />
          <TerminalSessionReaper />
          <div className="flex h-full min-h-0 min-w-0">
            <AppIconRail />
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <Outlet />
            </div>
          </div>
          <GlobalCommandPalette />
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
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <HotkeysProvider
          defaultOptions={{
            hotkey: { ignoreInputs: false },
            hotkeySequence: { ignoreInputs: false },
          }}
        >
          <ConfirmDialogProvider>
            <RootShell />
          </ConfirmDialogProvider>
          <Toaster richColors />
        </HotkeysProvider>
      </ThemeProvider>
    </>
  );
}
