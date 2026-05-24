import type { OAuthConnection } from "@stackframe/react";

const ACCESS_TOKEN_CACHE_TTL_MS = 50 * 60 * 1000;

type AccessTokenCacheEntry = {
  expiresAt: number;
  promise: Promise<string>;
};

const accessTokenCache = new Map<string, AccessTokenCacheEntry>();

function getAccessTokenCacheKey(account: OAuthConnection): string {
  return `${account.provider}:${account.providerAccountId}`;
}

export async function getConnectedAccountAccessToken(
  account: OAuthConnection,
): Promise<string> {
  const cacheKey = getAccessTokenCacheKey(account);
  const cached = accessTokenCache.get(cacheKey);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = fetchConnectedAccountAccessToken(account, cacheKey);
  accessTokenCache.set(cacheKey, {
    expiresAt: now + ACCESS_TOKEN_CACHE_TTL_MS,
    promise,
  });

  return promise;
}

export function clearConnectedAccountAccessTokenCache(account?: OAuthConnection) {
  if (!account) {
    accessTokenCache.clear();
    return;
  }

  accessTokenCache.delete(getAccessTokenCacheKey(account));
}

async function fetchConnectedAccountAccessToken(
  account: OAuthConnection,
  cacheKey: string,
): Promise<string> {
  const result = await account.getAccessToken();

  if (result.status !== "ok") {
    accessTokenCache.delete(cacheKey);
    throw new Error(
      result.error.message || `Unable to get ${account.provider} access token`,
    );
  }

  return result.data.accessToken;
}
