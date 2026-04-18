import { publicProcedure, router } from "../index";
import { ensureGmailPushRelayConnection } from "../lib/gmail-push-relay-client";

export const relayRouter = router({
  heartbeat: publicProcedure.mutation(async ({ ctx }) => {
    const connected = await ensureGmailPushRelayConnection(
      ctx.stackAuthHeaders,
    );

    return { connected };
  }),
});
