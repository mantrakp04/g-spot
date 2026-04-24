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
import { useState } from "react";
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
  onReconnect: (email: string | null) => Promise<void>;
  onRemove: (email: string | null) => Promise<void>;
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
      return status === "running" || status === "paused" || status === "interrupted"
        ? 1500
        : false;
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
      return status === "running" || status === "paused" || status === "interrupted"
        ? 1500
        : false;
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

  async function handleRemove() {
    setRemoving(true);
    try {
      await onRemove(q.data?.email ?? null);
    } finally {
      setRemoving(false);
    }
  }

  async function handleReconnect() {
    setReconnecting(true);
    try {
      await onReconnect(q.data?.email ?? null);
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
  const failedThreadCount = syncFailures.data?.length ?? 0;
  const syncAction = getSyncAction(syncData, failedThreadCount);
  const showSyncProgress = Boolean(
    syncData
      && (isSyncing
        || syncData.status === "paused"
        || syncData.status === "interrupted"
        || failedThreadCount > 0),
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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "size-6 text-muted-foreground hover:text-foreground",
              isSyncing && "hover:text-destructive",
            )}
            onClick={() => {
              if (syncAction.kind === "cancel") {
                cancelSyncMutation.mutate();
              } else {
                startSyncMutation.mutate(syncAction.intent);
              }
            }}
            disabled={startSyncMutation.isPending || cancelSyncMutation.isPending}
            title={syncAction.label}
          >
            {startSyncMutation.isPending || cancelSyncMutation.isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : syncAction.icon === "retry" ? (
              <RotateCcw className="size-3" strokeWidth={2} />
            ) : syncAction.icon === "cancel" ? (
              <X className="size-3" strokeWidth={2.5} />
            ) : (
              <Download className="size-3" strokeWidth={2} />
            )}
          </Button>
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
          statusLabel={getSyncStatusLabel(syncData)}
          mailTotal={syncData.mail.totalThreads}
          mailSynced={syncData.mail.syncedThreads}
          inboxTotal={syncData.extraction.totalInboxThreads}
          inboxAnalyzed={syncData.extraction.analyzedInboxThreads}
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
    </li>
  );
}

function SyncProgressBar({
  statusLabel,
  mailTotal,
  mailSynced,
  inboxTotal,
  inboxAnalyzed,
  fetchFailed,
  processFailed,
}: {
  statusLabel: string;
  mailTotal: number;
  mailSynced: number;
  inboxTotal: number;
  inboxAnalyzed: number;
  fetchFailed: number;
  processFailed: number;
}) {
  return (
    <div className="mt-2 ml-10 space-y-2">
      <p className="text-[10px] text-muted-foreground">{statusLabel}</p>
      <PhaseBar
        label="Mail"
        total={mailTotal}
        done={mailSynced}
        failed={fetchFailed}
        doneClass="bg-blue-500/70"
        doneText="text-blue-400"
      />
      <PhaseBar
        label="Inbox analysis"
        total={inboxTotal}
        done={inboxAnalyzed}
        failed={processFailed}
        doneClass="bg-emerald-500/70"
        doneText="text-emerald-400"
      />
    </div>
  );
}

type SyncProgressData = NonNullable<
  Awaited<ReturnType<typeof trpcClient.gmailSync.getSyncProgress.query>>
>;

function getSyncAction(
  syncData: SyncProgressData | null | undefined,
  failedThreadCount: number,
):
  | { kind: "cancel"; icon: "cancel"; label: string }
  | { kind: "start"; icon: "download" | "retry"; intent: "auto" | "retry_failed"; label: string } {
  if (syncData?.status === "running") {
    return { kind: "cancel", icon: "cancel", label: "Cancel sync" };
  }
  if (syncData?.status === "error") {
    return { kind: "start", icon: "retry", intent: "auto", label: "Retry sync" };
  }
  if (failedThreadCount > 0 && syncData?.status !== "paused" && syncData?.status !== "interrupted") {
    return {
      kind: "start",
      icon: "retry",
      intent: "retry_failed",
      label: `Retry ${failedThreadCount} failed`,
    };
  }
  if (syncData?.status === "paused") {
    return { kind: "start", icon: "download", intent: "auto", label: "Resume sync" };
  }
  if (syncData?.status === "interrupted") {
    return { kind: "start", icon: "download", intent: "auto", label: "Resume interrupted sync" };
  }
  return { kind: "start", icon: "download", intent: "auto", label: "Sync" };
}

function getSyncStatusLabel(syncData: SyncProgressData): string {
  if (syncData.status === "running") {
    return syncData.phase === "extracting" ? "Analyzing inbox" : "Syncing mail";
  }
  if (syncData.status === "paused") return "Paused";
  if (syncData.status === "interrupted") return "Interrupted";
  if (syncData.status === "error") return "Needs attention";
  if (syncData.status === "completed") return "Synced";
  return "Not synced";
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
