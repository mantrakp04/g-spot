import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useResizableLayout,
} from "@g-spot/ui/components/resizable";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useState } from "react";

import { FileSearchDialog } from "@/components/file-search/file-search-dialog";
import { RightSidebar } from "@/components/right-sidebar/right-sidebar";
import { TabBar } from "@/components/tabs/tab-bar";
import { useProject } from "@/hooks/use-projects";
import { useSetLastProjectId } from "@/lib/active-project";
import {
  rightSidebarCollapsedAtom,
  sidebarsSwappedAtom,
} from "@/lib/sidebars-store";

const RIGHT_PANEL_ID = "right-sidebar";
const RIGHT_MAIN_PANEL_ID = "right-main";

const browserStorage =
  typeof window !== "undefined" ? window.localStorage : undefined;

export const Route = createFileRoute("/projects/$projectId")({
  component: ProjectLayout,
});

function ProjectLayout() {
  const { projectId } = Route.useParams();
  const projectQuery = useProject(projectId);
  const setLastProjectId = useSetLastProjectId();
  const collapsed = useAtomValue(rightSidebarCollapsedAtom);
  const swapped = useAtomValue(sidebarsSwappedAtom);
  const [searchOpen, setSearchOpen] = useState(false);

  const { defaultLayout, onLayoutChanged } = useResizableLayout({
    id: "gspot.shell.right",
    panelIds: [RIGHT_PANEL_ID, RIGHT_MAIN_PANEL_ID],
    storage: browserStorage,
  });

  useEffect(() => {
    if (projectQuery.data) {
      setLastProjectId(projectQuery.data.id);
    }
  }, [projectQuery.data, setLastProjectId]);

  const openSearch = useCallback(() => setSearchOpen(true), []);

  // ⌘P / Ctrl+P → fuzzy file search.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "p") return;
      event.preventDefault();
      setSearchOpen(true);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (projectQuery.isLoading) {
    return (
      <div className="container mx-auto max-w-3xl space-y-4 px-4 py-12">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  if (!projectQuery.data) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <p className="text-muted-foreground text-sm">Project not found.</p>
      </div>
    );
  }

  const rightPanel = (
    <ResizablePanel
      id={RIGHT_PANEL_ID}
      defaultSize="30"
      minSize="18"
      maxSize="60"
      className="min-w-[260px]"
    >
      <RightSidebar projectId={projectId} onOpenSearch={openSearch} />
    </ResizablePanel>
  );

  const mainPanel = (
    <ResizablePanel
      id={RIGHT_MAIN_PANEL_ID}
      defaultSize={collapsed ? "100" : "70"}
      minSize="40"
    >
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        <TabBar projectId={projectId} />
        <Outlet />
      </div>
    </ResizablePanel>
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ResizablePanelGroup
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        className="min-h-0 min-w-0 flex-1"
      >
        {!collapsed && swapped && (
          <>
            {rightPanel}
            <ResizableHandle />
          </>
        )}
        {mainPanel}
        {!collapsed && !swapped && (
          <>
            <ResizableHandle />
            {rightPanel}
          </>
        )}
      </ResizablePanelGroup>
      <FileSearchDialog
        projectId={projectId}
        open={searchOpen}
        onOpenChange={setSearchOpen}
      />
    </div>
  );
}
