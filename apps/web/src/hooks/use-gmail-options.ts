import { useQuery } from "@tanstack/react-query";
import type { OAuthConnection } from "@stackframe/react";
import type { FilterCondition } from "@g-spot/types/filters";

import { getConnectedAccountAccessToken } from "@/lib/connected-account";
import {
  fetchGmailFilterSuggestions as fetchDirectGmailFilterSuggestions,
  fetchGoogleProfile as fetchGoogleProfileByAccessToken,
} from "@/lib/gmail/account";
import { gmailKeys, googleKeys } from "@/lib/query-keys";
import { persistedStaleWhileRevalidateQueryOptions } from "@/utils/query-defaults";
import { GOOGLE_OAUTH_SCOPES } from "@/stack/client";
import { trpcClient } from "@/utils/trpc";

export type GmailLabelCatalogEntry = {
  id: string;
  name: string;
  type: "system" | "user";
  label: string;
  color?: {
    textColor?: string;
    backgroundColor?: string;
  };
};

export type FilterSuggestionOption = {
  value: string;
  label: string;
};

type GmailSuggestionField =
  | "from"
  | "to"
  | "cc"
  | "bcc"
  | "deliveredto"
  | "list"
  | "subject"
  | "filename"
  | "label"
  | "category"
  | "in";

export async function fetchGoogleProfileForConnection(
  account: OAuthConnection,
) {
  const accessToken = await getConnectedAccountAccessToken(account, [
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/userinfo.email",
  ]);
  return fetchGoogleProfileByAccessToken(accessToken);
}

export function useGmailLabels(account: OAuthConnection | null) {
  return useQuery({
    queryKey: gmailKeys.labels(account?.providerAccountId),
    queryFn: () =>
      trpcClient.gmail.getLabels.query({
        providerAccountId: account!.providerAccountId,
      }),
    enabled: !!account,
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

export function useGmailLabelCatalog(account: OAuthConnection | null) {
  return useQuery({
    queryKey: gmailKeys.labelsCatalog(account?.providerAccountId),
    queryFn: () =>
      trpcClient.gmail.getLabelCatalog.query({
        providerAccountId: account!.providerAccountId,
      }),
    enabled: !!account,
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}

function dedupeSuggestions(
  options: FilterSuggestionOption[],
): FilterSuggestionOption[] {
  const seen = new Set<string>();
  const deduped: FilterSuggestionOption[] = [];

  for (const option of options) {
    if (!option.value || seen.has(option.value)) continue;
    seen.add(option.value);
    deduped.push(option);
  }

  return deduped.sort((a, b) => a.label.localeCompare(b.label));
}

export async function fetchGmailFilterSuggestions(
  account: OAuthConnection,
  field: GmailSuggestionField,
  filters: FilterCondition[],
): Promise<FilterSuggestionOption[]> {
  const accessToken = await getConnectedAccountAccessToken(account, [
    GOOGLE_OAUTH_SCOPES[3],
  ]);
  const options = await fetchDirectGmailFilterSuggestions(
    accessToken,
    field,
    filters,
  );

  return dedupeSuggestions(options);
}

export function useGoogleProfile(account: OAuthConnection | null) {
  return useQuery({
    queryKey: googleKeys.profile(account?.providerAccountId),
    queryFn: () => fetchGoogleProfileForConnection(account!),
    enabled: !!account,
    ...persistedStaleWhileRevalidateQueryOptions,
  });
}
