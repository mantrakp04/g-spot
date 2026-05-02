import { useCallback, useEffect, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@g-spot/ui/components/button";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import { cn } from "@g-spot/ui/lib/utils";
import { Link, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { Cog, Plus } from "lucide-react";

import { SidebarProjectItem } from "@/components/projects/sidebar-project-item";
import { SecondarySidebar } from "@/components/shell/secondary-sidebar";
import {
  subscribeChatRuntimeFinished,
  useChatRuntimeStatuses,
} from "@/lib/chat-runtime-statuses";
import { useDeleteChatMutation } from "@/hooks/use-chat-data";
import { useProjects } from "@/hooks/use-projects";
import { useLastProjectId, useSetLastProjectId } from "@/lib/active-project";
import { chatKeys } from "@/lib/query-keys";

export function AiSidebar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isChatSettings = pathname === "/chat/settings";

  const params = useParams({ strict: false }) as {
    chatId?: string;
    projectId?: string;
  };
  const activeChatId = params.chatId;

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
    if (params.projectId) setLastProjectId(params.projectId);
  }, [params.projectId, setLastProjectId]);

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

  useEffect(
    () =>
      subscribeChatRuntimeFinished((chatId) => {
        void queryClient.invalidateQueries({
          queryKey: chatKeys.messages(chatId),
        });
        void queryClient.invalidateQueries({
          queryKey: chatKeys.detail(chatId),
        });
        void queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      }),
    [queryClient],
  );

  const handleDeleteChat = useCallback(
    (e: React.MouseEvent, chatId: string) => {
      e.preventDefault();
      e.stopPropagation();
      deleteChat.mutate(chatId);
      if (activeChatId === chatId && activeProjectId) {
        navigate({ to: "/projects/$projectId", params: { projectId: activeProjectId } });
      }
    },
    [activeChatId, activeProjectId, deleteChat, navigate],
  );

  return (
    <SecondarySidebar
      title={<span>AI</span>}
      headerAction={
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn(
              "text-muted-foreground hover:text-foreground",
              isChatSettings && "bg-muted text-foreground",
            )}
            aria-label="Agent settings"
            nativeButton={false}
            render={<Link to="/chat/settings" />}
          >
            <Cog className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            aria-label="New project"
            nativeButton={false}
            render={<Link to="/projects/new" />}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
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

        {!projectsQuery.isLoading && projects.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            No projects yet
          </p>
        )}
      </div>
    </SecondarySidebar>
  );
}
