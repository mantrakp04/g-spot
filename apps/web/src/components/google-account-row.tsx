import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@g-spot/ui/components/avatar";
import { Button } from "@g-spot/ui/components/button";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import type { OAuthConnection } from "@stackframe/react";
import { RefreshCw, X } from "lucide-react";
import { useState } from "react";

import { useGoogleProfile } from "@/hooks/use-gmail-options";
import { getInitials } from "@/lib/oauth";

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
  const q = useGoogleProfile(account);

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

  const profile = q.isSuccess ? q.data : null;
  const name = profile?.name || null;
  const email = profile?.email || null;

  const primary =
    q.isError ? "Google account" : (name ?? email ?? "Google account");
  const secondary = q.isError
    ? "Couldn't load profile"
    : name && email
      ? email
      : null;

  return (
    <li className="group/row flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/30">
      <Avatar className="size-7">
        <AvatarImage
          src={profile?.picture ?? undefined}
          alt=""
          className="object-cover"
        />
        <AvatarFallback className="bg-muted text-[10px] text-muted-foreground">
          {getInitials(name, email)}
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
