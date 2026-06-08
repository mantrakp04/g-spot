import { createFileRoute, Outlet } from "@tanstack/react-router";

import { TabsContent } from "@/components/tabs/tabs-content";

/**
 * Pathless layout for the agent shell. Tab focus, splits, scroll position,
 * draft input, and PTY state live in tab state instead of per-chat URLs.
 */
export const Route = createFileRoute("/agent/$projectId/_tabs")({
  component: TabsLayout,
});

function TabsLayout() {
  const { projectId } = Route.useParams();
  return (
    <>
      <TabsContent projectId={projectId} />
      <div className="hidden">
        <Outlet />
      </div>
    </>
  );
}
