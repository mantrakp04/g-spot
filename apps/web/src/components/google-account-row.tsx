import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@g-spot/ui/components/avatar";
import { Button } from "@g-spot/ui/components/button";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import type { OAuthConnection } from "@stackframe/react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, X } from "lucide-react";
import { useState } from "react";

type GoogleUserInfo = {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
};

function profileInitials(
  profile: GoogleUserInfo | undefined,
  fallbackHint: string,
) {
  const name = profile?.name?.trim();
  if (name) {
    const parts = name.split(/\s+/);
    if (parts.length >= 2) {
      const a = parts[0]?.[0];
      const b = parts[parts.length - 1]?.[0];
      return `${a ?? ""}${b ?? ""}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  const email = profile?.email?.trim();
  if (email) return email.slice(0, 2).toUpperCase();
  if (fallbackHint.length >= 2) return fallbackHint.slice(-2).toUpperCase();
  return "?";
}

function formatIdSuffix(id: string) {
  const t = id.trim();
  if (t.length <= 12) return t;
  return `…${t.slice(-8)}`;
}

export function GoogleAccountRow({
  account,
  onReconnect,
  onRemove,
}: {
  account: OAuthConnection;
  onReconnect: () => void;
  onRemove: () => Promise<void>;
}) {
  const [removing, setRemoving] = useState(false);

  const q = useQuery({
    queryKey: ["google-oauth-profile", account.providerAccountId],
    staleTime: 10 * 60_000,
    retry: 1,
    queryFn: async (): Promise<GoogleUserInfo> => {
      const tokenResult = await account.getAccessToken();
      if (tokenResult.status !== "ok") {
        throw new Error(tokenResult.error?.message ?? "No access token");
      }
      const res = await fetch(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        {
          headers: { Authorization: `Bearer ${tokenResult.data.accessToken}` },
        },
      );
      if (!res.ok) {
        throw new Error(`userinfo ${res.status}`);
      }
      return (await res.json()) as GoogleUserInfo;
    },
  });

  async function handleRemove() {
    setRemoving(true);
    try {
      await onRemove();
    } finally {
      setRemoving(false);
    }
  }

  if (q.isPending) {
    return (
      <li className="flex items-center gap-3 px-4 py-3">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3 w-40" />
        </div>
      </li>
    );
  }

  const profile = q.isSuccess ? q.data : undefined;
  const name =
    profile?.name?.trim() ||
    [profile?.given_name, profile?.family_name]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    null;
  const email = profile?.email?.trim() || null;

  const primary =
    q.isError ? "Google account" : (name ?? email ?? "Google account");

  let secondary: string | null = null;
  if (q.isError) {
    secondary = `Couldn't load profile · ${formatIdSuffix(account.providerAccountId)}`;
  } else if (name && email) {
    secondary = email;
  } else if (name && !email) {
    secondary = `ID ${formatIdSuffix(account.providerAccountId)}`;
  } else if (!name && email) {
    secondary = null;
  } else {
    secondary = `ID ${formatIdSuffix(account.providerAccountId)}`;
  }

  return (
    <li className="group/row flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/30">
      <Avatar className="size-7">
        <AvatarImage
          src={profile?.picture ?? undefined}
          alt=""
          className="object-cover"
        />
        <AvatarFallback className="bg-muted text-[10px] text-muted-foreground">
          {profileInitials(profile, account.providerAccountId)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-[13px] leading-tight text-foreground">
          {primary}
        </p>
        {secondary && (
          <p className="truncate text-muted-foreground text-[11px] leading-tight">
            {secondary}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-foreground"
          onClick={onReconnect}
          title="Reconnect"
        >
          <RefreshCw className="size-3" strokeWidth={2} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground hover:text-destructive"
          onClick={handleRemove}
          disabled={removing}
          title="Remove"
        >
          <X className="size-3" strokeWidth={2.5} />
        </Button>
      </div>
    </li>
  );
}
