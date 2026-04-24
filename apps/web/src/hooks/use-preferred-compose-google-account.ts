import { useCallback, useEffect, useMemo } from "react";

import type { OAuthConnection } from "@stackframe/react";
import { useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";

const preferredComposeGoogleAccountAtom = atomWithStorage<string | null>(
  "gspot:gmail:compose:preferred-account",
  null,
  undefined,
  { getOnInit: true },
);

export function usePreferredComposeGoogleAccount(
  accounts: OAuthConnection[] | undefined,
) {
  const storedAccountId = useAtomValue(preferredComposeGoogleAccountAtom);
  const setStoredAccountId = useSetAtom(preferredComposeGoogleAccountAtom);
  const accountsLoaded = accounts !== undefined;
  const googleAccounts = useMemo(
    () => (accounts ?? []).filter((account) => account.provider === "google"),
    [accounts],
  );

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
    setStoredAccountId(preferredAccountId);
  }, [accountsLoaded, preferredAccountId, setStoredAccountId, storedAccountId]);

  const setPreferredAccountId = useCallback(
    (accountId: string | null) => {
      setStoredAccountId(accountId);
    },
    [setStoredAccountId],
  );

  return {
    preferredAccountId,
    setPreferredAccountId,
  } as const;
}
