import { useState, useCallback, useEffect } from "react";

import { Badge } from "@g-spot/ui/components/badge";
import { Button } from "@g-spot/ui/components/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@g-spot/ui/components/collapsible";
import { ScrollArea } from "@g-spot/ui/components/scroll-area";
import { Separator } from "@g-spot/ui/components/separator";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import { cn } from "@g-spot/ui/lib/utils";
import { useUser } from "@stackframe/react";
import { Link, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { LogIn, Plus, GripVertical, Pencil, BotIcon, ChevronRight, Trash2 } from "lucide-react";
import { useDrafts } from "@/contexts/drafts-context";
import { useSectionCounts } from "@/contexts/section-counts-context";
import { ChatSidebarSettings } from "@/components/chat/chat-sidebar-settings";
import { useChats, useDeleteChatMutation } from "@/hooks/use-chat-data";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { Logo } from "./logo";
import { NavUser } from "./nav-user";
import { ThemePicker } from "./tweakcn-theme-picker";
import { SectionBuilder } from "./inbox/section-builder";
import { useReorderSectionsMutation, useSections } from "@/hooks/use-sections";

function SortableSectionItem({
  section,
  count,
}: {
  section: { id: string; name: string; showBadge: boolean };
  count: number | undefined;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id });

  const style = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
  };

  return (
    <a
      ref={setNodeRef}
      style={style}
      href={`#section-${section.id}`}
      className={cn(
        "group flex min-w-0 items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-sidebar-accent",
        isDragging && "z-50 opacity-50",
      )}
      {...attributes}
    >
      <button
        type="button"
        className="shrink-0 cursor-grab touch-none text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
        {...listeners}
        onClick={(e) => e.preventDefault()}
      >
        <GripVertical className="size-3" />
      </button>
      <div className="min-w-0 flex-1">
        <span className="block w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          {section.name}
        </span>
      </div>
      {section.showBadge && count !== undefined && (
        <Badge
          variant="secondary"
          className="h-4 min-w-[1.25rem] shrink-0 px-1 text-[10px] tabular-nums"
        >
          {count}
        </Badge>
      )}
    </a>
  );
}

