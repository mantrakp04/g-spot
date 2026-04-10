import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@g-spot/ui/components/avatar";
import { Button } from "@g-spot/ui/components/button";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import { cn } from "@g-spot/ui/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { OAuthConnection } from "@stackframe/react";
import { Download, Loader2, RefreshCw, X } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { useGoogleProfile } from "@/hooks/use-gmail-options";
import { getInitials, getOAuthToken } from "@/lib/oauth";
import { trpcClient } from "@/utils/trpc";

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

  // ----- Sync state -----
  const syncProgress = useQuery({
    queryKey: ["gmail-sync", "progress", account.providerAccountId],
    queryFn: () =>
      trpcClient.gmailSync.getSyncProgress.query({
        providerAccountId: account.providerAccountId,
      }),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "paused" ? 1500 : false;
    },
  });

  const startSyncMutation = useMutation({
    mutationFn: async (mode: "full" | "incremental") => {
      const token = await getOAuthToken(account);
      return trpcClient.gmailSync.startSync.mutate({
        providerAccountId: account.providerAccountId,
        accessToken: token,
        mode,
      });
    },
    onSuccess: () => {
      toast.success("Gmail sync started");
      syncProgress.refetch();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to start sync");
    },
  });

  const cancelSyncMutation = useMutation({
    mutationFn: () =>
      trpcClient.gmailSync.cancelSync.mutate({
        providerAccountId: account.providerAccountId,
      }),
    onSuccess: () => {
      toast.info("Sync cancelled");
      syncProgress.refetch();
    },
  });

  const handleSync = useCallback(() => {
    // Use incremental if we've synced before, full otherwise
    const hasHistory = syncProgress.data?.status === "completed";
    startSyncMutation.mutate(hasHistory ? "incremental" : "full");
  }, [syncProgress.data, startSyncMutation]);

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
      <li className="flex items-center gap-3 px-4 py-2.5">
        <Skeleton className="size-7 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-1">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-2.5 w-40" />
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

  const isSyncing = syncProgress.data?.status === "running";
  const syncData = syncProgress.data;

  return (
    <li className="group/row px-4 py-2.5 transition-colors hover:bg-muted/30">
      <div className="flex items-center gap-3">
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
        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5 transition-opacity",
            !isSyncing && "opacity-0 group-hover/row:opacity-100",
          )}
        >
          {isSyncing ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-destructive"
              onClick={() => cancelSyncMutation.mutate()}
              title="Cancel sync"
            >
              <X className="size-3" strokeWidth={2.5} />
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={handleSync}
              disabled={startSyncMutation.isPending}
              title={
                syncData?.status === "completed"
                  ? "Sync new emails"
                  : "Sync all emails"
              }
            >
              {startSyncMutation.isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Download className="size-3" strokeWidth={2} />
              )}
            </Button>
          )}
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
      </div>

      {/* Sync progress bar */}
      {isSyncing && syncData && (
        <SyncProgressBar
          total={syncData.totalThreads}
          fetched={syncData.fetchedThreads}
          processed={syncData.processedThreads}
          failed={syncData.failedThreads}
        />
      )}

      {/* Sync error */}
      {syncData?.status === "error" && syncData.error && (
        <div className="mt-1.5 ml-10 rounded-sm border border-destructive/20 bg-destructive/5 px-2 py-1">
          <p className="text-[10px] text-destructive">{syncData.error}</p>
        </div>
      )}
    </li>
  );
}

function SyncProgressBar({
  total,
  fetched,
  processed,
  failed,
}: {
  total: number;
  fetched: number;
  processed: number;
  failed: number;
}) {
  const fetchPct = total > 0 ? (fetched / total) * 100 : 0;
  const processPct = total > 0 ? (processed / total) * 100 : 0;

  return (
    <div className="mt-2 ml-10 space-y-1">
      {/* Progress bar */}
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted/50">
        {/* Processed (complete) */}
        <div
          className="h-full bg-emerald-500/70 transition-all duration-500"
          style={{ width: `${processPct}%` }}
        />
        {/* Fetched but not yet processed */}
        <div
          className="h-full bg-blue-500/50 transition-all duration-500"
          style={{ width: `${Math.max(0, fetchPct - processPct)}%` }}
        />
        {/* Failed */}
        {failed > 0 && (
          <div
            className="h-full bg-destructive/50 transition-all duration-500"
            style={{ width: `${(failed / total) * 100}%` }}
          />
        )}
      </div>

      {/* Stats */}
      <div className="flex items-center gap-2 text-[10px] tabular-nums text-muted-foreground">
        <span>
          <span className="text-emerald-400">{processed}</span>
          {" / "}
          {total} processed
        </span>
        <span className="text-muted-foreground/30">|</span>
        <span>
          <span className="text-blue-400">{fetched}</span> fetched
        </span>
        {failed > 0 && (
          <>
            <span className="text-muted-foreground/30">|</span>
            <span className="text-destructive">{failed} failed</span>
          </>
        )}
      </div>
    </div>
  );
}
