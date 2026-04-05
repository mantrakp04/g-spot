import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "@g-spot/env/server";

import { authedProcedure, router } from "../index";
import {
  getServerMetadata,
  patchServerMetadata,
} from "../lib/stack-server";

// ── PKCE helpers ──
// Ref: https://github.com/7shi/codex-oauth/blob/main/codex_oauth.py

function generateCodeVerifier(): string {
  const array = new Uint8Array(96);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Base64Url(plain: string): Promise<string> {
  const data = new TextEncoder().encode(plain);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// In-memory pending OAuth states, keyed by `state`.
export const pendingOAuth = new Map<
  string,
  { codeVerifier: string; userId: string; redirectUri: string; createdAt: number }
>();

function cleanupPendingOAuth() {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [key, val] of pendingOAuth) {
    if (val.createdAt < cutoff) pendingOAuth.delete(key);
  }
}

const AUTH_URL = "https://auth.openai.com/oauth/authorize";
export const TOKEN_URL = "https://auth.openai.com/oauth/token";

function popupHtml(status: "success" | "error", message: string): string {
  return `<!DOCTYPE html><html><head><title>OpenAI Auth</title></head><body>
  <p>${status === "success" ? "Connected!" : `Error: ${message}`}</p>
  <script>
  if (window.opener) {
    window.opener.postMessage({ type: "openai-oauth", status: "${status}" }, "*");
  }
  window.close();
  </script>
  </body></html>`;
}

/** HTTP handler for GET /auth/callback — served on port 1455 to match the Codex CLI's registered redirect URI. */
export async function handleOpenAIOAuthCallback(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  const headers = { "content-type": "text/html; charset=utf-8" };

  if (oauthError) {
    const msg = [oauthError, errorDescription].filter(Boolean).join(": ");
    return new Response(popupHtml("error", msg), { headers });
  }

  if (!code || !state || !pendingOAuth.has(state)) {
    return new Response(popupHtml("error", "Invalid or expired OAuth state"), {
      headers,
    });
  }

  const pending = pendingOAuth.get(state)!;
  pendingOAuth.delete(state);

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: env.OPENAI_CLIENT_ID,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.codeVerifier,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error("OpenAI token exchange failed:", tokenRes.status, text);
    return new Response(
      popupHtml("error", `Token exchange failed (${tokenRes.status})`),
      { headers },
    );
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  await patchServerMetadata(pending.userId, {
    openaiAccessToken: tokens.access_token,
    openaiRefreshToken: tokens.refresh_token ?? null,
    openaiTokenExpiresAt: tokens.expires_in
      ? Date.now() + tokens.expires_in * 1000
      : null,
  });

  return new Response(popupHtml("success", "OpenAI connected"), { headers });
}

export const openaiRouter = router({
  status: authedProcedure.query(async ({ ctx }) => {
    const meta = await getServerMetadata(ctx.userId);
    return {
      connected:
        (typeof meta.openaiAccessToken === "string" &&
          meta.openaiAccessToken.length > 0) ||
        (typeof meta.openaiApiKey === "string" &&
          meta.openaiApiKey.length > 0),
    };
  }),

  initiateAuth: authedProcedure.mutation(async ({ ctx }) => {
    cleanupPendingOAuth();

    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await sha256Base64Url(codeVerifier);

    const redirectUri = env.OPENAI_REDIRECT_URI;

    pendingOAuth.set(state, {
      codeVerifier,
      userId: ctx.userId,
      redirectUri,
      createdAt: Date.now(),
    });

    const params = new URLSearchParams({
      response_type: "code",
      client_id: env.OPENAI_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: "openid profile email offline_access api.connectors.read api.connectors.invoke",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      // Must match the value Codex CLI / reference OAuth clients use for this client_id.
      originator: "opencode",
    });

    return { url: `${AUTH_URL}?${params.toString()}` };
  }),

  saveKey: authedProcedure
    .input(z.object({ apiKey: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${input.apiKey}` },
      });
      if (!res.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid OpenAI API key",
        });
      }
      await patchServerMetadata(ctx.userId, { openaiApiKey: input.apiKey });
      return { connected: true };
    }),

  disconnect: authedProcedure.mutation(async ({ ctx }) => {
    await patchServerMetadata(ctx.userId, {
      openaiAccessToken: null,
      openaiRefreshToken: null,
      openaiTokenExpiresAt: null,
      openaiApiKey: null,
    });
    return { connected: false };
  }),
});
