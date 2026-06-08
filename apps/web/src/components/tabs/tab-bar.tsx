import { useCallback, useEffect } from "react";

import { useNewChat } from "@/hooks/use-new-chat";
import { focusSurface } from "@/lib/surface-focus";
import {
  useCloseActiveTab,
  useOpenTerminalTab,
  useSplitActivePane,
} from "@/lib/tabs-store";

type TabShortcutsProps = {
  projectId: string;
};

export function TabShortcuts({ projectId }: TabShortcutsProps) {
  const closeActiveTab = useCloseActiveTab();
  const openTerminal = useOpenTerminalTab();
  const splitActivePane = useSplitActivePane();
  const { newChat } = useNewChat();

  const handleNewChat = useCallback(async () => {
    const { id } = await newChat(projectId);
    focusSurface(id);
  }, [newChat, projectId]);

  const handleNewTerminal = useCallback(() => {
    const tabId = openTerminal(projectId);
    focusSurface(tabId);
  }, [openTerminal, projectId]);

  // ⌘T new chat, ⌘⇧T new terminal, ⌘W close active tab, ⌘D split right/down.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "t" && key !== "w" && key !== "d") return;
      if (key === "d") {
        event.preventDefault();
        splitActivePane(event.shiftKey ? "vertical" : "horizontal");
        return;
      }
      if (key === "w") {
        event.preventDefault();
        closeActiveTab();
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
  }, [closeActiveTab, handleNewChat, handleNewTerminal, splitActivePane]);

  return null;
}
