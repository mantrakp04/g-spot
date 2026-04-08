import { createFileRoute } from "@tanstack/react-router";

import { ChatView } from "@/components/chat/chat-view";

export const Route = createFileRoute("/projects/$projectId/chat/$chatId")({
  component: ProjectChatPage,
});

function ProjectChatPage() {
  const { projectId, chatId } = Route.useParams();
  return <ChatView projectId={projectId} chatId={chatId} />;
}