export function AppSidebar() {
  const user = useUser();
  const { data: sections, isLoading } = useSections();
  const [builderOpen, setBuilderOpen] = useState(false);
  const reorderMutation = useReorderSectionsMutation();
  const { drafts, openDraft } = useDrafts();
  const { counts: sectionCounts } = useSectionCounts();
  const accounts = user?.useConnectedAccounts();

  const {
    data: chatsData,
    isLoading: chatsLoading,
    hasNextPage: hasMoreChats,
    fetchNextPage: fetchMoreChats,
    isFetchingNextPage: isFetchingMoreChats,
  } = useChats();
  const deleteChat = useDeleteChatMutation();
  const navigate = useNavigate();
  const routerState = useRouterState();
  const isOnChat = routerState.location.pathname.startsWith("/chat");
  const [chatListOpen, setChatListOpen] = useState(isOnChat);
  const [chatScrollContainer, setChatScrollContainer] = useState<HTMLDivElement | null>(null);
  const params = useParams({ strict: false }) as { chatId?: string };
  const activeChatId = params.chatId;
  const chats = chatsData?.pages.flatMap((page) => page.chats) ?? [];
  const chatSentinelRef = useInfiniteScroll({
    hasNextPage: hasMoreChats ?? false,
    isFetchingNextPage: isFetchingMoreChats,
    fetchNextPage: () => void fetchMoreChats(),
    root: chatScrollContainer,
  });

  useEffect(() => {
    if (isOnChat) {
      setChatListOpen(true);
    }
  }, [isOnChat]);

  const handleCompose = useCallback(() => {
    const googleAccount = accounts?.find((a) => a.provider === "google");
    openDraft({
      mode: "new",
      accountId: googleAccount?.providerAccountId ?? null,
    });
  }, [accounts, openDraft]);

  const handleNewChat = useCallback(() => {
    navigate({ to: "/chat" });
  }, [navigate]);

  const handleDeleteChat = useCallback(
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !sections) return;

      const oldIndex = sections.findIndex((s) => s.id === active.id);
      const newIndex = sections.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(sections, oldIndex, newIndex);

      reorderMutation.mutate({
        orderedIds: reordered.map((section) => section.id),
        nextSections: reordered,
      });
    },
    [sections, reorderMutation],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      {/* Header */}
      <div className="border-b border-sidebar-border p-2">
        <Link
          to="/"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold tracking-tight text-sidebar-foreground hover:bg-sidebar-accent"
        >
          <Logo className="size-5" />
          <span>g-spot</span>
        </Link>
      </div>

      {/* Compose button */}
      <div className="border-b border-sidebar-border p-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={handleCompose}
        >
          <Pencil className="size-3.5" />
          <span>Compose</span>
          {drafts.length > 0 && (
            <Badge
              variant="secondary"
              className="ml-auto h-4 min-w-[1.25rem] px-1 text-[10px] tabular-nums"
            >
              {drafts.length}
            </Badge>
          )}
        </Button>
      </div>

      {/* Section list + Chat list */}
      <div className="flex min-h-0 flex-1 flex-col">
        <ScrollArea className="shrink-0">
          <nav className="flex flex-col gap-0.5 p-2">
            {isLoading && (
              <>
                <Skeleton className="h-7 w-full rounded-md" />
                <Skeleton className="h-7 w-full rounded-md" />
                <Skeleton className="h-7 w-full rounded-md" />
              </>
            )}

            {sections && sections.length > 0 && (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={sections.map((s) => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {sections.map((section) => (
                    <SortableSectionItem key={section.id} section={section} count={sectionCounts[section.id]} />
                  ))}
                </SortableContext>
              </DndContext>
            )}

            {!isLoading && (
              <>
                {sections && sections.length > 0 && (
                  <Separator className="my-1" />
                )}
                <Button
                  variant="ghost"
                  size="xs"
                  className="justify-start gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setBuilderOpen(true)}
                >
                  <Plus className="size-3" />
                  Add section
                </Button>
              </>
            )}
          </nav>
        </ScrollArea>

        <Separator className="mx-2 shrink-0" />

        {/* Collapsible chat list */}
        <div className={cn("p-2", chatListOpen && "min-h-0 flex-1")}>
          <Collapsible
            open={chatListOpen}
            onOpenChange={setChatListOpen}
            className={cn("flex flex-col", chatListOpen && "h-full min-h-0")}
          >
            <div className="flex items-center gap-1">
              <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground">
                <ChevronRight className="size-3 shrink-0 transition-transform group-data-[panel-open]:rotate-90" />
                <BotIcon className="size-3 shrink-0" />
                <span>AI Chat</span>
              </CollapsibleTrigger>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={handleNewChat}
              >
                <Plus className="size-3" />
              </Button>
              <ChatSidebarSettings />
            </div>

            <CollapsibleContent className="min-h-0 flex-1 pt-0.5">
              <div
                ref={setChatScrollContainer}
                className="flex h-full min-h-0 flex-col gap-0.5 overflow-y-auto"
              >
                {chatsLoading &&
                  Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={`chat-skel-${i}`} className="h-7 w-full rounded-md" />
                  ))}

                {chats.map((chat) => (
                  <Link
                    key={chat.id}
                    to="/chat/$chatId"
                    params={{ chatId: chat.id }}
                    className={cn(
                      "group flex min-w-0 items-center gap-1 rounded-md px-2 py-1.5 pl-7 text-xs transition-colors hover:bg-sidebar-accent",
                      activeChatId === chat.id && "bg-sidebar-accent",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                    <button
                      type="button"
                      className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      onClick={(e) => handleDeleteChat(e, chat.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </Link>
                ))}

                {!chatsLoading && chats.length === 0 && (
                  <p className="px-2 py-2 text-center text-xs text-muted-foreground">
                    No chats yet
                  </p>
                )}

                {hasMoreChats && <div ref={chatSentinelRef} className="h-1 shrink-0" />}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-2">
        <ThemePicker compact side="right" sideOffset={4} />
        {user ? (
          <NavUser />
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
            render={<a href="/handler/sign-in" />}
          >
            <LogIn className="size-4" />
            <span>Sign In</span>
          </Button>
        )}
      </div>

      {/* Section builder dialog */}
      <SectionBuilder open={builderOpen} onOpenChange={setBuilderOpen} />
    </div>
  );
}
