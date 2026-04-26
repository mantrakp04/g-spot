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
import { getGoogleAccessToken } from "@/lib/gmail/client-api";
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
      return status === "running" ? 1500 : false;
    },
  });

  const startSyncMutation = useMutation({
    mutationFn: async (intent: SyncIntent) => {
      const accessToken = await getGoogleAccessToken(account);
      return trpcClient.gmailSync.startSync.mutate({
        providerAccountId: account.providerAccountId,
        accessToken,
        intent,
      });
    },
    onSuccess: (result) => {
      toast.success(result.started ? "Gmail sync started" : "Gmail is up to date");
      syncProgress.refetch();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to start sync");
    },
  });

  const startExtractionMutation = useMutation({
    mutationFn: () =>
      trpcClient.gmailSync.startExtraction.mutate({
        providerAccountId: account.providerAccountId,
      }),
    onSuccess: () => {
      toast.success("Inbox analysis started");
      syncProgress.refetch();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to start analysis");
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
  const remainingInboxAnalysis =
    syncData?.local.unprocessedInboxThreads
    ?? syncData?.extraction.remainingInboxThreads
    ?? 0;
  const showSyncControls = Boolean(syncData || !q.isError);

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
            "opacity-0 group-hover/row:opacity-100",
          )}
        >
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

      {showSyncControls && (
        <SyncControls
          syncData={syncData}
          isBusy={
            startSyncMutation.isPending
            || startExtractionMutation.isPending
            || cancelSyncMutation.isPending
          }
          isSyncing={isSyncing}
          remainingInboxAnalysis={remainingInboxAnalysis}
          onStartSync={(intent) => startSyncMutation.mutate(intent)}
          onStartExtraction={() => startExtractionMutation.mutate()}
          onCancel={() => cancelSyncMutation.mutate()}
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

type SyncIntent = "auto" | "full" | "incremental";

function SyncControls({
  syncData,
  isBusy,
  isSyncing,
  remainingInboxAnalysis,
  onStartSync,
  onStartExtraction,
  onCancel,
}: {
  syncData: SyncProgressData | null | undefined;
  isBusy: boolean;
  isSyncing: boolean;
  remainingInboxAnalysis: number;
  onStartSync: (intent: SyncIntent) => void;
  onStartExtraction: () => void;
  onCancel: () => void;
}) {
  const activeKind = getActiveOperation(syncData);
  const displayedActiveKind = activeKind ?? getPausedOperation(syncData);
  const isPaused = syncData?.status === "paused" || syncData?.status === "interrupted";
  const disableStart = isBusy || isSyncing;
  const localThreadCount = syncData?.local.totalThreads ?? 0;
  const inboxThreadCount = syncData?.local.inboxThreads ?? 0;
  const unprocessedInboxThreadCount =
    syncData?.local.unprocessedInboxThreads
    ?? syncData?.extraction.remainingInboxThreads
    ?? 0;
  const analyzedInboxThreadCount = Math.max(
    0,
    inboxThreadCount - unprocessedInboxThreadCount,
  );
  const showingFullRun = displayedActiveKind === "full" && syncData?.mode === "full";
  const showingIncrementalRun =
    displayedActiveKind === "incremental"
    && syncData?.mode === "incremental"
    && syncData.phase !== "extracting";

  return (
    <div className="mt-2 ml-10 space-y-1.5">
      <OperationRow
        title="Full sync"
        detail="All Gmail threads"
        tone="blue"
        total={showingFullRun ? syncData.mail.totalThreads : localThreadCount}
        done={showingFullRun ? syncData.mail.syncedThreads : localThreadCount}
        state={getOperationState("full", displayedActiveKind, syncData)}
        actionLabel={isPaused && syncData?.mode === "full" ? "Resume" : "Run"}
        actionIcon={isPaused && syncData?.mode === "full" ? "resume" : "start"}
        disabled={disableStart && displayedActiveKind !== "full"}
        busy={isBusy && displayedActiveKind === "full"}
        onAction={() => {
          if (displayedActiveKind === "full" && isSyncing) onCancel();
          else onStartSync(isPaused && syncData?.mode === "full" ? "auto" : "full");
        }}
      />
      <OperationRow
        title="Incremental sync"
        detail="Automatic changes"
        tone="amber"
        total={showingIncrementalRun ? syncData.mail.totalThreads : 0}
        done={showingIncrementalRun ? syncData.mail.syncedThreads : 0}
        state={getOperationState("incremental", displayedActiveKind, syncData)}
      />
      <OperationRow
        title="Inbox analysis"
        detail={`${remainingInboxAnalysis} remaining`}
        tone="emerald"
        total={inboxThreadCount}
        done={analyzedInboxThreadCount}
        state={getOperationState("extract", displayedActiveKind, syncData)}
        actionLabel={isPaused && displayedActiveKind === "extract" ? "Resume" : "Analyze"}
        actionIcon={isPaused && displayedActiveKind === "extract" ? "resume" : "start"}
        disabled={disableStart && displayedActiveKind !== "extract"}
        busy={isBusy && displayedActiveKind === "extract"}
        onAction={() => {
          if (displayedActiveKind === "extract" && isSyncing) onCancel();
          else onStartExtraction();
        }}
      />
    </div>
  );
}

type SyncProgressData = NonNullable<
  Awaited<ReturnType<typeof trpcClient.gmailSync.getSyncProgress.query>>
>;

type OperationKind = "full" | "incremental" | "extract";
type OperationState = "idle" | "running" | "paused" | "interrupted" | "completed" | "blocked";

function OperationRow({
  title,
  detail,
  tone,
  total,
  done,
  state,
  actionLabel,
  actionIcon,
  disabled,
  busy,
  onAction,
}: {
  title: string;
  detail: string;
  tone: "blue" | "amber" | "emerald";
  total: number;
  done: number;
  state: OperationState;
  actionLabel?: string;
  actionIcon?: "start" | "resume";
  disabled?: boolean;
  busy?: boolean;
  onAction?: () => void;
}) {
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  const remaining = Math.max(0, total - done);
  const isActive = state === "running";
  const showStop = isActive;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-border/50 bg-muted/15 px-2 py-1.5">
      <div className="min-w-0 space-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-[11px] text-foreground">
            {title}
          </span>
          <StatusPill state={state} />
          <span className="truncate text-[10px] text-muted-foreground">
            {detail}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-muted/50">
            <div
              className={cn(
                "h-full transition-all duration-500",
                tone === "blue" && "bg-blue-500/70",
                tone === "amber" && "bg-amber-500/70",
                tone === "emerald" && "bg-emerald-500/70",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
            <span
              className={cn(
                tone === "blue" && "text-blue-400",
                tone === "amber" && "text-amber-300",
                tone === "emerald" && "text-emerald-400",
              )}
            >
              {done}
            </span>
            {" / "}
            {total}
            {remaining > 0 && ` · ${remaining} left`}
          </span>
        </div>
      </div>
      {onAction ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-6 shrink-0 gap-1 px-2 text-[10px]",
            showStop && "text-destructive hover:text-destructive",
          )}
          disabled={disabled || busy}
          onClick={onAction}
        >
          {busy ? (
            <Loader2 className="size-3 animate-spin" />
          ) : showStop ? (
            <X className="size-3" strokeWidth={2.5} />
          ) : actionIcon === "resume" ? (
            <RotateCcw className="size-3" strokeWidth={2} />
          ) : (
            <Download className="size-3" strokeWidth={2} />
          )}
          {showStop ? "Stop" : actionLabel}
        </Button>
      ) : (
        <span className="shrink-0 px-2 text-[10px] text-muted-foreground">
          Auto
        </span>
      )}
    </div>
  );
}

function StatusPill({ state }: { state: OperationState }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-sm px-1 py-0.5 text-[9px] uppercase leading-none tracking-normal",
        state === "running" && "bg-blue-500/15 text-blue-300",
        state === "paused" && "bg-amber-500/15 text-amber-300",
        state === "interrupted" && "bg-amber-500/15 text-amber-300",
        state === "completed" && "bg-emerald-500/15 text-emerald-300",
        state === "blocked" && "bg-destructive/15 text-destructive",
        state === "idle" && "bg-muted text-muted-foreground",
      )}
    >
      {state}
    </span>
  );
}

