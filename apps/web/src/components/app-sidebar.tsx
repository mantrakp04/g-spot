import type { ComponentProps } from "react";
import { useState, useCallback, useEffect } from "react";

import { Badge } from "@g-spot/ui/components/badge";
import { Button } from "@g-spot/ui/components/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@g-spot/ui/components/collapsible";
import { ScrollArea } from "@g-spot/ui/components/scroll-area";
import { Separator } from "@g-spot/ui/components/separator";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import { cn } from "@g-spot/ui/lib/utils";
import type { OAuthConnection } from "@stackframe/react";
import { useUser } from "@stackframe/react";
import { Link, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  LogIn,
  Plus,
  GripVertical,
  Pencil,
  BotIcon,
  ChevronRight,
  Trash2,
  ChevronsLeft,
  BrainIcon,
  Cog,
  NotebookText,
  MailCheck,
} from "lucide-react";
import { useDrafts } from "@/contexts/drafts-context";
import { useSectionCounts } from "@/contexts/section-counts-context";
import {
  useDeleteChatMutation,
} from "@/hooks/use-chat-data";
import { usePreferredComposeGoogleAccount } from "@/hooks/use-preferred-compose-google-account";
import { useProjects } from "@/hooks/use-projects";
import { SidebarProjectItem } from "@/components/projects/sidebar-project-item";
import { DesktopUpdateButton } from "@/components/desktop-update-button";
import { useLastProjectId, useSetLastProjectId } from "@/lib/active-project";
import { signInWithExternalBrowser } from "@/lib/desktop-auth";
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
import { SidebarSetupChecklist } from "./sidebar-setup-checklist";
import { useChatRuntimeStatuses } from "@/lib/chat-runtime-statuses";

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

  if (!user) {
    return (
      <AppSidebarContent
        onToggleCollapse={onToggleCollapse}
        userSignedIn={false}
        accounts={undefined}
      />
    );
  }

  return <SignedInAppSidebar onToggleCollapse={onToggleCollapse} user={user} />;
}

function SignedInAppSidebar({
  onToggleCollapse,
  user,
}: AppSidebarProps & {
  user: { useConnectedAccounts: () => OAuthConnection[] | undefined };
}) {
  const accounts = user.useConnectedAccounts();

  return (
    <AppSidebarContent
      onToggleCollapse={onToggleCollapse}
      userSignedIn
      accounts={accounts}
    />
  );
}

function AppSidebarContent({
  onToggleCollapse,
  userSignedIn,
  accounts,
}: AppSidebarProps & {
  userSignedIn: boolean;
  accounts: OAuthConnection[] | undefined;
}) {
  const { data: sections, isLoading } = useSections();
  const [builderOpen, setBuilderOpen] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const reorderMutation = useReorderSectionsMutation();
  const { drafts, openDraft } = useDrafts();
  const { counts: sectionCounts } = useSectionCounts();
  const { preferredAccountId } = usePreferredComposeGoogleAccount(accounts);
  const accountsLoaded = accounts !== undefined;
  const githubConnected =
    accounts?.some((account) => account.provider === "github") ?? false;
  const gmailConnected =
    accounts?.some((account) => account.provider === "google") ?? false;

  const navigate = useNavigate();
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;
  const isOnChat = pathname.startsWith("/chat") || pathname.startsWith("/projects");
  const isChatSettings = pathname === "/chat/settings";
  const isGmailWorkflows = pathname === "/settings/gmail-workflows";
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
  const lastProjectId = useLastProjectId();
  const setLastProjectId = useSetLastProjectId();
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
  const runtimeStatuses = useChatRuntimeStatuses(activeChatId ?? null);

  useEffect(() => {
    if (isOnChat) {
      setChatListOpen(true);
    }
  }, [isOnChat]);

  const handleCompose = useCallback(() => {
    openDraft({
      mode: "new",
      accountId: preferredAccountId,
    });
  }, [openDraft, preferredAccountId]);

  const handleSignIn = useCallback(async () => {
    setSigningIn(true);
    try {
      await signInWithExternalBrowser();
      toast.success("Signed in");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSigningIn(false);
    }
  }, []);

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
        <Link
          to="/notes"
          className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-sidebar-accent"
        >
          <NotebookText className="size-3 shrink-0 text-muted-foreground" />
          <span>Notes</span>
        </Link>
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

        <Separator className="shrink-0" />

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
                <span>Agent</span>
              </CollapsibleTrigger>
              <Button
                variant="ghost"
                size="icon-xs"
                className={cn(
                  "size-6 shrink-0 text-muted-foreground hover:text-foreground",
                  pathname === "/settings/memory" && "bg-muted text-foreground",
                )}
                aria-label="Memory graph"
                nativeButton={false}
                render={<Link to="/settings/memory" />}
              >
                <BrainIcon className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className={cn(
                  "size-6 shrink-0 text-muted-foreground hover:text-foreground",
                  isChatSettings && "bg-muted text-foreground",
                )}
                aria-label="Agent settings"
                nativeButton={false}
                render={<Link to="/chat/settings" />}
              >
                <Cog className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className={cn(
                  "size-6 shrink-0 text-muted-foreground hover:text-foreground",
                  isGmailWorkflows && "bg-muted text-foreground",
                )}
                aria-label="Gmail workflows"
                nativeButton={false}
                render={<Link to="/settings/gmail-workflows" />}
              >
                <MailCheck className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="New project"
                nativeButton={false}
                render={<Link to="/projects/new" />}
              >
                <Plus className="size-3" />
              </Button>
            </div>

            <CollapsibleContent className="min-h-0 flex-1 pt-0.5">
              <div className="flex h-full min-h-0 flex-col gap-0.5 overflow-y-auto pr-0.5">
                {projectsQuery.isLoading && (
                  <>
                    <Skeleton className="h-7 rounded-md" />
                    <Skeleton className="h-7 rounded-md" />
                  </>
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

              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-2">
        <div>
          <SidebarSetupChecklist
            enabled={userSignedIn}
            accountsLoaded={accountsLoaded}
            githubConnected={githubConnected}
            gmailConnected={gmailConnected}
          />
        </div>
        <DesktopUpdateButton />
        <ThemePicker compact side="right" sideOffset={4} />
        {userSignedIn ? (
          <NavUser />
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
            disabled={signingIn}
            onClick={handleSignIn}
          >
            <LogIn className="size-4" />
            <span>{signingIn ? "Waiting for browser" : "Sign In"}</span>
          </Button>
        )}
      </div>

      {/* Section builder dialog */}
      <SectionBuilder open={builderOpen} onOpenChange={setBuilderOpen} />
    </div>
  );
}
