import { createFileRoute } from "@tanstack/react-router";
import { ChatView } from "@/components/chat/chat-view";

export const Route = createFileRoute("/chat/")({
  component: ChatIndexPage,
});

function ChatIndexPage() {
  return <ChatView />;
}
