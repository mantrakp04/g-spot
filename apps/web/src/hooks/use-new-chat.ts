import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { useOpenDraftChatTab } from "@/lib/tabs-store";

/**
 * Single entry point for "open a new draft chat in a project". The DB chat is
 * created only when the draft sends its first message.
 */
export function useNewChat() {
  const openDraftChat = useOpenDraftChatTab();
  const navigate = useNavigate();

  const newChat = useCallback(
    async (projectId: string, options?: { paneId?: string }) => {
      const tabId = openDraftChat(projectId, "New Chat", {
        paneId: options?.paneId,
      });
      await navigate({
        to: "/agent/$projectId",
        params: { projectId },
      });
      return { id: tabId };
    },
    [navigate, openDraftChat],
  );

  return { newChat, isPending: false };
}
