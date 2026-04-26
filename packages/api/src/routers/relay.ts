import { TRPCError } from "@trpc/server";

import { publicProcedure, router } from "../index";
import {
  ensureRelayConnection,
  triggerPendingGmailNotificationSyncs,
} from "../lib/relay-client";
import { ensureLocalGmailWatches } from "../lib/gmail-watch";

const STACK_AUTH_HEADER = "x-stack-auth";

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
    await triggerPendingGmailNotificationSyncs(authHeader);
    return result;
  }),
});
