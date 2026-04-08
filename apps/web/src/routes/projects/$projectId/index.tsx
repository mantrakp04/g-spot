import { createFileRoute } from "@tanstack/react-router";

import { ChatView } from "@/components/chat/chat-view";

export const Route = createFileRoute("/projects/$projectId/")({
  component: ProjectIndexPage,
});

function ProjectIndexPage() {
  const { projectId } = Route.useParams();
  return <ChatView projectId={projectId} />;
}
