import { createFileRoute } from "@tanstack/react-router";

import { ChatView } from "@/components/chat/chat-view";

type ProjectChatSearch = {
  messageId?: string;
  q?: string;
};

export const Route = createFileRoute("/projects/$projectId/chat/$chatId")({
  validateSearch: (search: Record<string, unknown>): ProjectChatSearch => ({
    messageId: typeof search.messageId === "string" ? search.messageId : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  component: ProjectChatPage,
});

function ProjectChatPage() {
  const { projectId, chatId } = Route.useParams();
  const search = Route.useSearch();
  return <ChatView projectId={projectId} chatId={chatId} focusMessageId={search.messageId} searchText={search.q} />;
}
