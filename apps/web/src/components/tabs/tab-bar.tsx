import { cn } from "@g-spot/ui/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useCallback, useEffect } from "react";

import { useNewChat } from "@/hooks/use-new-chat";
import { rightSidebarCollapsedAtom } from "@/lib/right-sidebar-store";
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
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(
    rightSidebarCollapsedAtom,
  );

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

  // ⌘T new chat, ⌘⇧T new terminal.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== "t") return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.matches("input, textarea, select, [role='textbox']"))
      ) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) {
        handleNewTerminal();
      } else {
        void handleNewChat();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleNewChat, handleNewTerminal]);

  return (
    <div
      role="tablist"
      aria-label="Open tabs"
      className={cn(
        "flex h-10 shrink-0 items-stretch gap-0",
        "border-b border-sidebar-border bg-muted/30",
      )}
    >
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
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
          onClick={() => setSidebarCollapsed((v) => !v)}
          className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={
            sidebarCollapsed ? "Open right sidebar" : "Collapse right sidebar"
          }
          title={
            sidebarCollapsed ? "Open right sidebar" : "Collapse right sidebar"
          }
        >
          {sidebarCollapsed ? (
            <PanelRightOpen className="size-3.5" />
          ) : (
            <PanelRightClose className="size-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}
