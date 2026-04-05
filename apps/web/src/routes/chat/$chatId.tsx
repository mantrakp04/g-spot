import { createFileRoute } from "@tanstack/react-router";

import { ChatView } from "@/components/chat/chat-view";

export const Route = createFileRoute("/chat/$chatId")({
  component: ChatIdPage,
});

function ChatIdPage() {
  const { chatId } = Route.useParams();
  return <ChatView chatId={chatId} />;
}
