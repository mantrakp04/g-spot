import type { ComponentProps } from "react";
import { useState, useCallback, useEffect } from "react";

import { Badge } from "@g-spot/ui/components/badge";
import { Button, buttonVariants } from "@g-spot/ui/components/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@g-spot/ui/components/collapsible";
import { ScrollArea } from "@g-spot/ui/components/scroll-area";
import { Separator } from "@g-spot/ui/components/separator";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import { cn } from "@g-spot/ui/lib/utils";
import { useUser } from "@stackframe/react";
import { Link, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import {
  LogIn,
  Plus,
  GripVertical,
  Pencil,
  BotIcon,
  ChevronRight,
  Trash2,
  SlidersHorizontal,
  ChevronsLeft,
  SparklesIcon,
  FolderIcon,
  BrainIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@g-spot/ui/components/dropdown-menu";
import { useDrafts } from "@/contexts/drafts-context";
import { useSectionCounts } from "@/contexts/section-counts-context";
import {
  useChatRuntimeStatuses,
  useDeleteChatMutation,
} from "@/hooks/use-chat-data";
import { useProjects } from "@/hooks/use-projects";
import { SidebarProjectItem } from "@/components/projects/sidebar-project-item";
import { getLastProjectId, setLastProjectId } from "@/lib/active-project";
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

type AppSidebarProps = {
  onToggleCollapse?: ComponentProps<typeof Button>["onClick"];
};

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
    <Link
      ref={setNodeRef}
      style={style}
      to="/"
      hash={`section-${section.id}`}
      className={cn(
        "group flex min-w-0 touch-none items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-sidebar-accent active:cursor-grabbing",
        isDragging && "z-50 opacity-50",
      )}
      {...attributes}
      {...listeners}
    >
      <GripVertical
        aria-hidden
        className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
      />
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
    </Link>
  );
}

