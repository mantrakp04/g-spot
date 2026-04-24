import type { OAuthConnection } from "@stackframe/react";
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
