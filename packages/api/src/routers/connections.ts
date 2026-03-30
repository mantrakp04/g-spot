import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "@g-spot/env/server";

import { authedProcedure, router } from "../index";

const STACK_API = "https://api.stack-auth.com/api/v1";

function serverHeaders() {
  return {
    "x-stack-access-type": "server",
    "x-stack-project-id": env.STACK_PROJECT_ID,
    "x-stack-secret-server-key": env.STACK_SECRET_SERVER_KEY,
    "content-type": "application/json",
  } as const;
}

type OAuthProviderEntry = {
  id: string;
  account_id: string;
  provider_config_id: string;
};

export const connectionsRouter = router({
  remove: authedProcedure
    .input(
      z.object({
        provider: z.string(),
        providerAccountId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // List all OAuth providers for this user to find the UUID
      const listRes = await fetch(
        `${STACK_API}/oauth-providers?user_id=${ctx.userId}`,
        { headers: serverHeaders() },
      );
      if (!listRes.ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to list providers",
        });
      }
      const body = (await listRes.json()) as {
        items: OAuthProviderEntry[];
      };

      const entry = body.items.find(
        (p) =>
          p.provider_config_id === input.provider &&
          p.account_id === input.providerAccountId,
      );
      if (!entry) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Connected account not found",
        });
      }

      const delRes = await fetch(
        `${STACK_API}/oauth-providers/${ctx.userId}/${entry.id}`,
        { method: "DELETE", headers: serverHeaders() },
      );
      if (!delRes.ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to remove account",
        });
      }

      return { success: true };
    }),
});
