import { createFileRoute } from "@tanstack/react-router";

import { SkillsPage } from "@/components/skills/skills-page";

export const Route = createFileRoute("/settings/skills")({
  component: GlobalSkillsRoute,
});

function GlobalSkillsRoute() {
  return (
    <SkillsPage
      projectId={null}
      title="Global skills"
      description="Skills you can use across every project. A project-scoped skill with the same name will shadow the global one inside that project."
      backHref={{
        to: "/projects",
        label: "Back to projects",
      }}
    />
  );
}