function getActiveOperation(
  syncData: SyncProgressData | null | undefined,
): OperationKind | null {
  if (!syncData || syncData.status !== "running") return null;
  if (syncData.phase === "extracting") return "extract";
  return syncData.mode;
}

function getPausedOperation(
  syncData: SyncProgressData | null | undefined,
): OperationKind | null {
  if (
    !syncData
    || (syncData.status !== "paused" && syncData.status !== "interrupted")
  ) {
    return null;
  }
  if (
    syncData.mail.totalThreads === 0
    && (
      syncData.extraction.remainingInboxThreads > 0
      || syncData.local.unprocessedInboxThreads > 0
    )
  ) {
    return "extract";
  }
  return syncData.mode;
}

function getOperationState(
  kind: OperationKind,
  activeKind: OperationKind | null,
  syncData: SyncProgressData | null | undefined,
): OperationState {
  if (!syncData) return "idle";
  if (syncData.status === "error") return "blocked";
  if (activeKind === kind) {
    if (syncData.status === "paused" || syncData.status === "interrupted") {
      return syncData.status;
    }
    return "running";
  }
  if (
    (syncData.status === "paused" || syncData.status === "interrupted")
    && (
      syncData.mode === kind
      || (kind === "extract" && syncData.phase === "extracting")
    )
  ) {
    return syncData.status;
  }
  if (kind === "full") {
    return syncData.account.hasCompletedFullSync
      ? "completed"
      : "idle";
  }
  if (kind === "incremental") {
    return syncData.account.hasCompletedIncrementalSync
      ? "completed"
      : "idle";
  }
  return syncData.local.inboxThreads > 0
    && syncData.local.unprocessedInboxThreads === 0
    ? "completed"
    : "idle";
}
