import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "@g-spot/env/server";

import { authedProcedure, publicProcedure, router } from "../index";
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
const pendingOAuth = new Map<
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
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CALLBACK_PATH = "/auth/openai/callback";

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

  /** Generates PKCE params, returns the OAuth authorize URL. */
  initiateAuth: authedProcedure.mutation(async ({ ctx }) => {
    cleanupPendingOAuth();

    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await sha256Base64Url(codeVerifier);
    const redirectUri = `${env.CORS_ORIGIN.replace(/\/$/, "")}${CALLBACK_PATH}`;

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
      scope: "openid profile email offline_access",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      originator: "g-spot",
    });

    return { url: `${AUTH_URL}?${params.toString()}` };
  }),

  /** Frontend sends code+state after redirect; server exchanges for tokens. */
  exchangeCode: publicProcedure
    .input(z.object({ code: z.string(), state: z.string() }))
    .mutation(async ({ input }) => {
      const pending = pendingOAuth.get(input.state);
      if (!pending) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or expired OAuth state",
        });
      }
      pendingOAuth.delete(input.state);

      const tokenRes = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: input.code,
          client_id: env.OPENAI_CLIENT_ID,
          redirect_uri: pending.redirectUri,
          code_verifier: pending.codeVerifier,
        }).toString(),
      });

      if (!tokenRes.ok) {
        const text = await tokenRes.text();
        console.error("OpenAI token exchange failed:", tokenRes.status, text);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Token exchange failed (${tokenRes.status})`,
        });
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

      return { connected: true };
    }),

  /** API key fallback. */
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
