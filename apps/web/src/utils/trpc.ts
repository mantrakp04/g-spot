import type { AppRouter } from "@g-spot/api/routers/index";
import { stackClientApp } from "@/stack/client";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { toast } from "sonner";

import { staleWhileRevalidateQueryOptions } from "@/utils/query-defaults";
import { serverPath } from "@/utils/server-url";

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

const trpcUrl = serverPath("/trpc");

const AUTH_HEADERS_TTL_MS = 30_000;
let authHeadersCache: { expiresAt: number; promise: Promise<Record<string, string>> } | null = null;

async function resolveAuthHeaders(): Promise<Record<string, string>> {
  const now = Date.now();
  if (authHeadersCache && authHeadersCache.expiresAt > now) {
    return authHeadersCache.promise;
  }

  const promise = (async () => {
    const user = await stackClientApp.getUser();
    return user ? await user.getAuthHeaders() : {};
  })();
  promise.catch(() => {
    authHeadersCache = null;
  });
  authHeadersCache = { expiresAt: now + AUTH_HEADERS_TTL_MS, promise };

  return promise;
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
