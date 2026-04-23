import type { OAuthConnection } from "@stackframe/react";

export async function getConnectedAccountAccessToken(
  account: OAuthConnection,
): Promise<string> {
  const result = await account.getAccessToken();

  if (result.status !== "ok") {
    throw new Error(
      result.error.message || `Unable to get ${account.provider} access token`,
    );
  }

  return result.data.accessToken;
}
