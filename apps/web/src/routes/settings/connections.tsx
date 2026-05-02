import { Button } from "@g-spot/ui/components/button";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";

import { ConnectedAccounts } from "@/components/connected-accounts";
import { useOnboarded } from "@/hooks/use-onboarded";

export const Route = createFileRoute("/settings/connections")({
  component: ConnectionsPage,
});

function ConnectionsPage() {
  const navigate = useNavigate();
  const { replayOnboarding } = useOnboarded();

  return (
    <div className="h-full overflow-y-auto">
      <div className="container mx-auto max-w-xl space-y-6 px-4 py-12">
      <header className="mb-10 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-lg tracking-tight">Connections</h1>
          <p className="mt-1 text-muted-foreground text-[13px] leading-relaxed">
            Link external accounts for integrations. Each provider grants access
            to specific scopes.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 gap-1 text-muted-foreground hover:text-foreground"
          onClick={() => {
            replayOnboarding();
            void navigate({ to: "/onboarding" });
          }}
        >
          <Sparkles className="size-3.5" />
          Replay onboarding
        </Button>
      </header>
        <ConnectedAccounts />
      </div>
    </div>
  );
}
