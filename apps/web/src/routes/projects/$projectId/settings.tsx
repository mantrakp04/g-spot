import { createFileRoute, useNavigate } from "@tanstack/react-router";

import {
  isProjectSettingsTab,
  ProjectSettingsPage,
  type ProjectSettingsTab,
} from "@/components/projects/project-settings-page";

type ProjectSettingsSearch = {
  tab?: ProjectSettingsTab;
};

export const Route = createFileRoute("/projects/$projectId/settings")({
  component: ProjectSettingsRoute,
  validateSearch: (search: Record<string, unknown>): ProjectSettingsSearch => ({
    tab: isProjectSettingsTab(search.tab) ? search.tab : undefined,
  }),
});

function ProjectSettingsRoute() {
  const { projectId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const activeTab: ProjectSettingsTab = tab ?? "general";

  return (
    <ProjectSettingsPage
      projectId={projectId}
      tab={activeTab}
      onTabChange={(nextTab) => {
        void navigate({
          to: "/projects/$projectId/settings",
          params: { projectId },
          search: { tab: nextTab === "general" ? undefined : nextTab },
          replace: true,
        });
      }}
    />
  );
}
