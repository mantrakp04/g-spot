import type { Context as ElysiaContext } from "elysia";

import { verifyStackToken } from "./lib/verify-token";

export type CreateContextOptions = {
  context: ElysiaContext;
};

export async function createContext({ context }: CreateContextOptions) {
  const accessToken = context.request.headers.get("x-stack-access-token");

  let userId: string | null = null;
  if (accessToken) {
    userId = await verifyStackToken(accessToken);
  }

  return { userId };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
