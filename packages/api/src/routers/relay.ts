import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { z } from "zod";

import { publicProcedure, router } from "../index";
import {
  ensureRelayConnection,
  startGmailWatchDaemon,
  triggerPendingGmailNotificationSyncs,
} from "../lib/gmail";

const STACK_AUTH_HEADER = "x-stack-auth";
const PENDING_SYNC_THROTTLE_MS = 60_000;

const lastPendingSyncByAuthRef = new Map<string, number>();

function opaqueRef(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
}

async function triggerPendingGmailNotificationSyncsThrottled(authHeader: string) {
  const authRef = opaqueRef(authHeader);
  const lastRunAt = lastPendingSyncByAuthRef.get(authRef);
  if (lastRunAt && Date.now() - lastRunAt < PENDING_SYNC_THROTTLE_MS) {
    return;
  }

  lastPendingSyncByAuthRef.set(authRef, Date.now());
  await triggerPendingGmailNotificationSyncs(authHeader);
}

export const relayRouter = router({
  /**
   * Heartbeat from the browser. Carries the user's Stack Auth token in the
   * `x-stack-auth` request header (set by the tRPC client). The server uses
   * that token to (re)open a singleton WebSocket to the relay if needed.
   *
   * `forceReconnect` closes any existing relay WS so the next connection
   * re-runs the Stack auth handshake and re-discovers connected accounts.
   * The client schedules this periodically (every Nth heartbeat).
   */
  heartbeat: publicProcedure
    .input(
      z
        .object({ forceReconnect: z.boolean().optional() })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const authHeader = ctx.request.headers.get(STACK_AUTH_HEADER);
      if (!authHeader) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "missing stack auth header",
        });
      }

      startGmailWatchDaemon(authHeader);
      const result = await ensureRelayConnection(authHeader, {
        forceReconnect: input?.forceReconnect,
      });
      await triggerPendingGmailNotificationSyncsThrottled(authHeader);
      return result;
    }),
});
