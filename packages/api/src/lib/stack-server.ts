import { env } from "@g-spot/env/server";
import { StackServerApp } from "@stackframe/react";

type StackRequestLike = {
  headers: {
    get(name: string): string | null;
  };
};

export type StackAuthHeaders = Record<string, string>;

const stackServerApp = new StackServerApp({
  projectId: env.STACK_PROJECT_ID,
  tokenStore: "memory",
});

function createRequestLikeFromAuthHeaders(
  authHeaders: StackAuthHeaders,
): StackRequestLike {
  const normalizedHeaders = new Map(
    Object.entries(authHeaders).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return {
    headers: {
      get(name: string) {
        return normalizedHeaders.get(name.toLowerCase()) ?? null;
      },
    },
  };
}

export async function getStackRequestUser(
  requestLike: StackRequestLike,
) {
  return stackServerApp.getUser({
    tokenStore: requestLike,
  });
}

export async function getStackUserFromAuthHeaders(
  authHeaders: StackAuthHeaders,
) {
  return getStackRequestUser(createRequestLikeFromAuthHeaders(authHeaders));
}

export async function getStackConnectedAccountAccessToken(
  authHeaders: StackAuthHeaders,
  provider: string,
  providerAccountId: string,
  scopes?: string[],
): Promise<string> {
  const user = await getStackUserFromAuthHeaders(authHeaders);
  if (!user) {
    throw new Error("Not authenticated");
  }

  const account = await user.getConnectedAccount({
    provider,
    providerAccountId,
  });
  if (!account) {
    throw new Error("Connected account not found");
  }

  const result = await account.getAccessToken(
    scopes?.length ? { scopes } : undefined,
  );
  if (result.status !== "ok") {
    throw new Error(
      result.error.message || `Unable to get ${provider} access token`,
    );
  }

  return result.data.accessToken;
}

export async function getStackCurrentUserMetadata(
  authHeaders: StackAuthHeaders,
): Promise<{
  clientMetadata: Record<string, unknown>;
  serverMetadata: Record<string, unknown>;
}> {
  const user = await getStackUserFromAuthHeaders(authHeaders);
  if (!user) {
    throw new Error("Not authenticated");
  }

  return {
    clientMetadata:
      user.clientMetadata && typeof user.clientMetadata === "object"
        ? (user.clientMetadata as Record<string, unknown>)
        : {},
    serverMetadata:
      user.serverMetadata && typeof user.serverMetadata === "object"
        ? (user.serverMetadata as Record<string, unknown>)
        : {},
  };
}

export async function patchStackCurrentUserClientMetadata(
  authHeaders: StackAuthHeaders,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const user = await getStackUserFromAuthHeaders(authHeaders);
  if (!user) {
    throw new Error("Not authenticated");
  }

  const currentClientMetadata =
    user.clientMetadata && typeof user.clientMetadata === "object"
      ? (user.clientMetadata as Record<string, unknown>)
      : {};
  const nextClientMetadata = {
    ...currentClientMetadata,
    ...patch,
  };

  await user.setClientMetadata(nextClientMetadata);
  return nextClientMetadata;
}
