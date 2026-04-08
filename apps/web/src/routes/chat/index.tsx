import { createFileRoute, Navigate } from "@tanstack/react-router";

/**
 * Legacy `/chat` route — kept for one release as a redirect to `/projects`,
 * which is now the canonical entry point for chats.
 */
export const Route = createFileRoute("/chat/")({
  component: LegacyChatIndexRedirect,
});

function LegacyChatIndexRedirect() {
  return <Navigate to="/projects" replace />;
}
