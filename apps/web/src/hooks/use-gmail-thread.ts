import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { OAuthConnection } from "@stackframe/react";
import type { GmailThreadDetail } from "@/lib/gmail/types";
import { fetchGmailThreadDetail } from "@/lib/gmail/api";
import { getOAuthToken } from "@/lib/oauth";
import { gmailKeys } from "@/lib/query-keys";
import { persistedStaleWhileRevalidateQueryOptions } from "@/utils/query-defaults";

export function useGmailThread(
  threadId: string | null,
  account: OAuthConnection | null,
) {
  return useQuery({
    queryKey: gmailKeys.thread(threadId, account?.providerAccountId),
    queryFn: async (): Promise<GmailThreadDetail> => {
      const token = await getOAuthToken(account!);
      return fetchGmailThreadDetail(token, threadId!);
    },
    enabled: threadId != null && account != null,
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

export function usePrefetchGmailThread() {
  const queryClient = useQueryClient();
  return useCallback(
    (threadId: string, account: OAuthConnection) => {
      // Background prefetch should never surface as an uncaught runtime error.
      void queryClient.prefetchQuery({
        queryKey: gmailKeys.thread(threadId, account.providerAccountId),
        queryFn: async (): Promise<GmailThreadDetail> => {
          const token = await getOAuthToken(account);
          return fetchGmailThreadDetail(token, threadId);
        },
        ...persistedStaleWhileRevalidateQueryOptions,
      }).catch(() => {});
    },
    [queryClient],
  );
}
