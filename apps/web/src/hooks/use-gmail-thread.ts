import { useQuery } from "@tanstack/react-query";
import type { GmailThreadDetail } from "@/lib/gmail/types";
import { gmailKeys } from "@/lib/query-keys";
import { trpcClient } from "@/utils/trpc";
import { persistedStaleWhileRevalidateQueryOptions } from "@/utils/query-defaults";

export function useGmailThread(
  threadId: string | null,
  providerAccountId: string | null,
) {
  return useQuery({
    queryKey: gmailKeys.thread(threadId, providerAccountId),
    queryFn: async (): Promise<GmailThreadDetail | null> => {
      return trpcClient.gmail.getThread.query({
        providerAccountId: providerAccountId!,
        gmailThreadId: threadId!,
      });
    },
    enabled: threadId != null && providerAccountId != null,
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}
