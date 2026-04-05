import { createOpenAI } from "@ai-sdk/openai";
import * as jose from "jose";

import { getServerMetadata } from "./stack-server";

export type OpenAICredentials =
  | { type: "api_key"; apiKey: string }
  | { type: "oauth"; accessToken: string; accountId: string | null };

export const CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";

/**
 * Retrieves the user's OpenAI credentials from Stack Auth metadata.
 * Returns structured credentials distinguishing API key from OAuth token.
 */
export async function getOpenAICredentials(
  userId: string,
): Promise<OpenAICredentials | null> {
  const meta = await getServerMetadata(userId);

  // Prefer API key (explicitly set by user) over OAuth access token
  if (typeof meta.openaiApiKey === "string" && meta.openaiApiKey.length > 0) {
    return { type: "api_key", apiKey: meta.openaiApiKey };
  }
  if (
    typeof meta.openaiAccessToken === "string" &&
    meta.openaiAccessToken.length > 0
  ) {
    // Extract account ID from the OAuth JWT for ChatGPT-Account-ID header
    let accountId: string | null = null;
    try {
      const claims = jose.decodeJwt(meta.openaiAccessToken);
      // The account ID is typically in the `account_id` or `oid` claim
      accountId =
        (claims.account_id as string) ??
        (claims.oid as string) ??
        null;
    } catch {
      // Token may not be a JWT or may be opaque — proceed without account ID
    }
    return { type: "oauth", accessToken: meta.openaiAccessToken, accountId };
  }
  return null;
}

export function createOpenAIClient(credentials: OpenAICredentials) {
  return credentials.type === "api_key"
    ? createOpenAI({ apiKey: credentials.apiKey })
    : createOpenAI({
        apiKey: credentials.accessToken,
        baseURL: CHATGPT_CODEX_BASE_URL,
        headers: credentials.accountId
          ? { "ChatGPT-Account-ID": credentials.accountId }
          : undefined,
      });
}
