import { createFileRoute } from "@tanstack/react-router";

import { ChatSettingsPage } from "@/components/chat/chat-settings-page";

export const Route = createFileRoute("/chat/settings")({
  component: ChatSettingsRoute,
});

function ChatSettingsRoute() {
  return <ChatSettingsPage />;
}
