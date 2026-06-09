import { useCallback } from "react";

import { useNewChat } from "@/hooks/use-new-chat";
import { useKeybinds } from "@/lib/keybinds";
import { focusSurface } from "@/lib/surface-focus";
import {
  useCloseActiveTab,
  useOpenTerminalTab,
  useReopenClosedTab,
  useSplitActivePane,
} from "@/lib/tabs-store";

type TabShortcutsProps = {
  projectId: string;
};

export function TabShortcuts({ projectId }: TabShortcutsProps) {
  const closeActiveTab = useCloseActiveTab();
  const openTerminal = useOpenTerminalTab();
  const splitActivePane = useSplitActivePane();
  const reopenClosedTab = useReopenClosedTab();
  const { newChat } = useNewChat();

  const handleNewChat = useCallback(async () => {
    const { id } = await newChat(projectId);
    focusSurface(id);
  }, [newChat, projectId]);

  const handleNewTerminal = useCallback(() => {
    const tabId = openTerminal(projectId);
    focusSurface(tabId);
  }, [openTerminal, projectId]);

  // Don't fire layout shortcuts underneath an open palette / dialog — they
  // would close tabs or split panes behind the modal the user is using.
  const unlessOverlay = useCallback(
    (action: () => void) => () => {
      if (hasOpenOverlay()) return;
      action();
    },
    [],
  );

  useKeybinds([
    { id: "tabs.newChat", callback: unlessOverlay(() => void handleNewChat()) },
    { id: "tabs.newTerminal", callback: unlessOverlay(handleNewTerminal) },
    { id: "tabs.reopenClosed", callback: unlessOverlay(reopenClosedTab) },
    { id: "tabs.close", callback: unlessOverlay(closeActiveTab) },
    {
      id: "tabs.splitHorizontal",
      callback: unlessOverlay(() => splitActivePane("horizontal")),
    },
    {
      id: "tabs.splitVertical",
      callback: unlessOverlay(() => splitActivePane("vertical")),
    },
  ]);

  return null;
}

/** True when a modal dialog/palette is open in the document. */
export function hasOpenOverlay() {
  if (typeof document === "undefined") return false;
  return (
    document.querySelector(
      '[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"]',
    ) !== null
  );
}
