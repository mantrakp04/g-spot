import { env } from "@g-spot/env/server";
import { z } from "zod";

const STACK_API_URL = "https://api.stack-auth.com/api/v1";

const stackAuthJsonSchema = z.object({
  accessToken: z.string().min(1),
});

const stackConnectedAccountSchema = z.object({
  provider: z.string().min(1),
  provider_account_id: z.string().min(1),
});

const stackConnectedAccountsResponseSchema = z.object({
  items: z.array(stackConnectedAccountSchema),
});

const stackAccessTokenResponseSchema = z.object({
  access_token: z.string().min(1),
});

export type StackGmailAccount = {
  providerAccountId: string;
  accessToken: string;
};

function getStackAccessToken(authHeader: string): string {
  return stackAuthJsonSchema.parse(JSON.parse(authHeader)).accessToken;
}

async function stackClientFetch(
  authHeader: string,
  path: string,
  options: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(`${STACK_API_URL}${path}`, {
    ...options,
    headers: {
      "X-Stack-Access-Type": "client",
      "X-Stack-Project-Id": env.STACK_PROJECT_ID,
      "X-Stack-Access-Token": getStackAccessToken(authHeader),
      "X-Stack-Allow-Anonymous-User": "true",
      "X-Stack-Override-Error-Status": "true",
      "content-type": "application/json",
      ...options.headers,
    },
  });

  if (response.status === 401) return null;
  if (!response.ok) {
    throw new Error(`Stack client request failed (${response.status} ${response.statusText})`);
  }

  return response.json();
}

async function getGmailAccessToken(
  authHeader: string,
  providerAccountId: string,
): Promise<string | null> {
  const result = await stackClientFetch(
    authHeader,
    `/connected-accounts/me/google/${encodeURIComponent(providerAccountId)}/access-token`,
    {
      method: "POST",
      body: JSON.stringify({ scope: "https://mail.google.com/" }),
    },
  );
  if (!result) return null;
  return stackAccessTokenResponseSchema.parse(result).access_token;
}

export async function listStackGmailAccounts(
  authHeader: string,
): Promise<StackGmailAccount[] | null> {
  const result = await stackClientFetch(authHeader, "/connected-accounts/me", {
    method: "GET",
  });
  if (!result) return null;

  const accounts = stackConnectedAccountsResponseSchema.parse(result).items;
  const gmailAccounts: StackGmailAccount[] = [];
  for (const account of accounts) {
    if (account.provider !== "google") continue;
    const accessToken = await getGmailAccessToken(authHeader, account.provider_account_id);
    if (!accessToken) continue;
    gmailAccounts.push({
      providerAccountId: account.provider_account_id,
      accessToken,
    });
  }
  return gmailAccounts;
}

export async function getStackGmailAccessTokenForProviderAccountId(
  authHeader: string,
  providerAccountId: string,
): Promise<string | null> {
  return getGmailAccessToken(authHeader, providerAccountId);
}
