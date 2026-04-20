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
import { getStackConnectedAccountAccessToken } from "../lib/stack-server";

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
      const accessToken = await getStackConnectedAccountAccessToken(
        ctx.stackAuthHeaders,
        "google",
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

      return { accountId, progress: orch.getProgress() };
    }),

  /**
   * Get current sync progress.
   */
  getSyncProgress: publicProcedure
    .input(z.object({ providerAccountId: z.string() }))
    .query(async ({ input }) => {
      const account = await getGmailAccount(
        input.providerAccountId,
      );
      if (!account) return null;

      // Try in-memory first (active sync)
      const active = getActiveSync(account.id);
      if (active) return active.getProgress();

      // Fall back to DB state
      const dbState = await getSyncState(account.id);
      if (!dbState) return null;

      return {
        status: dbState.status,
        mode: dbState.mode,
        totalThreads: dbState.totalThreads,
        fetchedThreads: dbState.fetchedThreads,
        processableThreads: dbState.processableThreads,
        processedThreads: dbState.processedThreads,
        failedThreads: dbState.failedThreads,
        startedAt: dbState.startedAt,
        error: dbState.lastError,
      };
    }),

  /**
   * Cancel a running sync.
   */
  cancelSync: publicProcedure
    .input(z.object({ providerAccountId: z.string() }))
    .mutation(async ({ input }) => {
      const account = await getGmailAccount(
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
    .query(async ({ input }) => {
      const account = await getGmailAccount(
        input.providerAccountId,
      );
      if (!account) return [];
      return getRetryableSyncFailures(account.id);
    }),

});
