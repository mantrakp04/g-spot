import { env } from "@g-spot/env/server";
import { initTRPC } from "@trpc/server";
import { TRPCError } from "@trpc/server";

import type { Context } from "./context";

export const t = initTRPC.context<Context>().create();

export const router = t.router;

export function assertNotDemoMutation(action = "This action"): void {
  if (!env.DEMO_MODE) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: `${action} is disabled in the read-only demo.`,
  });
}

export const publicProcedure = t.procedure.use(async (opts) => {
  if (opts.type === "mutation") {
    assertNotDemoMutation("Mutations");
  }
  return opts.next();
});