export function AppSidebar({ onToggleCollapse }: AppSidebarProps) {
  const user = useUser();
  const { data: sections, isLoading } = useSections();
  const [builderOpen, setBuilderOpen] = useState(false);
  const reorderMutation = useReorderSectionsMutation();
  const { drafts, openDraft } = useDrafts();
  const { counts: sectionCounts } = useSectionCounts();
  const accounts = user?.useConnectedAccounts();

  const navigate = useNavigate();
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;
  const isOnChat = pathname.startsWith("/chat") || pathname.startsWith("/projects");
  const isChatSettings = pathname === "/chat/settings";
  const [chatListOpen, setChatListOpen] = useState(isOnChat);
  const params = useParams({ strict: false }) as {
    chatId?: string;
    projectId?: string;
  };
  const activeChatId = params.chatId;

  // Active project: URL is the source of truth, fall back to last-used,
  // then to the first project the user has. Used to highlight + auto-expand
  // the matching project row.
  const projectsQuery = useProjects();
  const projects = projectsQuery.data ?? [];
  const lastProjectId =
    typeof window !== "undefined" ? getLastProjectId() : null;
  const activeProjectId =
    params.projectId ??
    (lastProjectId && projects.find((p) => p.id === lastProjectId)?.id) ??
    projects[0]?.id ??
    null;

  useEffect(() => {
    if (params.projectId) {
      setLastProjectId(params.projectId);
    }
  }, [params.projectId]);

  // Track which project rows are expanded. The active project is added to the
  // set automatically whenever it changes; user toggles are preserved.
  const [openProjectIds, setOpenProjectIds] = useState<Set<string>>(
    () => new Set(activeProjectId ? [activeProjectId] : []),
  );

  useEffect(() => {
    if (!activeProjectId) return;
    setOpenProjectIds((prev) => {
      if (prev.has(activeProjectId)) return prev;
      const next = new Set(prev);
      next.add(activeProjectId);
      return next;
    });
  }, [activeProjectId]);

  const handleToggleProject = useCallback((projectId: string, open: boolean) => {
    setOpenProjectIds((prev) => {
      const next = new Set(prev);
      if (open) next.add(projectId);
      else next.delete(projectId);
      return next;
    });
  }, []);

  const deleteChat = useDeleteChatMutation();
  const runtimeStatusesQuery = useChatRuntimeStatuses();
  const runtimeStatuses = runtimeStatusesQuery.data ?? {};

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

  const handleDeleteChat = useCallback(
    (e: React.MouseEvent, chatId: string) => {
      e.preventDefault();
      e.stopPropagation();
      deleteChat.mutate(chatId);
      if (activeChatId === chatId && activeProjectId) {
        navigate({
          to: "/projects/$projectId",
          params: { projectId: activeProjectId },
        });
      }
    },
    [activeChatId, activeProjectId, deleteChat, navigate],
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
        <div className="flex items-center gap-2">
          <Link
            to="/"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold tracking-tight text-sidebar-foreground hover:bg-sidebar-accent"
          >
            <Logo className="size-5 shrink-0" />
            <span className="truncate">g-spot</span>
          </Link>
          {onToggleCollapse && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={onToggleCollapse}
              aria-label="Collapse sidebar"
            >
              <ChevronsLeft className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Compose button */}
      <div className="flex flex-col border-b border-sidebar-border p-2">
        <button
          type="button"
          onClick={handleCompose}
          className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-sidebar-accent"
        >
          <Pencil className="size-3 shrink-0 text-muted-foreground" />
          <span>Compose</span>
          {drafts.length > 0 && (
            <Badge
              variant="secondary"
              className="ml-auto h-4 min-w-[1.25rem] px-1 text-[10px] tabular-nums"
            >
              {drafts.length}
            </Badge>
          )}
        </button>
      </div>

      {/* Section list + Chat list */}
      <div className="flex min-h-0 flex-1 flex-col">
        <ScrollArea className="shrink-0">
          <nav className="flex flex-col gap-0.5 p-2">
            {isLoading && (
              <>
                <Skeleton className="h-7 rounded-md" />
                <Skeleton className="h-7 rounded-md" />
                <Skeleton className="h-7 rounded-md" />
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
                <button
                  type="button"
                  onClick={() => setBuilderOpen(true)}
                  className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                >
                  <Plus className="size-3 shrink-0" />
                  <span>Add section</span>
                </button>
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
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "icon-xs" }),
                    "size-6 shrink-0 text-muted-foreground hover:text-foreground",
                    isChatSettings && "bg-sidebar-accent text-sidebar-foreground",
                  )}
                  aria-label="AI Chat settings menu"
                >
                  <SlidersHorizontal className="size-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Pi agent</DropdownMenuLabel>
                    <DropdownMenuItem render={<Link to="/chat/settings" />}>
                      <SlidersHorizontal className="size-3.5" />
                      Pi defaults
                    </DropdownMenuItem>
                    <DropdownMenuItem render={<Link to="/settings/skills" />}>
                      <SparklesIcon className="size-3.5" />
                      Global skills
                    </DropdownMenuItem>
                    <DropdownMenuItem render={<Link to="/settings/memory" />}>
                      <BrainIcon className="size-3.5" />
                      Memory graph
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Projects</DropdownMenuLabel>
                    <DropdownMenuItem render={<Link to="/projects" />}>
                      <FolderIcon className="size-3.5" />
                      All projects
                    </DropdownMenuItem>
                    <DropdownMenuItem render={<Link to="/projects/new" />}>
                      <Plus className="size-3.5" />
                      New project
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <CollapsibleContent className="min-h-0 flex-1 pt-0.5">
              <div className="flex h-full min-h-0 flex-col gap-0.5 overflow-y-auto pr-0.5">
                {projectsQuery.isLoading && (
                  <>
                    <Skeleton className="h-7 rounded-md" />
                    <Skeleton className="h-7 rounded-md" />
                  </>
                )}

                {!projectsQuery.isLoading && projects.length === 0 && (
                  <Link
                    to="/projects/new"
                    className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                  >
                    <Plus className="size-3 shrink-0" />
                    <span>Create a project to start chatting</span>
                  </Link>
                )}

                {projects.map((project) => (
                  <SidebarProjectItem
                    key={project.id}
                    project={project}
                    isActiveProject={project.id === activeProjectId}
                    activeChatId={activeChatId}
                    isOpen={openProjectIds.has(project.id)}
                    onToggle={(open) => handleToggleProject(project.id, open)}
                    onDeleteChat={handleDeleteChat}
                    runtimeStatuses={runtimeStatuses}
                  />
                ))}

                {!projectsQuery.isLoading && projects.length > 0 && (
                  <Link
                    to="/projects/new"
                    className="mt-1 flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                  >
                    <Plus className="size-3 shrink-0" />
                    <span>New project</span>
                  </Link>
                )}
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
