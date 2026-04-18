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
import { Download, Loader2, RefreshCw, RotateCcw, X } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { useGoogleProfile } from "@/hooks/use-gmail-options";
import { getInitials } from "@/lib/initials";
import { trpcClient } from "@/utils/trpc";

export function GoogleAccountRow({
  account,
  onReconnect,
  onRemove,
}: {
  account: OAuthConnection;
  onReconnect: () => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [removing, setRemoving] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
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

  const syncFailures = useQuery({
    queryKey: ["gmail-sync", "failures", account.providerAccountId],
    queryFn: () =>
      trpcClient.gmailSync.getFailures.query({
        providerAccountId: account.providerAccountId,
      }),
    refetchInterval: () => {
      const status = syncProgress.data?.status;
      return status === "running" || status === "paused" ? 1500 : false;
    },
  });

  const startSyncMutation = useMutation({
    mutationFn: (intent: "auto" | "retry_failed") =>
      trpcClient.gmailSync.startSync.mutate({
        providerAccountId: account.providerAccountId,
        intent,
      }),
    onSuccess: () => {
      toast.success("Gmail sync started");
      syncProgress.refetch();
      syncFailures.refetch();
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
      syncFailures.refetch();
    },
  });

  const handleSync = useCallback(() => {
    startSyncMutation.mutate("auto");
  }, [startSyncMutation]);

  const handleRetry = useCallback(() => {
    startSyncMutation.mutate("retry_failed");
  }, [startSyncMutation]);

  async function handleRemove() {
    setRemoving(true);
    try {
      await onRemove();
    } finally {
      setRemoving(false);
    }
  }

  async function handleReconnect() {
    setReconnecting(true);
    try {
      await onReconnect();
    } finally {
      setReconnecting(false);
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
  const showSyncProgress = Boolean(
    syncData
      && (isSyncing
        || syncData.status === "paused"
        || syncData.failedThreads > 0),
  );
  const failureSummary = summarizeFailures(syncFailures.data ?? []);
  const latestFailure = syncFailures.data?.[0] ?? null;
  const { fetchFailed, processFailed } = countFailuresByPhase(
    syncFailures.data ?? [],
  );

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
          {!isSyncing && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={handleSync}
              disabled={startSyncMutation.isPending}
              title={
                syncData?.status === "paused"
                  ? "Resume sync"
                  : "Start sync"
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
            onClick={() => void handleReconnect()}
            disabled={reconnecting}
            title="Reconnect"
          >
            <RefreshCw
              className={cn("size-3", reconnecting && "animate-spin")}
              strokeWidth={2}
            />
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
      {showSyncProgress && syncData && (
        <SyncProgressBar
          total={syncData.totalThreads}
          fetched={syncData.fetchedThreads}
          processed={syncData.processedThreads}
          fetchFailed={fetchFailed}
          processFailed={processFailed}
        />
      )}

      {/* Sync error */}
      {syncData?.status === "error" && syncData.error && (
        <div className="mt-1.5 ml-10 rounded-sm border border-destructive/20 bg-destructive/5 px-2 py-1">
          <p className="text-[10px] text-destructive">{syncData.error}</p>
        </div>
      )}

      {failureSummary && (
        <div className="mt-1.5 ml-10 rounded-sm border border-amber-500/20 bg-amber-500/5 px-2 py-1">
          <p className="text-[10px] text-amber-300">
            Failed stages: {failureSummary}
          </p>
          {latestFailure && (
            <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">
              Latest: {formatFailureStage(latestFailure.stage)} failed: {latestFailure.errorMessage}
            </p>
          )}
        </div>
      )}

      {/* Cancel / retry */}
      {isSyncing ? (
        <div className="mt-1.5 ml-10 flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto gap-1 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-destructive"
            onClick={() => cancelSyncMutation.mutate()}
            disabled={cancelSyncMutation.isPending}
          >
            <X className="size-3" strokeWidth={2.5} />
            Cancel sync
          </Button>
        </div>
      ) : (
        syncData && syncData.status !== "paused" && syncData.failedThreads > 0 && (
          <div className="mt-1.5 ml-10 flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto gap-1 px-1.5 py-0.5 text-[11px] text-amber-400 hover:text-amber-300"
              onClick={handleRetry}
              disabled={startSyncMutation.isPending}
            >
              <RotateCcw
                className={cn("size-3", startSyncMutation.isPending && "animate-spin")}
              />
              {`Retry ${syncData.failedThreads} failed`}
            </Button>
          </div>
        )
      )}
    </li>
  );
}

function SyncProgressBar({
  total,
  fetched,
  processed,
  fetchFailed,
  processFailed,
}: {
  total: number;
  fetched: number;
  processed: number;
  fetchFailed: number;
  processFailed: number;
}) {
  return (
    <div className="mt-2 ml-10 space-y-2">
      <PhaseBar
        label="Fetch"
        total={total}
        done={fetched}
        failed={fetchFailed}
        doneClass="bg-blue-500/70"
        doneText="text-blue-400"
      />
      <PhaseBar
        label="Process"
        total={total}
        done={processed}
        failed={processFailed}
        doneClass="bg-emerald-500/70"
        doneText="text-emerald-400"
      />
    </div>
  );
}

function PhaseBar({
  label,
  total,
  done,
  failed,
  doneClass,
  doneText,
}: {
  label: string;
  total: number;
  done: number;
  failed: number;
  doneClass: string;
  doneText: string;
}) {
  const donePct = total > 0 ? (done / total) * 100 : 0;
  const failedPct = total > 0 ? (failed / total) * 100 : 0;

  return (
    <div className="space-y-1">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted/50">
        <div
          className={cn("h-full transition-all duration-500", doneClass)}
          style={{ width: `${donePct}%` }}
        />
        {failed > 0 && (
          <div
            className="h-full bg-destructive/50 transition-all duration-500"
            style={{ width: `${failedPct}%` }}
          />
        )}
      </div>
      <div className="flex items-center gap-2 text-[10px] tabular-nums text-muted-foreground">
        <span className="text-muted-foreground/70">{label}</span>
        <span>
          <span className={doneText}>{done}</span>
          {" / "}
          {total}
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

function countFailuresByPhase(failures: Array<{ stage: string }>) {
  let fetchFailed = 0;
  let processFailed = 0;
  for (const failure of failures) {
    if (failure.stage === "fetch") fetchFailed++;
    else processFailed++;
  }
  return { fetchFailed, processFailed };
}

function formatFailureStage(stage: string) {
  switch (stage) {
    case "fetch":
      return "Fetch";
    case "extract":
      return "Extract";
    case "resolve":
      return "Resolve";
    case "ingest":
      return "Ingest";
    default:
      return stage;
  }
}

function summarizeFailures(
  failures: Array<{ stage: string }>,
) {
  if (failures.length === 0) return null;

  const counts = new Map<string, number>();
  for (const failure of failures) {
    counts.set(failure.stage, (counts.get(failure.stage) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([stage, count]) => `${count} ${formatFailureStage(stage).toLowerCase()}`)
    .join(", ");
}
