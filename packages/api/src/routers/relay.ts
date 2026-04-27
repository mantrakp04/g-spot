import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";

import { publicProcedure, router } from "../index";
import {
  ensureRelayConnection,
  triggerPendingGmailNotificationSyncs,
} from "../lib/relay-client";
import { ensureLocalGmailWatches } from "../lib/gmail-watch";

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
   */
  heartbeat: publicProcedure.mutation(async ({ ctx }) => {
    const authHeader = ctx.request.headers.get(STACK_AUTH_HEADER);
    if (!authHeader) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "missing stack auth header",
      });
    }

    await ensureLocalGmailWatches(authHeader);
    const result = await ensureRelayConnection(authHeader);
    await triggerPendingGmailNotificationSyncsThrottled(authHeader);
    return result;
  }),
});
