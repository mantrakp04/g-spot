import type { Context as ElysiaContext } from "elysia";

export type CreateContextOptions = {
  context: ElysiaContext;
};

export function createContext({ context }: CreateContextOptions) {
  return { request: context.request };
}

export type Context = ReturnType<typeof createContext>;
