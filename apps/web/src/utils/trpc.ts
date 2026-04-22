import type { AppRouter } from "@g-spot/api/routers/index";
import { env } from "@g-spot/env/web";
import { stackClientApp } from "@/stack/client";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { toast } from "sonner";

import { staleWhileRevalidateQueryOptions } from "@/utils/query-defaults";

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      toast.error(error.message, {
        action: {
          label: "retry",
          onClick: query.invalidate,
        },
      });
    },
  }),
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60 * 24, // 24h
      ...staleWhileRevalidateQueryOptions,
    },
  },
});

const trpcUrl = `${env.VITE_SERVER_URL}/trpc`;

const AUTH_HEADERS_TTL_MS = 30_000;
let authHeadersCache: { headers: Record<string, string>; expiresAt: number } | null = null;
let authHeadersInflight: Promise<Record<string, string>> | null = null;

async function resolveAuthHeaders(): Promise<Record<string, string>> {
  if (authHeadersCache && authHeadersCache.expiresAt > Date.now()) {
    return authHeadersCache.headers;
  }
  if (authHeadersInflight) return authHeadersInflight;

  authHeadersInflight = (async () => {
    try {
      const user = await stackClientApp.getUser();
      const headers = user ? await user.getAuthHeaders() : {};
      authHeadersCache = { headers, expiresAt: Date.now() + AUTH_HEADERS_TTL_MS };
      return headers;
    } finally {
      authHeadersInflight = null;
    }
  })();
  return authHeadersInflight;
}

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: trpcUrl,
      headers: resolveAuthHeaders,
    }),
  ],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
