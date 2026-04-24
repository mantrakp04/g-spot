import { z } from "zod";

import {
  getGmailAccount,
  getSyncState,
  getRetryableSyncFailures,
  upsertGmailAccount,
} from "@g-spot/db/gmail";

import { publicProcedure, router } from "../index";
import {
  cancelSync,
  getActiveSync,
  syncStartIntents,
  startSync,
} from "../lib/gmail-sync";
import { getProfile } from "../lib/gmail-client";
import {
  getStackConnectedAccountAccessToken,
  type StackAuthHeaders,
} from "../lib/stack-server";

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
  };
  startedAt: string | null;
  error: string | null;
};

async function getOwnedGoogleAccessToken(
  authHeaders: StackAuthHeaders,
  providerAccountId: string,
): Promise<string> {
  return getStackConnectedAccountAccessToken(
    authHeaders,
    "google",
    providerAccountId,
  );
}

async function getOwnedGmailAccount(
  authHeaders: StackAuthHeaders,
  providerAccountId: string,
) {
  await getOwnedGoogleAccessToken(authHeaders, providerAccountId);
  return getGmailAccount(providerAccountId);
}

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
}): SyncProgressResponse {
  const status = isSyncStatus(input.status) ? input.status : "idle";
  const fetchFailed = Math.max(
    0,
    input.failedThreads - Math.max(0, input.processableThreads - input.processedThreads),
  );
  const failedInboxThreads = Math.max(0, input.failedThreads - fetchFailed);
  const phase =
    status === "running"
      ? input.fetchedThreads < input.totalThreads
        ? "fetching"
        : "extracting"
      : null;

  return {
    status,
    phase,
    mode: input.mode === "full" || input.mode === "incremental" ? input.mode : null,
    mail: {
      totalThreads: input.totalThreads,
      syncedThreads: input.fetchedThreads,
      failedThreads: fetchFailed,
    },
    extraction: {
      totalInboxThreads: input.processableThreads,
      analyzedInboxThreads: input.processedThreads,
      failedInboxThreads,
    },
    startedAt: input.startedAt,
    error: input.error,
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
        intent: z.enum(syncStartIntents).default("auto"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const accessToken = await getOwnedGoogleAccessToken(
        ctx.stackAuthHeaders,
        input.providerAccountId,
      );

      const existingAccount = await getGmailAccount(
        input.providerAccountId,
      );
      let accountId = existingAccount?.id;

      if (!accountId) {
        const profile = await getProfile(accessToken);
        accountId = (
          await upsertGmailAccount({
            email: profile.emailAddress,
            providerAccountId: input.providerAccountId,
            historyId: profile.historyId,
          })
        ).id;
      }

      const orch = await startSync(
        accountId,
        accessToken,
        input.intent,
      );

      return {
        accountId,
        progress: toSyncProgressResponse(orch.getProgress()),
      };
    }),

  /**
   * Get current sync progress.
   */
  getSyncProgress: publicProcedure
    .input(z.object({ providerAccountId: z.string() }))
    .query(async ({ ctx, input }) => {
      const account = await getOwnedGmailAccount(
        ctx.stackAuthHeaders,
        input.providerAccountId,
      );
      if (!account) return null;

      // Try in-memory first (active sync)
      const active = getActiveSync(account.id);
      if (active) return toSyncProgressResponse(active.getProgress());

      // Fall back to DB state
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
      });
    }),

  /**
   * Cancel a running sync.
   */
  cancelSync: publicProcedure
    .input(z.object({ providerAccountId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const account = await getOwnedGmailAccount(
        ctx.stackAuthHeaders,
        input.providerAccountId,
      );
      if (!account) return { cancelled: false };
      return { cancelled: await cancelSync(account.id) };
    }),

  /**
   * Get unresolved sync failures for an account.
   */
  getFailures: publicProcedure
    .input(z.object({ providerAccountId: z.string() }))
    .query(async ({ ctx, input }) => {
      const account = await getOwnedGmailAccount(
        ctx.stackAuthHeaders,
        input.providerAccountId,
      );
      if (!account) return [];
      return getRetryableSyncFailures(account.id);
    }),

});
