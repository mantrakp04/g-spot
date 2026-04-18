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
import type { OAuthConnection } from "@stackframe/react";
import { useQueries } from "@tanstack/react-query";

import {
  fetchGitHubProfileForConnection,
  useGitHubProfile,
} from "@/hooks/use-github-options";
import {
  fetchGoogleProfileForConnection,
  useGoogleProfile,
} from "@/hooks/use-gmail-options";
import { getInitials } from "@/lib/initials";
import { githubKeys, googleKeys } from "@/lib/query-keys";
import { persistedStaleWhileRevalidateQueryOptions } from "@/utils/query-defaults";

type SupportedProvider = "github" | "google";

type ConnectedAccountSelectProps = {
  accounts: OAuthConnection[];
  provider: SupportedProvider;
  value: string | null;
  onValueChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  emptyMessage?: string;
  connectHref?: string;
};

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

  const { data: githubProfile } = useGitHubProfile(
    provider === "github" ? selectedAccount : null,
  );
  const { data: googleProfile } = useGoogleProfile(
    provider === "google" ? selectedAccount : null,
  );

  const profileQueries = useQueries({
    queries: relevantAccounts.map((account) =>
      provider === "github"
        ? {
            queryKey: githubKeys.profile(account.providerAccountId),
            queryFn: () => fetchGitHubProfileForConnection(account),
            enabled: true,
            ...persistedStaleWhileRevalidateQueryOptions,
          }
        : {
            queryKey: googleKeys.profile(account.providerAccountId),
            queryFn: () => fetchGoogleProfileForConnection(account),
            enabled: true,
            ...persistedStaleWhileRevalidateQueryOptions,
          },
    ),
  });

  const profileLabelMap = useMemo(() => {
    const map = new Map<string, string>();

    for (let i = 0; i < relevantAccounts.length; i++) {
      const account = relevantAccounts[i];
      const query = profileQueries[i];
      if (!query?.data) continue;

      const data = query.data as Record<string, string>;
      const label = data.login ?? data.email ?? data.name ?? account.providerAccountId;
      map.set(account.providerAccountId, label);
    }

    return map;
  }, [profileQueries, relevantAccounts]);

  const getAccountLabel = (providerAccountId: string) =>
    profileLabelMap.get(providerAccountId) ?? providerAccountId;

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

  const selectedLabel = value ? getAccountLabel(value) : placeholder;
  const avatarSrc =
    provider === "github" ? githubProfile?.avatarUrl : googleProfile?.picture;

  return (
    <Select
      value={value ?? ""}
      onValueChange={(nextValue) => {
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
