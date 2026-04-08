import { createFileRoute } from "@tanstack/react-router";

import { SkillsPage } from "@/components/skills/skills-page";
import { useProject } from "@/hooks/use-projects";

export const Route = createFileRoute("/projects/$projectId/skills")({
  component: ProjectSkillsRoute,
});

function ProjectSkillsRoute() {
  const { projectId } = Route.useParams();
  const projectQuery = useProject(projectId);
  const projectName = projectQuery.data?.name ?? "Project";

  return (
    <SkillsPage
      projectId={projectId}
      title={`${projectName} skills`}
      description="Skills scoped to this project. They show up in the slash-command menu inside any chat in this project, and shadow any global skill with the same name."
      backHref={{
        to: "/projects/$projectId",
        params: { projectId },
        label: "Back to project",
      }}
    />
  );
}
