import { createFileRoute } from "@tanstack/react-router";

import { ProjectSettingsPage } from "@/components/projects/project-settings-page";

export const Route = createFileRoute("/projects/$projectId/settings")({
  component: ProjectSettingsRoute,
});

function ProjectSettingsRoute() {
  const { projectId } = Route.useParams();
  return <ProjectSettingsPage projectId={projectId} />;
}
