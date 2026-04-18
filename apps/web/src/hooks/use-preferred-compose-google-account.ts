import { useCallback, useEffect, useMemo } from "react";

import type { OAuthConnection } from "@stackframe/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { gmailKeys } from "@/lib/query-keys";
import { preferenceQueryPersister } from "@/utils/query-persister";

const QUERY_KEY = gmailKeys.composePreferredAccount();

export function usePreferredComposeGoogleAccount(
  accounts: OAuthConnection[] | undefined,
) {
  const queryClient = useQueryClient();
  const accountsLoaded = accounts !== undefined;
  const googleAccounts = useMemo(
    () => (accounts ?? []).filter((account) => account.provider === "google"),
    [accounts],
  );

  const { data: storedAccountId = null } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: (): string | null => null,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    persister: preferenceQueryPersister as any,
  });

  const preferredAccountId = useMemo(() => {
    if (!accountsLoaded) return storedAccountId;

    if (
      storedAccountId
      && googleAccounts.some(
        (account) => account.providerAccountId === storedAccountId,
      )
    ) {
      return storedAccountId;
    }

    return googleAccounts[0]?.providerAccountId ?? null;
  }, [accountsLoaded, googleAccounts, storedAccountId]);

  useEffect(() => {
    if (!accountsLoaded) return;
    if (storedAccountId === preferredAccountId) return;
    queryClient.setQueryData(QUERY_KEY, preferredAccountId);
  }, [accountsLoaded, preferredAccountId, queryClient, storedAccountId]);

  const setPreferredAccountId = useCallback(
    (accountId: string | null) => {
      queryClient.setQueryData(QUERY_KEY, accountId);
    },
    [queryClient],
  );

  return {
    preferredAccountId,
    setPreferredAccountId,
  } as const;
}
