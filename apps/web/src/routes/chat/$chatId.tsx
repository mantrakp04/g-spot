import { Skeleton } from "@g-spot/ui/components/skeleton";
import { createFileRoute, Navigate } from "@tanstack/react-router";

import { useChatDetail } from "@/hooks/use-chat-data";

/**
 * Legacy `/chat/$chatId` URL — looks up the chat to find its project, then
 * permanently redirects to `/projects/$projectId/chat/$chatId`.
 */
export const Route = createFileRoute("/chat/$chatId")({
  component: LegacyChatIdRedirect,
});

function LegacyChatIdRedirect() {
  const { chatId } = Route.useParams();
  const { data, isLoading } = useChatDetail(chatId);

  if (isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
        <div className="flex w-full max-w-2xl flex-col gap-4">
          <Skeleton className="h-12 w-3/5 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!data) {
    return <Navigate to="/projects" replace />;
  }

  return (
    <Navigate
      to="/projects/$projectId/chat/$chatId"
      params={{ projectId: data.projectId, chatId }}
      replace
    />
  );
}
