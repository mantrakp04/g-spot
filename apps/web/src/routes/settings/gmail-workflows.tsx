import { createFileRoute } from "@tanstack/react-router";

import { GmailWorkflowsPage } from "@/components/gmail-workflows/gmail-workflows-page";

export const Route = createFileRoute("/settings/gmail-workflows")({
  component: GmailWorkflowsRoute,
});

function GmailWorkflowsRoute() {
  return <GmailWorkflowsPage />;
}
