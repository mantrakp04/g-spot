import { ConnectedAccounts } from "@/components/connected-accounts";

export function ConnectionsStep() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Connect your accounts
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Link Google for Gmail and Calendar, and GitHub for PRs and issues.
          You can connect more later from Settings → Connections.
        </p>
      </div>
      <ConnectedAccounts />
    </div>
  );
}
