import { Badge } from "@g-spot/ui/components/badge";
import { Button } from "@g-spot/ui/components/button";
import { cn } from "@g-spot/ui/lib/utils";
import { useUser } from "@stackframe/react";
import { Check, Github, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { GoogleAccountRow } from "@/components/google-account-row";
import { OpenAIConnectDialog } from "@/components/openai-connect-dialog";
import { useRemoveConnectionMutation } from "@/hooks/use-connections";
import {
  useDisconnectOpenAIMutation,
  useInitiateOpenAIOAuthMutation,
  useOpenAIStatus,
  useRefreshOpenAIStatus,
} from "@/hooks/use-openai";
import { GOOGLE_OAUTH_SCOPES } from "@/stack/google-oauth-scopes";

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

function OpenAIIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
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

export function ConnectedAccounts() {
  const user = useUser({ or: "redirect" });
  const accounts = user.useConnectedAccounts();

  const googleAccounts = accounts.filter((a) => a.provider === "google");
  const githubAccounts = accounts.filter((a) => a.provider === "github");
  const githubLinked = githubAccounts.length > 0;

  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [apiKeyDialogOpen, setApiKeyDialogOpen] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const openaiStatus = useOpenAIStatus();
  const refreshOpenAIStatus = useRefreshOpenAIStatus();
  const initiateOpenAIOAuthMutation = useInitiateOpenAIOAuthMutation();
  const disconnectOpenAIMutation = useDisconnectOpenAIMutation();
  const removeConnectionMutation = useRemoveConnectionMutation();

  // Listen for postMessage from OAuth popup
  const handleOAuthMessage = useCallback(
    (event: MessageEvent) => {
      const data = event.data as { type?: string; status?: string } | undefined;
      if (data?.type !== "openai-oauth") return;
      if (data.status === "success") {
        toast.success("OpenAI connected");
        void refreshOpenAIStatus();
      } else {
        toast.error("OpenAI connection failed");
      }
    },
    [refreshOpenAIStatus],
  );

  useEffect(() => {
    window.addEventListener("message", handleOAuthMessage);
    return () => window.removeEventListener("message", handleOAuthMessage);
  }, [handleOAuthMessage]);

  async function connectOAuth(provider: ProviderId, scopes?: readonly string[]) {
    try {
      await user.linkConnectedAccount(
        provider,
        scopes ? { scopes: [...scopes] } : undefined,
      );
    } catch (e) {
      console.error(e);
      toast.error(
        e instanceof Error ? e.message : "Could not start connection flow.",
      );
    }
  }

  async function connectOpenai() {
    try {
      const { url } = await initiateOpenAIOAuthMutation.mutateAsync();
      const w = 500;
      const h = 700;
      const left = window.screenX + (window.outerWidth - w) / 2;
      const top = window.screenY + (window.outerHeight - h) / 2;
      popupRef.current = window.open(
        url,
        "openai-oauth",
        `width=${w},height=${h},left=${left},top=${top}`,
      );
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not start OpenAI connection.",
      );
    }
  }

  async function removeAccount(provider: string, providerAccountId: string) {
    setDisconnecting(providerAccountId);
    try {
      await removeConnectionMutation.mutateAsync({ provider, providerAccountId });
      toast.success("Account removed");
      // Stack Auth SDK will re-fetch connected accounts automatically
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to remove account",
      );
    } finally {
      setDisconnecting(null);
    }
  }

  async function disconnectOpenai() {
    setDisconnecting("openai");
    try {
      await disconnectOpenAIMutation.mutateAsync();
      toast.success("OpenAI disconnected");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to disconnect OpenAI",
      );
    } finally {
      setDisconnecting(null);
    }
  }

  return (
    <div className="space-y-3">
      {/* ── Google ── */}
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
                <h3 className="font-medium text-[13px] tracking-tight">
                  Google
                </h3>
                {googleAccounts.length > 0 && (
                  <Badge
                    variant="outline"
                    className="gap-1 border-emerald-500/20 bg-emerald-500/10 py-0 font-normal text-[10px] text-emerald-400"
                  >
                    <Check className="size-2.5" strokeWidth={3} />
                    {googleAccounts.length}
                    {googleAccounts.length === 1 ? " account" : " accounts"}
                  </Badge>
                )}
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

        {googleAccounts.length > 0 && (
          <ul className="border-t border-border/50">
            {googleAccounts.map((a) => (
              <GoogleAccountRow
                key={a.providerAccountId}
                account={a}
                onReconnect={() =>
                  void connectOAuth("google", GOOGLE_OAUTH_SCOPES)
                }
                onRemove={() =>
                  removeAccount("google", a.providerAccountId)
                }
              />
            ))}
          </ul>
        )}

        {googleAccounts.length === 0 && (
          <div className="border-t border-dashed border-border/40 px-4 py-3">
            <p className="text-muted-foreground/60 text-[12px]">
              No Google accounts linked yet.
            </p>
          </div>
        )}
      </section>

      {/* ── GitHub ── */}
      <section
        className={cn(
          "group relative overflow-hidden rounded-lg border border-border/60 bg-card transition-colors",
          githubLinked && "border-border",
        )}
      >
        <div className="flex items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/50">
              <Github
                className="size-4 text-muted-foreground"
                strokeWidth={1.75}
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-[13px] tracking-tight">
                  GitHub
                </h3>
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
                <ScopeTag>repos</ScopeTag>
                <ScopeTag>profile</ScopeTag>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {githubLinked && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="gap-1 text-muted-foreground text-xs hover:text-destructive"
                onClick={() => {
                  const gh = githubAccounts[0];
                  if (gh) void removeAccount("github", gh.providerAccountId);
                }}
                disabled={disconnecting === githubAccounts[0]?.providerAccountId}
              >
                <Minus className="size-3" strokeWidth={2.5} />
                Remove
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="shrink-0 text-muted-foreground text-xs hover:text-foreground"
              onClick={() => void connectOAuth("github")}
            >
              {githubLinked ? "Reconnect" : "Connect"}
            </Button>
          </div>
        </div>
      </section>

      {/* ── OpenAI (Codex OAuth) ── */}
      <section
        className={cn(
          "group relative overflow-hidden rounded-lg border border-border/60 bg-card transition-colors",
          openaiStatus.data?.connected && "border-border",
        )}
      >
        <div className="flex items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/50">
              <OpenAIIcon className="size-4 text-muted-foreground" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-[13px] tracking-tight">
                  OpenAI
                </h3>
                {openaiStatus.data?.connected ? (
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
                <ScopeTag>codex</ScopeTag>
                <ScopeTag>chat</ScopeTag>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {openaiStatus.data?.connected && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="gap-1 text-muted-foreground text-xs hover:text-destructive"
                onClick={disconnectOpenai}
                disabled={disconnecting === "openai"}
              >
                <Minus className="size-3" strokeWidth={2.5} />
                {disconnecting === "openai" ? "Removing…" : "Remove"}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="shrink-0 text-muted-foreground text-xs hover:text-foreground"
              onClick={connectOpenai}
            >
              {openaiStatus.data?.connected ? "Reconnect" : "OAuth"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="shrink-0 text-muted-foreground text-xs hover:text-foreground"
              onClick={() => setApiKeyDialogOpen(true)}
            >
              API Key
            </Button>
          </div>
        </div>
      </section>

      <OpenAIConnectDialog
        open={apiKeyDialogOpen}
        onOpenChange={setApiKeyDialogOpen}
        onConnected={() => void refreshOpenAIStatus()}
      />
    </div>
  );
}
