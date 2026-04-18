import type { Context as ElysiaContext } from "elysia";

export type CreateContextOptions = {
  context: ElysiaContext;
};

export function extractStackAuthHeaders(headers: Headers): Record<string, string> {
  const authHeaders: Record<string, string> = {};

  for (const [key, value] of headers.entries()) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey === "authorization"
      || normalizedKey === "cookie"
      || normalizedKey.startsWith("x-stack-")
    ) {
      authHeaders[normalizedKey] = value;
    }
  }

  return authHeaders;
}

export function createContext({ context }: CreateContextOptions) {
  const stackAuthHeaders = extractStackAuthHeaders(context.request.headers);
  return { stackAuthHeaders };
}

export type Context = ReturnType<typeof createContext>;
