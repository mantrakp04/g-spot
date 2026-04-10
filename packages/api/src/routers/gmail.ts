import { z } from "zod";

import {
  getGmailAccount,
  getLabels,
  getMessageAttachments,
  getThread,
  getThreadMessages,
  listThreads,
  searchThreads,
} from "@g-spot/db/gmail";

import { authedProcedure, router } from "../index";

export const gmailRouter = router({
  /**
   * List threads from local DB, paginated and optionally filtered by label.
   */
  getThreads: authedProcedure
    .input(
      z.object({
        providerAccountId: z.string(),
        label: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
        cursor: z.string().nullable().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const account = await getGmailAccount(
        ctx.userId,
        input.providerAccountId,
      );
      if (!account) return { threads: [], nextCursor: null };

      return listThreads(account.id, {
        label: input.label,
        limit: input.limit,
        cursor: input.cursor ?? undefined,
      });
    }),

  /**
   * Get a single thread with all messages and attachments.
   */
  getThread: authedProcedure
    .input(
      z.object({
        providerAccountId: z.string(),
        gmailThreadId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const account = await getGmailAccount(
        ctx.userId,
        input.providerAccountId,
      );
      if (!account) return null;

      const thread = await getThread(account.id, input.gmailThreadId);
      if (!thread) return null;

      const messages = await getThreadMessages(thread.id);

      // Get attachments for each message
      const messagesWithAttachments = await Promise.all(
        messages.map(async (msg) => {
          const attachments = await getMessageAttachments(msg.id);
          return { ...msg, attachments };
        }),
      );

      return {
        ...thread,
        messages: messagesWithAttachments,
      };
    }),

  /**
   * Get all labels for an account.
   */
  getLabels: authedProcedure
    .input(z.object({ providerAccountId: z.string() }))
    .query(async ({ ctx, input }) => {
      const account = await getGmailAccount(
        ctx.userId,
        input.providerAccountId,
      );
      if (!account) return [];
      return getLabels(account.id);
    }),

  /**
   * Search threads by content (subject, body text, sender).
   */
  searchThreads: authedProcedure
    .input(
      z.object({
        providerAccountId: z.string(),
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const account = await getGmailAccount(
        ctx.userId,
        input.providerAccountId,
      );
      if (!account) return [];
      return searchThreads(account.id, input.query, input.limit);
    }),
});
