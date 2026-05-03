import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { useCreateChatMutation } from "@/hooks/use-chat-data";
import { useOpenChatTab } from "@/lib/tabs-store";

/**
 * Single entry point for "create a new chat in a project". Used by the tab-bar
 * `+`, the sidebar's per-project `+`, and any in-chat "New Chat" affordance —
 * so all three flow through the same mutation, tab open, and URL navigation.
 */
export function useNewChat() {
  const createChat = useCreateChatMutation();
  const openChat = useOpenChatTab();
  const navigate = useNavigate();

  const newChat = useCallback(
    async (projectId: string) => {
      const chat = await createChat.mutateAsync({ projectId });
      openChat(projectId, chat.id, "New Chat");
      await navigate({
        to: "/projects/$projectId/chat/$chatId",
        params: { projectId, chatId: chat.id },
      });
      return chat;
    },
    [createChat, openChat, navigate],
  );

  return { newChat, isPending: createChat.isPending };
}
