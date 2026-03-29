import type { Context as ElysiaContext } from "elysia";

export type CreateContextOptions = {
  context: ElysiaContext;
};

export async function createContext({ context }: CreateContextOptions) {
  const userId = context.request.headers.get("x-user-id");

  return {
    userId,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
