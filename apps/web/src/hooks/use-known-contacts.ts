import { useQuery } from "@tanstack/react-query";
import type { OAuthConnection } from "@stackframe/react";

import { gmailKeys } from "@/lib/query-keys";
import { fetchKnownContacts } from "@/lib/gmail/contacts";
import { getOAuthToken } from "@/lib/oauth";
import { persistedStaleWhileRevalidateQueryOptions } from "@/utils/query-defaults";

export function useKnownContacts(account: OAuthConnection | null) {
  return useQuery({
    queryKey: gmailKeys.contacts(account?.providerAccountId),
    queryFn: async () => {
      const token = await getOAuthToken(account!);
      return fetchKnownContacts(token);
    },
    enabled: !!account,
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}
