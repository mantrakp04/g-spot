import type { OAuthConnection } from "@stackframe/react";

/**
 * In-memory token cache keyed by providerAccountId.
 * Stack Auth's `getAccessToken()` uses "write-only" cache mode (always hits the
 * network), so we layer our own short-lived cache + promise coalescing on top.
 */
const TOKEN_TTL = 4 * 60 * 1000; // 4 minutes (Google tokens last ~1 hour)
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const inflightRequests = new Map<string, Promise<string>>();

function getTokenErrorMessage(result: unknown): string {
  if (
    result &&
    typeof result === "object" &&
    "error" in result &&
    typeof (result as { error?: unknown }).error === "string"
  ) {
    return (result as { error: string }).error;
  }

  if (
    result &&
    typeof result === "object" &&
    "message" in result &&
    typeof (result as { message?: unknown }).message === "string"
  ) {
    return (result as { message: string }).message;
  }

  return "Failed to get access token";
}

/**
 * Get an OAuth access token with caching and request deduplication.
 * Concurrent calls for the same account share a single in-flight request.
 */
export async function getOAuthToken(account: OAuthConnection): Promise<string> {
  const key = account.providerAccountId;

  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const inflight = inflightRequests.get(key);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const result = await account.getAccessToken();
      if (result.status !== "ok") {
        clearOAuthToken(key);
        throw new Error(getTokenErrorMessage(result));
      }
      tokenCache.set(key, {
        token: result.data.accessToken,
        expiresAt: Date.now() + TOKEN_TTL,
      });
      return result.data.accessToken;
    } finally {
      inflightRequests.delete(key);
    }
  })();

  inflightRequests.set(key, promise);
  void promise.catch(() => {});
  return promise;
}

/** Evict a cached token (e.g. after a 401 or disconnect). */
export function clearOAuthToken(accountId: string) {
  tokenCache.delete(accountId);
}

/** Compute display initials from a name/email pair. */
export function getInitials(name?: string | null, email?: string | null): string {
  const trimmed = name?.trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      const a = parts[0]?.[0] ?? "";
      const b = parts[parts.length - 1]?.[0] ?? "";
      return `${a}${b}`.toUpperCase();
    }
    return trimmed.slice(0, 2).toUpperCase();
  }
  const emailTrimmed = email?.trim();
  if (emailTrimmed) return emailTrimmed.slice(0, 2).toUpperCase();
  return "?";
}
