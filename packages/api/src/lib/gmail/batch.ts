/**
 * Gmail multipart/mixed batch helper.
 *
 * Wraps `https://gmail.googleapis.com/batch/gmail/v1` so we can fan out reads
 * (`messages.batchGet`, `threads.get`) and writes (`messages.batchModify`)
 * with a single HTTP round-trip per N requests. Gmail caps batches at 100.
 */

import { acquireGmailToken } from "./rate-limit";
import { GMAIL_BATCH_URL } from "./client";
import { GmailApiError, parseGmailRetryAfterSeconds } from "./errors";

const MAX_BATCH = 100;

export interface BatchSubRequest {
  /** Identifier echoed on the matching response part. */
  id: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  /** Path WITH leading slash, e.g. `/gmail/v1/users/me/threads/abc?format=full`. */
  path: string;
  body?: unknown;
}

export interface BatchSubResponse<T> {
  id: string;
  status: number;
  body: T | null;
  error: GmailApiError | null;
}

function buildMultipartBody(
  requests: BatchSubRequest[],
  boundary: string,
): string {
  const parts: string[] = [];
  for (const req of requests) {
    const lines: string[] = [];
    lines.push(`--${boundary}`);
    lines.push("Content-Type: application/http");
    lines.push(`Content-ID: <${req.id}>`);
    lines.push("");
    lines.push(`${req.method} ${req.path}`);
    if (req.body !== undefined) {
      lines.push("Content-Type: application/json");
      lines.push("");
      lines.push(JSON.stringify(req.body));
    } else {
      lines.push("");
    }
    parts.push(lines.join("\r\n"));
  }
  parts.push(`--${boundary}--`);
  return parts.join("\r\n");
}

function extractBoundary(contentType: string | null): string | null {
  if (!contentType) return null;
  const m = contentType.match(/boundary=([^;]+)/i);
  if (!m?.[1]) return null;
  return m[1].replace(/^"|"$/g, "");
}

function parseSubResponse<T>(rawPart: string): BatchSubResponse<T> {
  // Each part: HTTP headers, blank line, HTTP status line, blank line, body.
  const idMatch = rawPart.match(/Content-ID:\s*<response-([^>]+)>/i);
  const id = idMatch?.[1] ?? "";
  // Strip the outer "Content-Type: application/http" envelope and grab the inner.
  const innerStart = rawPart.indexOf("\r\n\r\n");
  if (innerStart === -1) {
    return {
      id,
      status: 0,
      body: null,
      error: new GmailApiError(0, "malformed batch part"),
    };
  }
  const inner = rawPart.slice(innerStart + 4);
  const statusLineEnd = inner.indexOf("\r\n");
  const statusLine = statusLineEnd === -1 ? inner : inner.slice(0, statusLineEnd);
  const statusMatch = statusLine.match(/HTTP\/[\d.]+\s+(\d+)\s*(.*)/);
  const status = statusMatch?.[1] ? Number(statusMatch[1]) : 0;
  const statusText = statusMatch?.[2] ?? "";
  const headersEnd = inner.indexOf("\r\n\r\n");
  const body = headersEnd === -1 ? "" : inner.slice(headersEnd + 4).replace(/\r?\n+$/, "");

  let parsedBody: T | null = null;
  let parsedError: GmailApiError | null = null;
  if (status >= 200 && status < 300) {
    if (body.length > 0) {
      try {
        parsedBody = JSON.parse(body) as T;
      } catch {
        parsedBody = null;
      }
    }
  } else {
    let reason: string | undefined;
    let detail: string | undefined;
    try {
      const parsed = JSON.parse(body) as {
        error?: { message?: string; errors?: Array<{ reason?: string }> };
      };
      reason = parsed.error?.errors?.[0]?.reason;
      detail = parsed.error?.message;
    } catch {
      detail = body.slice(0, 200);
    }
    parsedError = new GmailApiError(
      status,
      statusText,
      parseGmailRetryAfterSeconds({ detail }),
      reason,
      detail,
    );
  }
  return { id, status, body: parsedBody, error: parsedError };
}

function splitMultipart(body: string, boundary: string): string[] {
  const delimiter = `--${boundary}`;
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < body.length) {
    const start = body.indexOf(delimiter, cursor);
    if (start === -1) break;
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const part = body.slice(start + delimiter.length, next).replace(/^\r?\n/, "");
    if (part.length > 0) parts.push(part);
    cursor = next;
  }
  return parts;
}

async function executeBatchChunk<T>(
  token: string,
  requests: BatchSubRequest[],
): Promise<BatchSubResponse<T>[]> {
  if (requests.length === 0) return [];

  await acquireGmailToken();

  const boundary = `=_g-batch-${Math.random().toString(36).slice(2)}`;
  const body = buildMultipartBody(requests, boundary);

  const res = await fetch(GMAIL_BATCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/mixed; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GmailApiError(
      res.status,
      res.statusText,
      parseGmailRetryAfterSeconds({
        header: res.headers.get("Retry-After"),
        detail: text,
      }),
      undefined,
      text.slice(0, 200),
    );
  }

  const responseBoundary = extractBoundary(res.headers.get("Content-Type"));
  if (!responseBoundary) {
    throw new GmailApiError(
      0,
      "missing batch boundary",
      undefined,
      undefined,
      "Gmail batch response had no boundary",
    );
  }

  const text = await res.text();
  const parts = splitMultipart(text, responseBoundary);
  return parts.map((part) => parseSubResponse<T>(part));
}

/**
 * Execute a batch of sub-requests, transparently chunked at MAX_BATCH.
 *
 * Each response carries its sub-request id for caller-side correlation.
 */
export async function executeGmailBatch<T>(
  token: string,
  requests: BatchSubRequest[],
): Promise<BatchSubResponse<T>[]> {
  if (requests.length === 0) return [];
  const responses: BatchSubResponse<T>[] = [];
  for (let i = 0; i < requests.length; i += MAX_BATCH) {
    const chunk = requests.slice(i, i + MAX_BATCH);
    const chunkResponses = await executeBatchChunk<T>(token, chunk);
    responses.push(...chunkResponses);
  }
  return responses;
}

/**
 * Convenience: batch-modify labels on N message ids in one shot.
 * Gmail expects up to 1000 ids per `messages.batchModify` call, so we don't
 * need batch endpoints for this — direct POST is enough.
 */
export async function gmailBatchModifyMessages(
  token: string,
  messageIds: string[],
  addLabelIds?: string[],
  removeLabelIds?: string[],
): Promise<void> {
  if (messageIds.length === 0) return;
  const url = "https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify";
  await acquireGmailToken();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ids: messageIds,
      ...(addLabelIds?.length ? { addLabelIds } : {}),
      ...(removeLabelIds?.length ? { removeLabelIds } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GmailApiError(
      res.status,
      res.statusText,
      parseGmailRetryAfterSeconds({
        header: res.headers.get("Retry-After"),
        detail: text,
      }),
      undefined,
      text.slice(0, 200),
    );
  }
}
