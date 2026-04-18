import { createFileRoute, useNavigate } from "@tanstack/react-router";

import {
  ChatSettingsPage,
  isChatSettingsTab,
  type ChatSettingsTab,
} from "@/components/chat/chat-settings-page";

type ChatSettingsSearch = {
  tab?: ChatSettingsTab;
};

export const Route = createFileRoute("/chat/settings")({
  component: ChatSettingsRoute,
  validateSearch: (search: Record<string, unknown>): ChatSettingsSearch => ({
    tab: isChatSettingsTab(search.tab) ? search.tab : undefined,
  }),
});

function ChatSettingsRoute() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const activeTab: ChatSettingsTab = tab ?? "agent";

  return (
    <ChatSettingsPage
      tab={activeTab}
      onTabChange={(nextTab) => {
        void navigate({
          to: "/chat/settings",
          search: { tab: nextTab === "agent" ? undefined : nextTab },
          replace: true,
        });
      }}
    />
  );
}
