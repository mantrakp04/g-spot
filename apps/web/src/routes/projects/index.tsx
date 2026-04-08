import { buttonVariants } from "@g-spot/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@g-spot/ui/components/card";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import { cn } from "@g-spot/ui/lib/utils";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { FolderPlus, Plus } from "lucide-react";
import { useEffect } from "react";

import { useProjects } from "@/hooks/use-projects";
import { getLastProjectId, setLastProjectId } from "@/lib/active-project";

export const Route = createFileRoute("/projects/")({
  component: ProjectsIndexPage,
});

function ProjectsIndexPage() {
  const navigate = useNavigate();
  const projectsQuery = useProjects();

  // Auto-redirect to the last-used project (or the first one) when there's
  // a sensible target. We do this in an effect so the loading state still
  // renders rather than flashing the empty state for users with projects.
  useEffect(() => {
    const projects = projectsQuery.data;
    if (!projects || projects.length === 0) return;
    const lastId = getLastProjectId();
    const target =
      (lastId && projects.find((p) => p.id === lastId)) ?? projects[0];
    if (target) {
      void navigate({
        to: "/projects/$projectId",
        params: { projectId: target.id },
        replace: true,
      });
    }
  }, [navigate, projectsQuery.data]);

  if (projectsQuery.isLoading) {
    return (
      <div className="container mx-auto max-w-3xl space-y-6 px-4 py-12">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  const projects = projectsQuery.data ?? [];
  if (projects.length === 0) {
    return (
      <div className="container mx-auto flex min-h-full max-w-2xl items-center justify-center px-4 py-12">
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderPlus className="size-5" /> Create your first project
            </CardTitle>
            <CardDescription>
              Projects are workspaces that pin the Pi agent to a specific
              directory. Every chat lives inside a project.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              to="/projects/new"
              className={cn(buttonVariants({ variant: "default" }), "gap-2")}
            >
              <Plus className="size-4" />
              New project
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Once the effect lands on a real project, we won't render. Show a quiet
  // skeleton in the meantime.
  setLastProjectId(projects[0]?.id ?? null);
  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-12">
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}
