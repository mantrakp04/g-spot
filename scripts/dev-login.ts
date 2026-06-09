#!/usr/bin/env bun
/**
 * dev-login — open agent-browser already authenticated as a dev user.
 *
 * Reads DEV_EMAIL_ACCOUNT, looks the user up via the Hexclave server SDK,
 * mints an impersonation session (project id + secret server key), then injects
 * the resulting tokens as cookies into agent-browser for the local web app.
 *
 * Server-secret-bearing: dev-only, runs on the developer's machine. Never ship
 * STACK_SECRET_SERVER_KEY to any client surface.
 *
 *   bun dev:login            # uses http://localhost:3002 (apps/web)
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { $ } from "bun";
import { config as loadEnv } from "dotenv";
import { HexclaveServerApp } from "@hexclave/react";
import { devUrls } from "@g-spot/env/dev-ports";
import { z } from "zod";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envPath)) loadEnv({ path: envPath });

const env = z
  .object({
    DEV_EMAIL_ACCOUNT: z.email(),
    STACK_PROJECT_ID: z.string().min(1),
    STACK_SECRET_SERVER_KEY: z.string().min(1),
  })
  .safeParse(process.env);

if (!env.success) {
  console.error(
    "dev-login: missing/invalid env. Need DEV_EMAIL_ACCOUNT (email), " +
      "STACK_PROJECT_ID, STACK_SECRET_SERVER_KEY in .env.\n" +
      z.prettifyError(env.error),
  );
  process.exit(1);
}

const { DEV_EMAIL_ACCOUNT: email, STACK_PROJECT_ID: projectId, STACK_SECRET_SERVER_KEY } = env.data;
const webUrl = devUrls.web;

const stackServerApp = new HexclaveServerApp({
  projectId,
  secretServerKey: STACK_SECRET_SERVER_KEY,
  tokenStore: "memory",
});

// `query` is free-text (matches id, name, contact channels) — narrow to an exact
// primary-email match so we never impersonate the wrong account.
const users = await stackServerApp.listUsers({ query: email, limit: 100 });
const user = users.find((u) => u.primaryEmail?.toLowerCase() === email.toLowerCase());

if (!user) {
  console.error(`dev-login: no Hexclave user with primary email "${email}".`);
  process.exit(1);
}

const session = await user.createSession({
  isImpersonation: true,
  expiresInMillis: 24 * 60 * 60 * 1000, // 1 day
});
const { accessToken, refreshToken } = await session.getTokens();

if (!accessToken || !refreshToken) {
  console.error("dev-login: Hexclave returned no tokens for the session.");
  process.exit(1);
}

// Cookie shape mirrors what the Hexclave cookie tokenStore writes/reads in-browser
// (see @hexclave/react client-app-impl): a per-project structured refresh cookie
// plus a shared access cookie holding [refreshToken, accessToken].
const refreshCookieName = `hexclave-refresh-${projectId}--default`;
const refreshCookieValue = JSON.stringify({
  refresh_token: refreshToken,
  updated_at_millis: Date.now(),
});
const accessCookieName = "hexclave-access";
const accessCookieValue = JSON.stringify([refreshToken, accessToken]);
const expires = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

console.log(`dev-login: impersonating ${email} (${user.id}) at ${webUrl}`);

try {
  // Open first so a browser context exists, inject cookies, then reload to pick them up.
  await $`agent-browser open ${webUrl}`;
  await $`agent-browser cookies set ${refreshCookieName} ${refreshCookieValue} --url ${webUrl} --expires ${expires}`;
  await $`agent-browser cookies set ${accessCookieName} ${accessCookieValue} --url ${webUrl} --expires ${expires}`;
  await $`agent-browser reload`;
} catch (err) {
  console.error(
    "dev-login: agent-browser failed. Is it installed (`brew install agent-browser` " +
      "or `npm i -g agent-browser`) and is the web dev server running?\n",
    err,
  );
  process.exit(1);
}

console.log("dev-login: agent-browser is now signed in.");
