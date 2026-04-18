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

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: trpcUrl,
      headers: async () => {
        const user = await stackClientApp.getUser();
        if (!user) return {};
        return user.getAuthHeaders();
      },
    }),
  ],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
