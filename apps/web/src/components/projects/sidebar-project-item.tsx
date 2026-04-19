import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@g-spot/ui/components/collapsible";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import { cn } from "@g-spot/ui/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronRight,
  FolderIcon,
  Plus,
  SettingsIcon,
  Trash2,
} from "lucide-react";
import { useCallback } from "react";

import {
  ChatStatusDot,
  type ChatRuntimeDotStatus,
} from "@/components/chat/chat-status-dot";
import { useChats } from "@/hooks/use-chat-data";

interface SidebarProjectItemProps {
  project: {
    id: string;
    name: string;
  };
  isActiveProject: boolean;
  activeChatId: string | undefined;
  isOpen: boolean;
  onToggle: (open: boolean) => void;
  onDeleteChat: (event: React.MouseEvent, chatId: string) => void;
  /**
   * `chatId → status` for every chat with an active runtime. Each chat row
   * looks itself up; the project header doesn't render a dot — only chats
   * do.
   */
  runtimeStatuses: Record<string, ChatRuntimeDotStatus>;
}

/**
 * One project row in the sidebar's AI Chat list. Renders the project header
 * (chevron, folder icon, name, hover-revealed actions) plus, when expanded,
 * the project's own chat list. Chats are only fetched while the project is
 * expanded — `useChats(null)` is a no-op when collapsed.
 */
export function SidebarProjectItem({
  project,
  isActiveProject,
  activeChatId,
  isOpen,
  onToggle,
  onDeleteChat,
  runtimeStatuses,
}: SidebarProjectItemProps) {
  const navigate = useNavigate();

  const {
    data: chatsData,
    isLoading: chatsLoading,
  } = useChats(isOpen ? project.id : null);

  const chats = chatsData?.pages.flatMap((page) => page.chats) ?? [];

  const handleNewChatHere = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      void navigate({
        to: "/projects/$projectId",
        params: { projectId: project.id },
      });
    },
    [navigate, project.id],
  );

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle}>
      <div
        className={cn(
          "group/project flex items-center gap-0.5 rounded-md transition-colors",
          isActiveProject && "bg-sidebar-accent/40",
        )}
      >
        <CollapsibleTrigger
          className={cn(
            "group/trigger flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-sidebar-accent",
            isActiveProject && "font-medium",
          )}
        >
          <ChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/trigger:rotate-90" />
          <FolderIcon className="size-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-left">
            {project.name}
          </span>
        </CollapsibleTrigger>
        <button
          type="button"
          onClick={handleNewChatHere}
          className="size-6 shrink-0 rounded-md text-muted-foreground opacity-0 transition-all hover:bg-sidebar-accent hover:text-foreground group-hover/project:opacity-100 focus-visible:opacity-100"
          aria-label={`New chat in ${project.name}`}
          title="New chat in this project"
        >
          <Plus className="mx-auto size-3" />
        </button>
        <Link
          to="/projects/$projectId/settings"
          params={{ projectId: project.id }}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-sidebar-accent hover:text-foreground group-hover/project:opacity-100 focus-visible:opacity-100"
          aria-label={`${project.name} settings`}
          title="Project settings"
        >
          <SettingsIcon className="size-3" />
        </Link>
      </div>

      <CollapsibleContent>
        {chatsLoading && (
          <>
            <Skeleton className="h-7 rounded-md" />
            <Skeleton className="h-7 w-4/5 rounded-md" />
          </>
        )}

        {!chatsLoading && chats.length === 0 && (
          <p className="px-2 py-1.5 text-[11px] text-muted-foreground/70">
            No chats yet
          </p>
        )}

        {chats.map((chat) => {
          const rawChatStatus = runtimeStatuses[chat.id] ?? null;
          const chatStatus =
            activeChatId === chat.id && rawChatStatus === "finished-unread"
              ? null
              : rawChatStatus;
          return (
            <Link
              key={chat.id}
              to="/projects/$projectId/chat/$chatId"
              params={{ projectId: project.id, chatId: chat.id }}
              className={cn(
                "group/chat flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-sidebar-accent",
                activeChatId === chat.id && "bg-sidebar-accent",
              )}
            >
              <ChatStatusDot status={chatStatus} />
              <span className="min-w-0 flex-1 truncate">{chat.title}</span>
              <button
                type="button"
                className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/chat:opacity-100"
                onClick={(e) => onDeleteChat(e, chat.id)}
                aria-label="Delete chat"
              >
                <Trash2 className="size-3.5" />
              </button>
            </Link>
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}
