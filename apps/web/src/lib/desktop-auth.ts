import { stackAppInternalsSymbol } from "@stackframe/react";
import { env } from "@g-spot/env/web";

import { getDesktopRpc } from "@/lib/desktop-rpc";
import { stackClientApp } from "@/stack/client";

type CliLoginOptions = Parameters<typeof stackClientApp.promptCliLogin>[0] & {
  maxAttempts?: number;
  promptLink?: (url: string) => void;
  waitTimeMillis?: number;
};

type StackTokenInternals = (typeof stackClientApp)[typeof stackAppInternalsSymbol] & {
  signInWithTokens(tokens: { accessToken: string; refreshToken: string }): Promise<void>;
};

type RefreshTokenResponse = {
  access_token?: unknown;
};

async function getAccessTokenFromRefreshToken(refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: env.VITE_STACK_PROJECT_ID,
    client_secret: "__stack_public_client__",
  });

  const response = await fetch("https://api.stack-auth.com/api/v1/auth/oauth/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh Stack access token: ${response.status}`);
  }

  const data = (await response.json()) as RefreshTokenResponse;
  if (typeof data.access_token !== "string") {
    throw new Error("Stack refresh response did not include an access token");
  }

  return data.access_token;
}

export async function signInWithExternalBrowser(): Promise<void> {
  const rpc = await getDesktopRpc();
  if (!rpc) {
    await stackClientApp.redirectToSignIn();
    return;
  }

  const cliLoginOptions: CliLoginOptions = {
    appUrl: env.VITE_SERVER_URL,
    expiresInMillis: 10 * 60 * 1000,
    waitTimeMillis: 1500,
    promptLink: async (url) => {
      const openResult = await rpc.requestProxy.openExternalUrl({ url });
      if (!openResult.ok) {
        throw new Error(openResult.error ?? "Failed to open browser");
      }
    },
  };

  const result = await stackClientApp.promptCliLogin(cliLoginOptions);

  if (result.status === "error") {
    throw result.error;
  }

  const accessToken = await getAccessTokenFromRefreshToken(result.data);
  const tokens = {
    accessToken,
    refreshToken: result.data,
  };
  const internals = stackClientApp[stackAppInternalsSymbol] as StackTokenInternals;
  await internals.signInWithTokens(tokens);
}
