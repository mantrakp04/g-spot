import type { OAuthConnection } from "@hexclave/react";
import { Octokit } from "octokit";

import { getConnectedAccountAccessToken } from "@/lib/connected-account";

export function requireGitHubAccount(
  account: OAuthConnection | null,
): OAuthConnection {
  if (!account) throw new Error("No GitHub account connected");
  return account;
}

export async function getGitHubOctokit(account: OAuthConnection) {
  const accessToken = await getConnectedAccountAccessToken(account);
  return new Octokit({ auth: accessToken });
}

export async function getReadOnlyGitHubOctokit(account: OAuthConnection | null) {
  if (!account) return new Octokit();
  return getGitHubOctokit(account);
}
