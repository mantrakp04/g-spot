import { Badge } from "@g-spot/ui/components/badge";
import { Button } from "@g-spot/ui/components/button";
import { cn } from "@g-spot/ui/lib/utils";
import { useUser } from "@stackframe/react";
import { Check, Github, Plus } from "lucide-react";
import { toast } from "sonner";

import { GoogleAccountRow } from "@/components/google-account-row";
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
  const githubLinked = accounts.some((a) => a.provider === "github");

  async function connect(provider: ProviderId, scopes?: readonly string[]) {
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

  return (
    <div className="space-y-3">
      {/* ── Google ── */}
      <section
        className={cn(
          "group relative overflow-hidden rounded-lg border border-border/60 bg-card transition-colors",
          googleAccounts.length > 0 && "border-border",
        )}
      >
        {/* Header */}
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
                <ScopeTag>gmail:read</ScopeTag>
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
            onClick={() => void connect("google", GOOGLE_OAUTH_SCOPES)}
          >
            <Plus className="size-3" strokeWidth={2.5} />
            {googleAccounts.length === 0 ? "Connect" : "Add"}
          </Button>
        </div>

        {/* Account list */}
        {googleAccounts.length > 0 && (
          <ul className="border-t border-border/50">
            {googleAccounts.map((a) => (
              <GoogleAccountRow key={a.providerAccountId} account={a} />
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
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="shrink-0 text-muted-foreground text-xs hover:text-foreground"
            onClick={() => void connect("github")}
          >
            {githubLinked ? "Reconnect" : "Connect"}
          </Button>
        </div>
      </section>
    </div>
  );
}
