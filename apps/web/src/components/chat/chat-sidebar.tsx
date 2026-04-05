import { Button } from "@g-spot/ui/components/button";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import { cn } from "@g-spot/ui/lib/utils";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { MessageSquarePlus, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";

import { useChats, useDeleteChatMutation } from "@/hooks/use-chat-data";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";

export function ChatSidebar() {
  const {
    data,
    isLoading,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useChats();
  const deleteChat = useDeleteChatMutation();
  const navigate = useNavigate();
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
  const params = useParams({ strict: false }) as { chatId?: string };
  const activeChatId = params.chatId;
  const chats = data?.pages.flatMap((page) => page.chats) ?? [];
  const sentinelRef = useInfiniteScroll({
    hasNextPage: hasNextPage ?? false,
    isFetchingNextPage,
    fetchNextPage: () => void fetchNextPage(),
    root: scrollContainer,
  });

  const handleNewChat = useCallback(() => {
    navigate({ to: "/chat" });
  }, [navigate]);

  const handleDelete = useCallback(
    (e: React.MouseEvent, chatId: string) => {
      e.preventDefault();
      e.stopPropagation();
      deleteChat.mutate(chatId);
      if (activeChatId === chatId) {
        navigate({ to: "/chat" });
      }
    },
    [activeChatId, deleteChat, navigate],
  );

  return (
    <div className="flex h-full min-h-0 w-64 flex-col border-r bg-sidebar">
      <div className="border-b p-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={handleNewChat}
        >
          <MessageSquarePlus className="size-4" />
          <span>New Chat</span>
        </Button>
      </div>

      <div
        ref={setScrollContainer}
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2"
      >
          {isLoading &&
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={`skel-${i}`} className="h-8 w-full rounded-md" />
            ))}

          {chats.map((chat) => (
            <Link
              key={chat.id}
              to="/chat/$chatId"
              params={{ chatId: chat.id }}
              className={cn(
                "group flex min-w-0 items-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-sidebar-accent",
                activeChatId === chat.id && "bg-sidebar-accent",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{chat.title}</span>
              <button
                type="button"
                className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                onClick={(e) => handleDelete(e, chat.id)}
              >
                <Trash2 className="size-3.5" />
              </button>
            </Link>
          ))}

          {!isLoading && chats.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              No chats yet
            </p>
          )}

          {hasNextPage && <div ref={sentinelRef} className="h-1 shrink-0" />}
      </div>
    </div>
  );
}
