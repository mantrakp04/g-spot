/**
 * Single Gmail HTTP entry point.
 *
 * Every Gmail API request — JSON GET/POST, no-content mutations, batch
 * multipart — flows through `gmailFetch`. Shared rate limiter, shared error
 * surface, shared body decoding.
 */

import { acquireGmailToken } from "./rate-limit";
import { buildGmailApiError } from "./errors";

export const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
export const GMAIL_BATCH_URL = "https://gmail.googleapis.com/batch/gmail/v1";

type FetchInit = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
};

async function gmailFetchRaw(url: string, token: string, init?: FetchInit): Promise<Response> {
  await acquireGmailToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(init?.headers ?? {}),
  };
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) throw await buildGmailApiError(res);
  return res;
}

/** GET/POST returning JSON. */
export async function gmailFetch<T>(
  url: string,
  token: string,
  init?: FetchInit,
): Promise<T> {
  const res = await gmailFetchRaw(url, token, init);
  return (await res.json()) as T;
}

/** POST/PUT/DELETE returning empty body. */
export async function gmailFetchNoContent(
  url: string,
  token: string,
  init?: FetchInit,
): Promise<void> {
  const res = await gmailFetchRaw(url, token, init);
  await res.body?.cancel().catch(() => undefined);
}

/** Used by batch.ts to fire one multipart/mixed request. */
export async function gmailFetchText(
  url: string,
  token: string,
  init?: FetchInit,
): Promise<{ text: string; contentType: string | null }> {
  const res = await gmailFetchRaw(url, token, init);
  return {
    text: await res.text(),
    contentType: res.headers.get("Content-Type"),
  };
}

/**
 * POST JSON helper.
 */
export async function gmailPost<T>(
  url: string,
  token: string,
  body: unknown,
): Promise<T> {
  return gmailFetch<T>(url, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Build a Gmail API URL from a path under `/users/me/` (e.g.
 * `gmailUrl("threads/abc?format=full")`).
 */
export function gmailUrl(pathAndQuery: string): string {
  return `${GMAIL_API}/${pathAndQuery}`;
}
