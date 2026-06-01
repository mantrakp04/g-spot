import { cn } from "@g-spot/ui/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { useAtom } from "jotai";
import {
  ArrowLeftRight,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { useCallback, useEffect } from "react";

import { useNewChat } from "@/hooks/use-new-chat";
import {
  rightSidebarCollapsedAtom,
  secondarySidebarCollapsedAtom,
  sidebarsSwappedAtom,
} from "@/lib/sidebars-store";
import {
  type Tab,
  useActiveTabId,
  useCloseTab,
  useFocusTab,
  useOpenTerminalTab,
  useTabs,
} from "@/lib/tabs-store";

import { HistoryPopover } from "./history-popover";
import { NewTabMenu } from "./new-tab-menu";
import { TabItem } from "./tab-item";

type TabBarProps = {
  projectId: string;
};

export function TabBar({ projectId }: TabBarProps) {
  const tabs = useTabs();
  const activeTabId = useActiveTabId();
  const focus = useFocusTab();
  const close = useCloseTab();
  const openTerminal = useOpenTerminalTab();
  const { newChat, isPending: newChatPending } = useNewChat();
  const navigate = useNavigate();
  const [secondaryCollapsed, setSecondaryCollapsed] = useAtom(
    secondarySidebarCollapsedAtom,
  );
  const [rightCollapsed, setRightCollapsed] = useAtom(
    rightSidebarCollapsedAtom,
  );
  const [swapped, setSwapped] = useAtom(sidebarsSwappedAtom);

  // Each toggle button represents a *position*, not a sidebar identity.
  // After a swap, the left-position toggle drives whichever sidebar lives on
  // the left so the icons match what the user sees.
  const leftCollapsed = swapped ? rightCollapsed : secondaryCollapsed;
  const setLeftCollapsed = swapped ? setRightCollapsed : setSecondaryCollapsed;
  const rightPosCollapsed = swapped ? secondaryCollapsed : rightCollapsed;
  const setRightPosCollapsed = swapped
    ? setSecondaryCollapsed
    : setRightCollapsed;

  const handleNewChat = useCallback(async () => {
    await newChat(projectId);
  }, [newChat, projectId]);

  const handleNewTerminal = useCallback(() => {
    openTerminal(projectId);
  }, [openTerminal, projectId]);

  const handleFocus = useCallback(
    (tab: Tab) => {
      focus(tab.id);
      if (tab.kind === "chat") {
        void navigate({
          to: "/projects/$projectId/chat/$chatId",
          params: { projectId: tab.projectId, chatId: tab.chatId },
        });
      }
    },
    [focus, navigate],
  );

  // ⌘T new chat, ⌘⇧T new terminal, ⌘W close active tab.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "t" && key !== "w") return;
      if (key === "w") {
        if (!activeTabId) return;
        event.preventDefault();
        close(activeTabId);
        return;
      }

      event.preventDefault();
      if (event.shiftKey) {
        handleNewTerminal();
      } else {
        void handleNewChat();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [activeTabId, close, handleNewChat, handleNewTerminal]);

  return (
    <div
      role="tablist"
      aria-label="Open tabs"
      className={cn(
        "flex h-10 shrink-0 items-stretch gap-0",
        "border-b border-sidebar-border bg-muted/30",
      )}
    >
      <div className="flex shrink-0 items-center gap-0.5 border-r border-sidebar-border px-1">
        <button
          type="button"
          onClick={() => setLeftCollapsed((v) => !v)}
          className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={leftCollapsed ? "Open left sidebar" : "Collapse left sidebar"}
          title={leftCollapsed ? "Open left sidebar" : "Collapse left sidebar"}
        >
          {leftCollapsed ? (
            <PanelLeftOpen className="size-3.5" />
          ) : (
            <PanelLeftClose className="size-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={() => setSwapped((v) => !v)}
          className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Swap sidebars"
          title="Swap sidebars"
        >
          <ArrowLeftRight className="size-3.5" />
        </button>
      </div>
      <div className="no-scrollbar flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            onFocus={() => handleFocus(tab)}
            onClose={() => close(tab.id)}
          />
        ))}
        <div className="flex shrink-0 items-center px-1">
          <NewTabMenu
            onNewChat={() => void handleNewChat()}
            onNewTerminal={handleNewTerminal}
            disabled={newChatPending}
          />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 border-l border-sidebar-border px-1">
        <HistoryPopover projectId={projectId} />
        <button
          type="button"
          onClick={() => setRightPosCollapsed((v) => !v)}
          className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={
            rightPosCollapsed ? "Open right sidebar" : "Collapse right sidebar"
          }
          title={
            rightPosCollapsed ? "Open right sidebar" : "Collapse right sidebar"
          }
        >
          {rightPosCollapsed ? (
            <PanelRightOpen className="size-3.5" />
          ) : (
            <PanelRightClose className="size-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}
