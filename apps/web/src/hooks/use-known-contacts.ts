import { useQuery } from "@tanstack/react-query";
import type { OAuthConnection } from "@stackframe/react";

import { getConnectedAccountAccessToken } from "@/lib/connected-account";
import { fetchKnownContacts } from "@/lib/gmail/contacts";
import { gmailKeys } from "@/lib/query-keys";
import { GOOGLE_OAUTH_SCOPES } from "@/stack/client";
import { persistedStaleWhileRevalidateQueryOptions } from "@/utils/query-defaults";

export function useKnownContacts(account: OAuthConnection | null) {
  return useQuery({
    queryKey: gmailKeys.contacts(account?.providerAccountId),
    queryFn: async () => {
      const accessToken = await getConnectedAccountAccessToken(account!, [
        GOOGLE_OAUTH_SCOPES[3],
      ]);
      return fetchKnownContacts(accessToken);
    },
    enabled: !!account,
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}
