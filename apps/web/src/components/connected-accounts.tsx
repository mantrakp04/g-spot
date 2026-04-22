import { Badge } from "@g-spot/ui/components/badge";
import { Button } from "@g-spot/ui/components/button";
import { cn } from "@g-spot/ui/lib/utils";
import { useUser } from "@stackframe/react";
import { Check, Github, KeyRound, LinkIcon, Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import type { PiCredentialSummary } from "@g-spot/types";
import { GoogleAccountRow } from "@/components/google-account-row";
import { usePiCredentialFlows } from "@/contexts/pi-credential-flows-context";
import { usePiCatalog } from "@/hooks/use-pi";
import { GITHUB_OAUTH_SCOPES, GOOGLE_OAUTH_SCOPES } from "@/stack/client";

type ProviderId = "google" | "github";

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

function PiIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="none">
      <path
        d="M12 2.5 19.5 6v12L12 21.5 4.5 18V6L12 2.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M12 6.5v11"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M7.5 9.25h9"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function ScopeTag({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center rounded-sm bg-muted/80 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      {children}
    </span>
  );
}

function prettyProviderName(providerId: string) {
  return providerId
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function ConnectedAccounts() {
  const user = useUser({ or: "redirect" });
  const accounts = user.useConnectedAccounts();

  const googleAccounts = accounts.filter((account) => account.provider === "google");
  const githubAccounts = accounts.filter((account) => account.provider === "github");
  const githubLinked = githubAccounts.length > 0;

  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const piCatalog = usePiCatalog();
  const piFlows = usePiCredentialFlows();

  const providers = useMemo(() => {
    const catalog = piCatalog.data;
    if (!catalog) {
      return [];
    }

    const oauthProviders = new Map(
      catalog.oauthProviders.map((provider) => [provider.id, provider]),
    );
    const configuredProviders = new Map(
      catalog.configuredProviders.map((provider: PiCredentialSummary) => [
        provider.provider,
        provider.type,
      ]),
    );
    const providersById = new Set<string>();

    for (const provider of catalog.oauthProviders) {
      providersById.add(provider.id);
    }
    for (const model of catalog.availableModels) {
      providersById.add(model.provider);
    }
    for (const configuredProvider of catalog.configuredProviders) {
      providersById.add(configuredProvider.provider);
    }

    return [...providersById]
      .sort((left, right) => left.localeCompare(right))
      .map((providerId) => {
        const availableModels = catalog.availableModels.filter(
          (model) => model.provider === providerId,
        );

        return {
          id: providerId,
          name: oauthProviders.get(providerId)?.name ?? prettyProviderName(providerId),
          modelCount: availableModels.length,
          authType: configuredProviders.get(providerId) ?? null,
          supportsOauth: oauthProviders.has(providerId),
        };
      });
  }, [piCatalog.data]);

  async function connectOAuth(provider: ProviderId, scopes?: readonly string[]) {
    await user.linkConnectedAccount(
      provider,
      scopes ? { scopes: [...scopes] } : undefined,
    );
  }

  async function removeAccount(
    provider: string,
    providerAccountId: string,
    options?: { silentSuccess?: boolean; email?: string | null },
  ) {
    setDisconnecting(providerAccountId);
    try {
      const providers = await user.listOAuthProviders();
      const matches = providers.filter(
        (oauthProvider) =>
          oauthProvider.type === provider || oauthProvider.id === provider,
      );

      // The client-side `OAuthProvider` crud does not expose `accountId`, so
      // we can't map `providerAccountId` to a specific Stack entry directly.
      // When multiple accounts of the same provider are linked, match by
      // `email` (Stack records it at link time, so it works even when the
      // refresh token has expired).
      const normalizedEmail = options?.email?.trim().toLowerCase() || null;
      const oauthProvider =
        matches.find((entry) => entry.accountId === providerAccountId)
        ?? (normalizedEmail
          ? matches.find(
              (entry) => entry.email?.toLowerCase() === normalizedEmail,
            )
          : undefined)
        ?? (matches.length === 1 ? matches[0] : undefined);

      if (!oauthProvider) {
        if (matches.length === 0) {
          // Stack already has no entry for this provider — the ConnectedAccount
          // row is stale. Refresh the cache so it falls off.
          await user.listConnectedAccounts();
          if (!options?.silentSuccess) {
            toast.success("Account removed");
          }
          return;
        }
        throw new Error(
          `Multiple ${provider} accounts are linked and none matched ${
            normalizedEmail ?? providerAccountId
          }. Try reconnecting this account first, then remove it.`,
        );
      }

      await oauthProvider.delete();
      await user.listConnectedAccounts();
      if (!options?.silentSuccess) {
        toast.success("Account removed");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to remove account",
      );
      throw error;
    } finally {
      setDisconnecting(null);
    }
  }

  async function handleGoogleConnect() {
    try {
      await connectOAuth("google", GOOGLE_OAUTH_SCOPES);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Could not start connection flow.",
      );
    }
  }

  async function reconnectGoogleAccount(
    providerAccountId: string,
    email: string | null,
  ) {
    await removeAccount("google", providerAccountId, {
      silentSuccess: true,
      email,
    });

    try {
      await connectOAuth("google", GOOGLE_OAUTH_SCOPES);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Could not start connection flow.",
      );
      throw error;
    }
  }

  return (
    <div className="space-y-3">
      <section
        className={cn(
          "group relative overflow-hidden rounded-lg border border-border/60 bg-card transition-colors",
          googleAccounts.length > 0 && "border-border",
        )}
      >
        <div className="flex items-start justify-between gap-4 px-4 pt-4 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/50">
              <GoogleIcon className="size-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-[13px] tracking-tight">Google</h3>
                {googleAccounts.length > 0 ? (
                  <Badge
                    variant="outline"
                    className="gap-1 border-emerald-500/20 bg-emerald-500/10 py-0 font-normal text-[10px] text-emerald-400"
                  >
                    <Check className="size-2.5" strokeWidth={3} />
                    {googleAccounts.length}
                    {googleAccounts.length === 1 ? " account" : " accounts"}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                <ScopeTag>gmail:full</ScopeTag>
                <ScopeTag>calendar</ScopeTag>
                <ScopeTag>profile</ScopeTag>
              </div>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="mt-0.5 shrink-0 gap-1 text-muted-foreground text-xs hover:text-foreground"
            onClick={() => void handleGoogleConnect()}
          >
            <Plus className="size-3" strokeWidth={2.5} />
            {googleAccounts.length === 0 ? "Connect" : "Add"}
          </Button>
        </div>

        {googleAccounts.length > 0 ? (
          <ul className="border-t border-border/50">
            {googleAccounts.map((account) => (
              <GoogleAccountRow
                key={account.providerAccountId}
                account={account}
                onReconnect={(email) =>
                  reconnectGoogleAccount(account.providerAccountId, email)
                }
                onRemove={(email) =>
                  removeAccount("google", account.providerAccountId, { email })
                }
              />
            ))}
          </ul>
        ) : (
          <div className="border-t border-dashed border-border/40 px-4 py-3">
            <p className="text-muted-foreground/60 text-[12px]">
              No Google accounts linked yet.
            </p>
          </div>
        )}
      </section>

      <section
        className={cn(
          "group relative overflow-hidden rounded-lg border border-border/60 bg-card transition-colors",
          githubLinked && "border-border",
        )}
      >
        <div className="flex items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/50">
              <Github className="size-4 text-muted-foreground" strokeWidth={1.75} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-[13px] tracking-tight">GitHub</h3>
                {githubLinked ? (
                  <Badge
                    variant="outline"
                    className="gap-1 border-emerald-500/20 bg-emerald-500/10 py-0 font-normal text-[10px] text-emerald-400"
                  >
                    <Check className="size-2.5" strokeWidth={3} />
                    Connected
                  </Badge>
                ) : (
                  <span className="text-muted-foreground/50 text-[11px]">
                    Not linked
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                <ScopeTag>repo</ScopeTag>
                <ScopeTag>workflow</ScopeTag>
                <ScopeTag>write:org</ScopeTag>
                <ScopeTag>profile</ScopeTag>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {githubLinked ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="gap-1 text-muted-foreground text-xs hover:text-destructive"
                onClick={() => {
                  const account = githubAccounts[0];
                  if (account) {
                    void removeAccount("github", account.providerAccountId);
                  }
                }}
                disabled={disconnecting === githubAccounts[0]?.providerAccountId}
              >
                <Minus className="size-3" strokeWidth={2.5} />
                Remove
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="shrink-0 text-muted-foreground text-xs hover:text-foreground"
              onClick={() => void connectOAuth("github", GITHUB_OAUTH_SCOPES)}
            >
              {githubLinked ? "Reconnect" : "Connect"}
            </Button>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border/60 bg-card">
        <div className="flex items-start justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/50">
              <PiIcon className="size-4 text-muted-foreground" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-[13px] tracking-tight">Pi Providers</h3>
                {piCatalog.data ? (
                  <Badge variant="outline" className="py-0 font-normal text-[10px]">
                    {piCatalog.data.configuredProviders.length} configured
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 max-w-md text-muted-foreground text-[12px] leading-relaxed">
                Connect model providers for Pi chat and worker agents. OAuth and
                API-key auth are both supported where the provider allows it.
              </p>
            </div>
          </div>
        </div>

        <div className="border-t border-border/50">
          {piCatalog.isLoading ? (
            <div className="px-4 py-6 text-muted-foreground text-[12px]">
              Loading Pi providers…
            </div>
          ) : providers.length === 0 ? (
            <div className="px-4 py-6 text-muted-foreground text-[12px]">
              No Pi providers available.
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {providers.map((provider) => (
                <div
                  key={provider.id}
                  className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[13px]">{provider.name}</span>
                      {provider.authType ? (
                        <Badge
                          variant="outline"
                          className="gap-1 border-emerald-500/20 bg-emerald-500/10 py-0 font-normal text-[10px] text-emerald-400"
                        >
                          <Check className="size-2.5" strokeWidth={3} />
                          {provider.authType === "oauth" ? "OAuth" : "API key"}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground/50 text-[11px]">
                          Not configured
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {provider.modelCount > 0 ? (
                        <ScopeTag>{`${provider.modelCount} models`}</ScopeTag>
                      ) : null}
                      {provider.supportsOauth ? <ScopeTag>oauth</ScopeTag> : null}
                      <ScopeTag>api-key</ScopeTag>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {provider.authType ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="gap-1 text-muted-foreground text-xs hover:text-destructive"
                        onClick={() => void piFlows.removeCredential(provider.id)}
                        disabled={piFlows.isRemoving}
                      >
                        <Minus className="size-3" strokeWidth={2.5} />
                        Remove
                      </Button>
                    ) : null}

                    {provider.supportsOauth ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="gap-1 text-muted-foreground text-xs hover:text-foreground"
                        onClick={() => void piFlows.connectOAuth(provider.id)}
                        disabled={piFlows.isConnectingOAuth}
                      >
                        <LinkIcon className="size-3.5" />
                        {provider.authType === "oauth" ? "Reconnect" : "OAuth"}
                      </Button>
                    ) : null}

                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="gap-1 text-muted-foreground text-xs hover:text-foreground"
                      onClick={() => piFlows.configureApiKey(provider.id)}
                    >
                      <KeyRound className="size-3.5" />
                      API Key
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
