import { z } from "zod";

import {
  getGmailAccount,
  getGmailThreadStats,
  getSyncState,
  upsertGmailAccount,
} from "@g-spot/db/gmail";

import { publicProcedure, router } from "../index";
import {
  cancelSync,
  getActiveSync,
  syncStartIntents,
  startSync,
} from "../lib/gmail-sync";
import {
  cancelGmailExtraction,
  getActiveGmailExtraction,
  startGmailExtraction,
} from "../lib/gmail-extraction";
import { getProfile } from "../lib/gmail-client";

type SyncProgressResponse = {
  status: "idle" | "running" | "paused" | "interrupted" | "completed" | "error";
  phase: "fetching" | "extracting" | null;
  mode: "full" | "incremental" | null;
  mail: {
    totalThreads: number;
    syncedThreads: number;
    failedThreads: number;
  };
  extraction: {
    totalInboxThreads: number;
    analyzedInboxThreads: number;
    failedInboxThreads: number;
    remainingInboxThreads: number;
  };
  account: {
    hasCompletedFullSync: boolean;
    hasCompletedIncrementalSync: boolean;
    needsFullResync: boolean;
  };
  local: {
    totalThreads: number;
    inboxThreads: number;
    unprocessedInboxThreads: number;
  };
  startedAt: string | null;
  error: string | null;
};

function toSyncProgressResponse(input: {
  status: string;
  mode: string | null;
  totalThreads: number;
  fetchedThreads: number;
  processableThreads: number;
  processedThreads: number;
  failedThreads: number;
  startedAt: string | null;
  error: string | null;
  account: {
    lastFullSyncAt: string | null;
    lastIncrementalSyncAt: string | null;
    needsFullResync: boolean;
  };
  local: {
    totalThreads: number;
    inboxThreads: number;
    unprocessedInboxThreads: number;
  };
}): SyncProgressResponse {
  const status = isSyncStatus(input.status) ? input.status : "idle";
  const phase =
    status === "running"
      ? input.totalThreads === 0 && input.processableThreads > 0
        ? "extracting"
        : "fetching"
      : null;
  const analyzedInboxThreads = input.processedThreads;
  const remainingInboxThreads = input.local.unprocessedInboxThreads > 0
    ? input.local.unprocessedInboxThreads
    : Math.max(0, input.processableThreads - input.processedThreads);

  return {
    status,
    phase,
    mode: input.mode === "full" || input.mode === "incremental" ? input.mode : null,
    mail: {
      totalThreads: input.totalThreads,
      syncedThreads: input.fetchedThreads,
      failedThreads: phase === "fetching" ? input.failedThreads : 0,
    },
    extraction: {
      totalInboxThreads: input.processableThreads,
      analyzedInboxThreads,
      failedInboxThreads: phase === "extracting" ? input.failedThreads : 0,
      remainingInboxThreads,
    },
    account: {
      hasCompletedFullSync: Boolean(input.account.lastFullSyncAt),
      hasCompletedIncrementalSync: Boolean(input.account.lastIncrementalSyncAt),
      needsFullResync: input.account.needsFullResync,
    },
    local: input.local,
    startedAt: input.startedAt,
    error: input.error,
  };
}

async function getProgressContext(account: {
  id: string;
  lastFullSyncAt: string | null;
  lastIncrementalSyncAt: string | null;
  needsFullResync: boolean;
}) {
  return {
    account: {
      lastFullSyncAt: account.lastFullSyncAt,
      lastIncrementalSyncAt: account.lastIncrementalSyncAt,
      needsFullResync: account.needsFullResync,
    },
    local: await getGmailThreadStats(account.id),
  };
}

function getAccountProgressContext(account: {
  lastFullSyncAt: string | null;
  lastIncrementalSyncAt: string | null;
  needsFullResync: boolean;
}) {
  return {
    account: {
      lastFullSyncAt: account.lastFullSyncAt,
      lastIncrementalSyncAt: account.lastIncrementalSyncAt,
      needsFullResync: account.needsFullResync,
    },
    local: {
      totalThreads: 0,
      inboxThreads: 0,
      unprocessedInboxThreads: 0,
    },
  };
}

function isSyncStatus(value: string): value is SyncProgressResponse["status"] {
  return (
    value === "idle"
    || value === "running"
    || value === "paused"
    || value === "interrupted"
    || value === "completed"
    || value === "error"
  );
}

