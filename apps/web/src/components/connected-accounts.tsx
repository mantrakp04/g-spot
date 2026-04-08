import { Badge } from "@g-spot/ui/components/badge";
import { Button } from "@g-spot/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@g-spot/ui/components/dialog";
import { Input } from "@g-spot/ui/components/input";
import { Textarea } from "@g-spot/ui/components/textarea";
import { cn } from "@g-spot/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@stackframe/react";
import { Check, Github, KeyRound, LinkIcon, Loader2, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { GoogleAccountRow } from "@/components/google-account-row";
import { useRemoveConnectionMutation } from "@/hooks/use-connections";
import { piKeys } from "@/lib/query-keys";
import { GITHUB_OAUTH_SCOPES, GOOGLE_OAUTH_SCOPES } from "@/stack/client";
import { trpcClient } from "@/utils/trpc";

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

function isOauthSessionRunning(status: string | undefined) {
  return (
    status === "running" ||
    status === "waiting_for_prompt" ||
    status === "waiting_for_manual_code"
  );
}

export function ConnectedAccounts() {
  const user = useUser({ or: "redirect" });
  const accounts = user.useConnectedAccounts();
  const queryClient = useQueryClient();

  const googleAccounts = accounts.filter((account) => account.provider === "google");
  const githubAccounts = accounts.filter((account) => account.provider === "github");
  const githubLinked = githubAccounts.length > 0;

  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [apiKeyProvider, setApiKeyProvider] = useState<string | null>(null);
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [oauthSessionId, setOauthSessionId] = useState<string | null>(null);
  const [oauthPromptValue, setOauthPromptValue] = useState("");
  const [oauthManualCode, setOauthManualCode] = useState("");
  const lastOauthStatusRef = useRef<string | null>(null);

  const removeConnectionMutation = useRemoveConnectionMutation();

  const piCatalog = useQuery({
    queryKey: piKeys.catalog(),
    queryFn: () => trpcClient.pi.catalog.query(),
  });

  const oauthSession = useQuery({
    queryKey: piKeys.oauthSession(oauthSessionId),
    queryFn: () => trpcClient.pi.oauthSession.query({ sessionId: oauthSessionId! }),
    enabled: !!oauthSessionId,
    refetchInterval: (query) =>
      isOauthSessionRunning(query.state.data?.status) ? 1500 : false,
  });

  const saveApiKeyMutation = useMutation({
    mutationFn: (input: { provider: string; apiKey: string }) =>
      trpcClient.pi.saveApiKey.mutate(input),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: piKeys.catalog() });
      toast.success(`${prettyProviderName(variables.provider)} API key saved`);
      setApiKeyProvider(null);
      setApiKeyValue("");
    },
  });

  const removeCredentialMutation = useMutation({
    mutationFn: (provider: string) =>
      trpcClient.pi.removeCredential.mutate({ provider }),
    onSuccess: async (_, provider) => {
      await queryClient.invalidateQueries({ queryKey: piKeys.catalog() });
      toast.success(`${prettyProviderName(provider)} credential removed`);
    },
  });

  const startOAuthMutation = useMutation({
    mutationFn: (provider: string) =>
      trpcClient.pi.startOAuth.mutate({ provider }),
    onSuccess: (session) => {
      setOauthPromptValue("");
      setOauthManualCode("");
      setOauthSessionId(session.id);
    },
  });

  const submitOauthPromptMutation = useMutation({
    mutationFn: (input: { sessionId: string; value: string }) =>
      trpcClient.pi.submitOAuthPrompt.mutate(input),
    onSuccess: () => {
      setOauthPromptValue("");
    },
  });

  const submitOauthManualCodeMutation = useMutation({
    mutationFn: (input: { sessionId: string; value: string }) =>
      trpcClient.pi.submitOAuthManualCode.mutate(input),
    onSuccess: () => {
      setOauthManualCode("");
    },
  });

  const cancelOauthMutation = useMutation({
    mutationFn: (sessionId: string) =>
      trpcClient.pi.cancelOAuth.mutate({ sessionId }),
    onSuccess: () => {
      setOauthSessionId(null);
      setOauthPromptValue("");
      setOauthManualCode("");
    },
  });

  useEffect(() => {
    const status = oauthSession.data?.status ?? null;
    if (!status || lastOauthStatusRef.current === status) {
      return;
    }

    lastOauthStatusRef.current = status;
    if (status === "completed") {
      toast.success(`${oauthSession.data?.providerName ?? "Provider"} connected`);
      void queryClient.invalidateQueries({ queryKey: piKeys.catalog() });
    }
    if (status === "error" && oauthSession.data?.errorMessage) {
      toast.error(oauthSession.data.errorMessage);
    }
  }, [oauthSession.data, queryClient]);

  const providers = useMemo(() => {
    const catalog = piCatalog.data;
    if (!catalog) {
      return [];
    }

    const oauthProviders = new Map(
      catalog.oauthProviders.map((provider) => [provider.id, provider]),
    );
    const configuredProviders = new Map(
      catalog.configuredProviders.map((provider) => [provider.provider, provider.type]),
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
    try {
      await user.linkConnectedAccount(
        provider,
        scopes ? { scopes: [...scopes] } : undefined,
      );
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Could not start connection flow.",
      );
    }
  }

  async function removeAccount(provider: string, providerAccountId: string) {
    setDisconnecting(providerAccountId);
    try {
      await removeConnectionMutation.mutateAsync({ provider, providerAccountId });
      toast.success("Account removed");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to remove account",
      );
    } finally {
      setDisconnecting(null);
    }
  }

  async function saveApiKey() {
    if (!apiKeyProvider || apiKeyValue.trim().length === 0) {
      return;
    }

    await saveApiKeyMutation.mutateAsync({
      provider: apiKeyProvider,
      apiKey: apiKeyValue.trim(),
    });
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
            onClick={() => void connectOAuth("google", GOOGLE_OAUTH_SCOPES)}
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
                onReconnect={() => void connectOAuth("google", GOOGLE_OAUTH_SCOPES)}
                onRemove={() => removeAccount("google", account.providerAccountId)}
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
                <ScopeTag>read:org</ScopeTag>
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
                        onClick={() => void removeCredentialMutation.mutateAsync(provider.id)}
                        disabled={removeCredentialMutation.isPending}
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
                        onClick={() => void startOAuthMutation.mutateAsync(provider.id)}
                        disabled={startOAuthMutation.isPending}
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
                      onClick={() => {
                        setApiKeyProvider(provider.id);
                        setApiKeyValue("");
                      }}
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

      <Dialog
        open={apiKeyProvider !== null}
        onOpenChange={(open) => {
          if (!open) {
            setApiKeyProvider(null);
            setApiKeyValue("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save API key</DialogTitle>
            <DialogDescription>
              Store an API key for {apiKeyProvider ? prettyProviderName(apiKeyProvider) : "this provider"}.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            placeholder="sk-..."
            value={apiKeyValue}
            onChange={(event) => setApiKeyValue(event.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setApiKeyProvider(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void saveApiKey()}
              disabled={saveApiKeyMutation.isPending || apiKeyValue.trim().length === 0}
            >
              {saveApiKeyMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={oauthSessionId !== null}
        onOpenChange={(open) => {
          if (!open && oauthSessionId) {
            void cancelOauthMutation.mutateAsync(oauthSessionId);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {oauthSession.data?.providerName ?? "Provider"} sign-in
            </DialogTitle>
            <DialogDescription>
              Continue the Pi-native OAuth flow. This dialog updates as the provider asks
              for browser auth, prompts, or manual code entry.
            </DialogDescription>
          </DialogHeader>

          {oauthSession.data?.auth?.instructions ? (
            <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-[12px] leading-relaxed">
              {oauthSession.data.auth.instructions}
            </div>
          ) : null}

          {oauthSession.data?.auth?.url ? (
            <a
              href={oauthSession.data.auth.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center justify-center rounded-md border border-border px-3 text-[12px] transition-colors hover:bg-muted"
            >
              Open provider login
            </a>
          ) : null}

          {oauthSession.data?.progress?.length ? (
            <div className="space-y-2 rounded-md border border-border/60 bg-background/60 p-3">
              <p className="font-medium text-[12px]">Progress</p>
              <ul className="space-y-1 text-muted-foreground text-[12px]">
                {oauthSession.data.progress.slice(-6).map((entry, index) => (
                  <li key={`${entry}-${index}`}>{entry}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {oauthSession.data?.status === "waiting_for_prompt" && oauthSession.data.prompt ? (
            <div className="space-y-3">
              <label className="space-y-1 text-[12px]">
                <span className="font-medium">{oauthSession.data.prompt.message}</span>
                <Input
                  placeholder={oauthSession.data.prompt.placeholder ?? "Response"}
                  value={oauthPromptValue}
                  onChange={(event) => setOauthPromptValue(event.target.value)}
                />
              </label>
              <Button
                onClick={() =>
                  oauthSessionId
                    ? submitOauthPromptMutation.mutate({
                        sessionId: oauthSessionId,
                        value: oauthPromptValue,
                      })
                    : undefined
                }
                disabled={
                  submitOauthPromptMutation.isPending ||
                  (!oauthSession.data.prompt.allowEmpty && oauthPromptValue.trim().length === 0)
                }
              >
                Submit prompt
              </Button>
            </div>
          ) : null}

          {oauthSession.data?.status === "waiting_for_manual_code" ? (
            <div className="space-y-3">
              <label className="space-y-1 text-[12px]">
                <span className="font-medium">Manual code</span>
                <Textarea
                  placeholder="Paste the code from the provider"
                  value={oauthManualCode}
                  onChange={(event) => setOauthManualCode(event.target.value)}
                />
              </label>
              <Button
                onClick={() =>
                  oauthSessionId
                    ? submitOauthManualCodeMutation.mutate({
                        sessionId: oauthSessionId,
                        value: oauthManualCode,
                      })
                    : undefined
                }
                disabled={
                  submitOauthManualCodeMutation.isPending ||
                  oauthManualCode.trim().length === 0
                }
              >
                Submit code
              </Button>
            </div>
          ) : null}

          {oauthSession.data?.status === "completed" ? (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-[12px] text-emerald-300">
              Provider connected successfully.
            </div>
          ) : null}

          {oauthSession.data?.status === "error" && oauthSession.data.errorMessage ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-[12px] text-destructive">
              {oauthSession.data.errorMessage}
            </div>
          ) : null}

          <DialogFooter>
            {isOauthSessionRunning(oauthSession.data?.status) ? (
              <Button
                variant="outline"
                onClick={() =>
                  oauthSessionId
                    ? cancelOauthMutation.mutate(oauthSessionId)
                    : undefined
                }
              >
                Cancel
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  setOauthSessionId(null);
                  setOauthPromptValue("");
                  setOauthManualCode("");
                }}
              >
                Close
              </Button>
            )}
            {oauthSession.isFetching ? (
              <span className="inline-flex items-center gap-2 text-muted-foreground text-[12px]">
                <Loader2 className="size-3.5 animate-spin" />
                Syncing
              </span>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
