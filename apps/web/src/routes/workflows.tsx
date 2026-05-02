import { createFileRoute } from "@tanstack/react-router";

import { GmailWorkflowsPage } from "@/components/gmail-workflows/gmail-workflows-page";
import { AppLayout } from "@/components/shell/app-layout";

export const Route = createFileRoute("/workflows")({
  component: WorkflowsRoute,
});

function WorkflowsRoute() {
  return (
    <AppLayout>
      <GmailWorkflowsPage />
    </AppLayout>
  );
}
