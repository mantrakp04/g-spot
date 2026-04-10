import { z } from "zod";

import {
  getGmailAccount,
  getSyncState,
  getUnresolvedFailures,
  upsertGmailAccount,
} from "@g-spot/db/gmail";

import { authedProcedure, router } from "../index";
import {
  cancelSync,
  getActiveSync,
  retryFailedThreads,
  startSync,
} from "../lib/gmail-sync";
import { getProfile } from "../lib/gmail-client";

export const gmailSyncRouter = router({
  /**
   * Start a Gmail sync. Client passes the OAuth access token.
   */
  startSync: authedProcedure
    .input(
      z.object({
        providerAccountId: z.string(),
        accessToken: z.string(),
        mode: z.enum(["full", "incremental"]).default("incremental"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Ensure account exists
      const profile = await getProfile(input.accessToken);
      const { id: accountId } = await upsertGmailAccount(ctx.userId, {
        email: profile.emailAddress,
        providerAccountId: input.providerAccountId,
      });

      const orch = startSync(
        ctx.userId,
        accountId,
        input.accessToken,
        input.mode,
      );

      return { accountId, progress: orch.getProgress() };
    }),

  /**
   * Get current sync progress.
   */
  getSyncProgress: authedProcedure
    .input(z.object({ providerAccountId: z.string() }))
    .query(async ({ ctx, input }) => {
      const account = await getGmailAccount(
        ctx.userId,
        input.providerAccountId,
      );
      if (!account) return null;

      // Try in-memory first (active sync)
      const active = getActiveSync(ctx.userId, account.id);
      if (active) return active.getProgress();

      // Fall back to DB state
      const dbState = await getSyncState(account.id);
      if (!dbState) return null;

      return {
        status: dbState.status,
        mode: dbState.mode,
        totalThreads: dbState.totalThreads,
        fetchedThreads: dbState.fetchedThreads,
        processedThreads: dbState.processedThreads,
        failedThreads: dbState.failedThreads,
        startedAt: dbState.startedAt,
        error: dbState.lastError,
      };
    }),

  /**
   * Cancel a running sync.
   */
  cancelSync: authedProcedure
    .input(z.object({ providerAccountId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const account = await getGmailAccount(
        ctx.userId,
        input.providerAccountId,
      );
      if (!account) return { cancelled: false };
      return { cancelled: cancelSync(ctx.userId, account.id) };
    }),

  /**
   * Get unresolved sync failures for an account.
   */
  getFailures: authedProcedure
    .input(z.object({ providerAccountId: z.string() }))
    .query(async ({ ctx, input }) => {
      const account = await getGmailAccount(
        ctx.userId,
        input.providerAccountId,
      );
      if (!account) return [];
      return getUnresolvedFailures(account.id);
    }),

  /**
   * Retry failed sync items. Optionally pass specific failure IDs,
   * or omit to retry all unresolved failures for the account.
   */
  retryFailed: authedProcedure
    .input(
      z.object({
        providerAccountId: z.string(),
        accessToken: z.string(),
        failureIds: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const account = await getGmailAccount(
        ctx.userId,
        input.providerAccountId,
      );
      if (!account) {
        throw new Error("Gmail account not found");
      }

      return retryFailedThreads(
        ctx.userId,
        account.id,
        input.accessToken,
        input.failureIds,
      );
    }),
});
