import { env } from "@g-spot/env/server";

type RelayMetadataResponse = {
  clientMetadata: Record<string, unknown>;
  serverMetadata: Record<string, unknown>;
};

type RelayClientMetadataResponse = {
  clientMetadata: Record<string, unknown>;
};

type RelayEnsureGmailWatchResponse = {
  watch: {
    historyId: string;
    expiration: string;
  } | null;
};

type RelayAuthUserResponse = {
  userId: string;
};

function getRelayApiBaseUrl(): URL {
  if (!env.GMAIL_PUSH_RELAY_URL) {
    throw new Error("GMAIL_PUSH_RELAY_URL is not configured");
  }

  const relayUrl = new URL(env.GMAIL_PUSH_RELAY_URL);
  relayUrl.protocol = relayUrl.protocol === "wss:" ? "https:" : "http:";
  relayUrl.search = "";
  relayUrl.hash = "";
  return relayUrl;
}

async function postRelayJson<TResponse>(
  path: string,
  payload: Record<string, unknown>,
): Promise<TResponse> {
  const url = new URL(path, getRelayApiBaseUrl());
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || `Relay request failed (${response.status}) for ${url.pathname}`,
    );
  }

  return response.json();
}

function normalizeRelayAuthHeaders(headers: Record<string, string>): HeadersInit {
  return Object.fromEntries(
    Object.entries(headers).filter(([, value]) => value),
  );
}

export async function getRelayRequestUserId(
  authHeaders: Record<string, string>,
): Promise<string | null> {
  if (!env.GMAIL_PUSH_RELAY_URL) {
    return null;
  }

  const url = new URL("/api/internal/auth/user", getRelayApiBaseUrl());
  const response = await fetch(url, {
    method: "GET",
    headers: normalizeRelayAuthHeaders(authHeaders),
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || `Relay auth request failed (${response.status}) for ${url.pathname}`,
    );
  }

  const payload = (await response.json()) as RelayAuthUserResponse;
  return payload.userId;
}

export async function getRelayConnectedAccountAccessToken(
  userId: string,
  provider: string,
  providerAccountId: string,
  scopes?: string[],
): Promise<string> {
  const accessTokenResponse = await postRelayJson<{ accessToken: string }>(
    "/api/internal/stack/access-token",
    {
      userId,
      provider,
      providerAccountId,
      ...(scopes?.length ? { scopes } : {}),
    },
  );

  return accessTokenResponse.accessToken;
}

export async function ensureRelayGmailWatch(
  accountId: string,
  options?: { force?: boolean },
): Promise<{ historyId: string; expiration: string } | null> {
  if (!env.GMAIL_PUSH_RELAY_URL) return null;

  const watchResponse = await postRelayJson<RelayEnsureGmailWatchResponse>(
    "/api/internal/gmail/watch/ensure",
    {
      accountId,
      ...(options?.force ? { force: true } : {}),
    },
  );

  return watchResponse.watch;
}

export async function getRelayUserMetadata(
  userId: string,
): Promise<RelayMetadataResponse> {
  return postRelayJson<RelayMetadataResponse>(
    "/api/internal/stack/metadata",
    { userId },
  );
}

export async function patchRelayClientMetadata(
  userId: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const clientMetadataResponse = await postRelayJson<RelayClientMetadataResponse>(
    "/api/internal/stack/metadata/patch",
    { userId, patch },
  );

  return clientMetadataResponse.clientMetadata;
}

export async function removeRelayConnectedAccount(
  userId: string,
  provider: string,
  providerAccountId: string,
): Promise<void> {
  await postRelayJson<{ success: boolean }>(
    "/api/internal/stack/connection/remove",
    {
      userId,
      provider,
      providerAccountId,
    },
  );
}
