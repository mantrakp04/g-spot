import { createFileRoute, Outlet } from "@tanstack/react-router";

import { TabsContent } from "@/components/tabs/tabs-content";

/**
 * Pathless layout shared by the project index and chat leaf routes. Renders
 * the persistent TabsContent surface so navigating between `/projects/$id/`
 * and `/projects/$id/chat/$chatId` doesn't unmount the open tabs (preserving
 * scroll position, draft input, and PTY state). The leaf routes only sync
 * their URL params into the tab store via the hidden Outlet.
 */
export const Route = createFileRoute("/projects/$projectId/_tabs")({
  component: TabsLayout,
});

function TabsLayout() {
  return (
    <>
      <TabsContent />
      <div className="hidden">
        <Outlet />
      </div>
    </>
  );
}
