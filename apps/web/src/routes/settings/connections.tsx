import { createFileRoute } from "@tanstack/react-router";

import { ConnectedAccounts } from "@/components/connected-accounts";

export const Route = createFileRoute("/settings/connections")({
  component: ConnectionsPage,
});

function ConnectionsPage() {
  return (
    <div className="container mx-auto max-w-xl px-4 py-12">
      <header className="mb-10">
        <h1 className="font-semibold text-lg tracking-tight">Connections</h1>
        <p className="mt-1 text-muted-foreground text-[13px] leading-relaxed">
          Link external accounts for integrations. Each provider grants access
          to specific scopes.
        </p>
      </header>
      <ConnectedAccounts />
    </div>
  );
}
