import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import { useChatDetail } from "@/hooks/use-chat-data";
import { useOpenChatTab } from "@/lib/tabs-store";

type ProjectChatSearch = {
  messageId?: string;
  q?: string;
};

export const Route = createFileRoute("/projects/$projectId/_tabs/chat/$chatId")({
  validateSearch: (search: Record<string, unknown>): ProjectChatSearch => ({
    messageId: typeof search.messageId === "string" ? search.messageId : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  component: ProjectChatPage,
});

/**
 * Visible chat content lives in the parent `_tabs` layout's TabsContent —
 * this leaf only syncs the URL into the tab store: visiting `/chat/$chatId`
 * opens (or focuses) the matching tab, threading deep-link search params
 * through onto the tab.
 */
function ProjectChatPage() {
  const { projectId, chatId } = Route.useParams();
  const search = Route.useSearch();
  const openChat = useOpenChatTab();
  const detail = useChatDetail(chatId);
  const title = detail.data?.title || "Untitled";

  useEffect(() => {
    openChat(projectId, chatId, title, {
      focusMessageId: search.messageId,
      searchText: search.q,
    });
  }, [openChat, projectId, chatId, title, search.messageId, search.q]);

  return null;
}
