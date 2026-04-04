import { useQuery } from "@tanstack/react-query";
import type { OAuthConnection } from "@stackframe/react";
import type { GmailThreadDetail } from "@/lib/gmail/types";
import { fetchGmailThreadDetail } from "@/lib/gmail/api";
import { gmailKeys } from "@/lib/query-keys";
import { persistedStaleWhileRevalidateQueryOptions } from "@/utils/query-defaults";

export function useGmailThread(
  threadId: string | null,
  account: OAuthConnection | null,
) {
  return useQuery({
    queryKey: gmailKeys.thread(threadId, account?.providerAccountId),
    queryFn: async (): Promise<GmailThreadDetail> => {
      const tokenResult = await account!.getAccessToken();
      if (tokenResult.status === "error") {
        throw new Error("Failed to get Gmail access token");
      }
      return fetchGmailThreadDetail(tokenResult.data.accessToken, threadId!);
    },
    enabled: threadId != null && account != null,
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}
