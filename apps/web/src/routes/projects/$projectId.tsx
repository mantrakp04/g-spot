import { Skeleton } from "@g-spot/ui/components/skeleton";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";

import { useProject } from "@/hooks/use-projects";
import { setLastProjectId } from "@/lib/active-project";

export const Route = createFileRoute("/projects/$projectId")({
  component: ProjectLayout,
});

function ProjectLayout() {
  const { projectId } = Route.useParams();
  const projectQuery = useProject(projectId);

  useEffect(() => {
    if (projectQuery.data) {
      setLastProjectId(projectQuery.data.id);
    }
  }, [projectQuery.data]);

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

  return <Outlet />;
}
