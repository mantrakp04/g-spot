import type { AppRouter } from "@g-spot/api/routers/index";
import { env } from "@g-spot/env/web";
import { stackClientApp } from "@/stack/client";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { toast } from "sonner";

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
      staleTime: 1000 * 60 * 5, // 5min
    },
  },
});

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${env.VITE_SERVER_URL}/trpc`,
      headers: async () => {
        const user = await stackClientApp.getUser();
        return user ? { "x-user-id": user.id } : {};
      },
    }),
  ],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
