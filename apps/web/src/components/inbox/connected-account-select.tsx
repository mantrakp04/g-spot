import { useMemo } from "react";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@g-spot/ui/components/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@g-spot/ui/components/select";
import { cn } from "@g-spot/ui/lib/utils";
import type { OAuthConnection } from "@hexclave/react";
import { useQueries } from "@tanstack/react-query";

import { fetchGitHubProfileForConnection } from "@/hooks/use-github-options";
import { fetchGoogleProfileForConnection } from "@/hooks/use-gmail-options";
import { getInitials } from "@/lib/initials";
import { githubKeys, googleKeys } from "@/lib/query-keys";
import { persistedStaleWhileRevalidateQueryOptions } from "@/utils/query-defaults";

type SupportedProvider = "github" | "google";

type GitHubProfile = Awaited<ReturnType<typeof fetchGitHubProfileForConnection>>;
type GoogleProfile = Awaited<ReturnType<typeof fetchGoogleProfileForConnection>>;
type ConnectedProfile = GitHubProfile | GoogleProfile;

type ProviderAdapter = {
  fetchProfile: (account: OAuthConnection) => Promise<ConnectedProfile>;
  profileQueryKey: (providerAccountId: string) => readonly unknown[];
  toLabel: (profile: ConnectedProfile) => string | null | undefined;
  toAvatarUrl: (profile: ConnectedProfile) => string | undefined;
};

const providerAdapters: Record<SupportedProvider, ProviderAdapter> = {
  github: {
    fetchProfile: fetchGitHubProfileForConnection,
    profileQueryKey: githubKeys.profile,
    toLabel: (profile) =>
      "login" in profile ? (profile.login ?? profile.name) : profile.name,
    toAvatarUrl: (profile) =>
      "avatarUrl" in profile ? profile.avatarUrl : undefined,
  },
  google: {
    fetchProfile: fetchGoogleProfileForConnection,
    profileQueryKey: googleKeys.profile,
    toLabel: (profile) =>
      "email" in profile ? (profile.email ?? profile.name) : profile.name,
    toAvatarUrl: (profile) =>
      "picture" in profile ? profile.picture : undefined,
  },
};

type ConnectedAccountSelectProps = {
  accounts: OAuthConnection[];
  provider: SupportedProvider;
  value: string | null;
  onValueChange: (value: string | null) => void;
  className?: string;
  placeholder?: string;
  emptyMessage?: string;
  connectHref?: string;
  allOptionLabel?: string;
};

const ALL_ACCOUNTS_VALUE = "__all_accounts__";

function getProviderLabel(provider: SupportedProvider): string {
  return provider === "github" ? "GitHub" : "Google";
}

export function ConnectedAccountSelect({
  accounts,
  provider,
  value,
  onValueChange,
  className,
  placeholder = "Select account",
  emptyMessage,
  connectHref = "/settings/connections",
  allOptionLabel,
}: ConnectedAccountSelectProps) {
  const relevantAccounts = useMemo(
    () => accounts.filter((account) => account.provider === provider),
    [accounts, provider],
  );

  const selectedAccount = useMemo(() => {
    if (!value) return null;
    return (
      relevantAccounts.find(
        (account) => account.providerAccountId === value,
      ) ?? null
    );
  }, [relevantAccounts, value]);

  const adapter = providerAdapters[provider];

  const profileQueries = useQueries({
    queries: relevantAccounts.map((account) => ({
      queryKey: adapter.profileQueryKey(account.providerAccountId),
      queryFn: () => adapter.fetchProfile(account),
      enabled: true,
      ...persistedStaleWhileRevalidateQueryOptions,
    })),
  });

  const profileByAccountId = useMemo(() => {
    const map = new Map<string, ConnectedProfile>();

    for (let i = 0; i < relevantAccounts.length; i++) {
      const account = relevantAccounts[i];
      const query = profileQueries[i];
      if (!query?.data) continue;

      map.set(account.providerAccountId, query.data);
    }

    return map;
  }, [profileQueries, relevantAccounts]);

  const getAccountLabel = (providerAccountId: string) => {
    const profile = profileByAccountId.get(providerAccountId);
    return (profile && adapter.toLabel(profile)) ?? providerAccountId;
  };

  if (relevantAccounts.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center rounded-md border border-dashed border-border/60 px-3 text-xs text-muted-foreground",
          className,
        )}
      >
        {emptyMessage ?? `No ${getProviderLabel(provider)} account connected.`}{" "}
        <a
          href={connectHref}
          className="ml-1 underline hover:text-foreground"
        >
          Connect
        </a>
      </div>
    );
  }

  const selectedLabel = value
    ? getAccountLabel(value)
    : allOptionLabel ?? placeholder;
  const selectedProfile = value ? profileByAccountId.get(value) : undefined;
  const avatarSrc = selectedProfile
    ? adapter.toAvatarUrl(selectedProfile)
    : undefined;

  return (
    <Select
      value={value ?? (allOptionLabel ? ALL_ACCOUNTS_VALUE : "")}
      onValueChange={(nextValue) => {
        if (nextValue === ALL_ACCOUNTS_VALUE) {
          onValueChange(null);
          return;
        }
        if (!nextValue) return;
        onValueChange(nextValue);
      }}
    >
      <SelectTrigger className={className}>
        <div className="flex min-w-0 items-center gap-2">
          {selectedAccount && (
            <Avatar className="size-4">
              <AvatarImage src={avatarSrc} />
              <AvatarFallback className="text-[8px]">
                {getInitials(selectedLabel)}
              </AvatarFallback>
            </Avatar>
          )}
          <span className="truncate text-sm">{selectedLabel}</span>
        </div>
      </SelectTrigger>
      <SelectContent>
        {allOptionLabel ? (
          <SelectItem value={ALL_ACCOUNTS_VALUE}>
            {allOptionLabel}
          </SelectItem>
        ) : null}
        {relevantAccounts.map((account) => (
          <SelectItem
            key={account.providerAccountId}
            value={account.providerAccountId}
          >
            {getAccountLabel(account.providerAccountId)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
