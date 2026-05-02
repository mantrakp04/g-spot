import { createFileRoute, Outlet } from "@tanstack/react-router";

import { AiSidebar } from "@/components/chat/ai-sidebar";
import { AppLayout } from "@/components/shell/app-layout";

export const Route = createFileRoute("/projects")({
  component: ProjectsLayout,
});

function ProjectsLayout() {
  return (
    <AppLayout sidebar={<AiSidebar />}>
      <Outlet />
    </AppLayout>
  );
}