export const gmailSyncRouter = router({
  /**
   * Start a Gmail sync.
   */
  startSync: publicProcedure
    .input(
      z.object({
        providerAccountId: z.string(),
        accessToken: z.string().min(1),
        intent: z.enum(syncStartIntents).default("auto"),
      }),
    )
    .mutation(async ({ input }) => {
      const existingAccount = await getGmailAccount(
        input.providerAccountId,
      );
      let accountId = existingAccount?.id;
      let initialProfile: Awaited<ReturnType<typeof getProfile>> | null = null;

      if (!accountId) {
        const profile = await getProfile(input.accessToken);
        initialProfile = profile;
        accountId = (
          await upsertGmailAccount({
            email: profile.emailAddress,
            providerAccountId: input.providerAccountId,
            historyId: profile.historyId,
          })
        ).id;
      }

      const sync = await startSync(
        accountId,
        input.accessToken,
        input.intent,
        initialProfile,
      );
      const account = existingAccount ?? await getGmailAccount(input.providerAccountId);
      const context = account
        ? await getProgressContext(account)
        : {
          account: {
            lastFullSyncAt: null,
            lastIncrementalSyncAt: null,
            needsFullResync: false,
          },
          local: {
            totalThreads: 0,
            inboxThreads: 0,
            unprocessedInboxThreads: 0,
          },
        };

      return {
        accountId,
        started: sync.started,
        progress: toSyncProgressResponse({
          ...sync.orchestrator.getProgress(),
          ...context,
        }),
      };
    }),

  /**
   * Start Gmail inbox analysis.
   */
  startExtraction: publicProcedure
    .input(z.object({ providerAccountId: z.string() }))
    .mutation(async ({ input }) => {
      const account = await getGmailAccount(input.providerAccountId);
      if (!account) {
        throw new Error("Gmail account has not been synced yet");
      }
      if (getActiveSync(account.id)) {
        throw new Error("Gmail sync is in progress for this account");
      }

      const orch = await startGmailExtraction(account.id);
      const context = await getProgressContext(account);

      return {
        accountId: account.id,
        progress: toSyncProgressResponse({
          status: orch.getProgress().status,
          mode: null,
          totalThreads: 0,
          fetchedThreads: 0,
          processableThreads: orch.getProgress().totalThreads,
          processedThreads: orch.getProgress().processedThreads,
          failedThreads: orch.getProgress().failedThreads,
          startedAt: orch.getProgress().startedAt,
          error: orch.getProgress().error,
          ...context,
        }),
      };
    }),

  /**
   * Get current sync progress.
   */
  getSyncProgress: publicProcedure
    .input(z.object({ providerAccountId: z.string() }))
    .query(async ({ input }) => {
      const account = await getGmailAccount(input.providerAccountId);
      if (!account) return null;

      // Try in-memory first (active sync)
      const active = getActiveSync(account.id);
      if (active) {
        return toSyncProgressResponse({
          ...active.getProgress(),
          ...getAccountProgressContext(account),
        });
      }
      const activeExtraction = getActiveGmailExtraction(account.id);
      if (activeExtraction) {
        const progress = activeExtraction.getProgress();
        return toSyncProgressResponse({
          status: progress.status,
          mode: null,
          totalThreads: 0,
          fetchedThreads: 0,
          processableThreads: progress.totalThreads,
          processedThreads: progress.processedThreads,
          failedThreads: progress.failedThreads,
          startedAt: progress.startedAt,
          error: progress.error,
          ...getAccountProgressContext(account),
        });
      }

      // Fall back to DB state
      const context = await getProgressContext(account);
      const dbState = await getSyncState(account.id);
      if (!dbState) return null;

      return toSyncProgressResponse({
        status: dbState.status,
        mode: dbState.mode,
        totalThreads: dbState.totalThreads,
        fetchedThreads: dbState.fetchedThreads,
        processableThreads: dbState.processableThreads,
        processedThreads: dbState.processedThreads,
        failedThreads: dbState.failedThreads,
        startedAt: dbState.startedAt,
        error: dbState.lastError,
        ...context,
      });
    }),

  /**
   * Cancel a running sync.
   */
  cancelSync: publicProcedure
    .input(z.object({ providerAccountId: z.string() }))
    .mutation(async ({ input }) => {
      const account = await getGmailAccount(input.providerAccountId);
      if (!account) return { cancelled: false };
      if (getActiveSync(account.id)) {
        return { cancelled: await cancelSync(account.id) };
      }
      if (getActiveGmailExtraction(account.id)) {
        return { cancelled: await cancelGmailExtraction(account.id) };
      }
      return { cancelled: await cancelSync(account.id) };
    }),

});
