/**
 * Server-side Gmail API client.
 *
 * Ported from apps/web/src/lib/gmail/api.ts but adapted for Node/Bun
 * (Buffer instead of atob, no DOM for HTML entity decoding).
 */

import { acquireGmailToken } from "./gmail-rate-limiter";

export const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

// ---------------------------------------------------------------------------
// Types — raw Gmail API shapes
// ---------------------------------------------------------------------------

export type GmailPayloadPart = {
  mimeType?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPayloadPart[];
  filename?: string;
};

export type GmailApiMessage = {
  id: string;
  threadId: string;
  snippet: string;
  labelIds?: string[];
  payload?: GmailPayloadPart;
  historyId?: string;
  internalDate?: string;
  sizeEstimate?: number;
};

export type GmailApiThread = {
  id: string;
  historyId?: string;
  messages: GmailApiMessage[];
};

export type GmailApiLabel = {
  id: string;
  name: string;
  type: "system" | "user";
  color?: { textColor: string; backgroundColor: string };
};

// ---------------------------------------------------------------------------
// Parsed output types
// ---------------------------------------------------------------------------

export interface ParsedMessage {
  gmailMessageId: string;
  gmailThreadId: string;
  fromName: string;
  fromEmail: string;
  toHeader: string;
  ccHeader: string;
  subject: string;
  date: string;
  bodyHtml: string | null;
  bodyText: string | null;
  snippet: string;
  labels: string[];
  messageIdHeader: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  isDraft: boolean;
  historyId: string | null;
  rawSizeEstimate: number | null;
}

export interface ParsedAttachment {
  gmailAttachmentId: string | null;
  filename: string;
  mimeType: string;
  size: number;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

export class GmailApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public retryAfter?: number,
    public reason?: string,
    public detail?: string,
  ) {
    const suffix = reason || detail ? ` — ${[reason, detail].filter(Boolean).join(": ")}` : "";
    super(`Gmail API error: ${status} ${statusText}${suffix}`);
    this.name = "GmailApiError";
  }

  get isRateLimit(): boolean {
    if (this.status === 429) return true;
    if (this.status === 403 && this.reason) {
      return (
        this.reason === "rateLimitExceeded"
        || this.reason === "userRateLimitExceeded"
        || this.reason === "quotaExceeded"
        || this.reason === "dailyLimitExceeded"
      );
    }
    return false;
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }
}

function parseRetryAfterHeader(value: string | null): number | undefined {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;

  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) return undefined;

  return Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
}

function parseRetryAfterFromDetail(detail: string | undefined): number | undefined {
  if (!detail) return undefined;

  const match = detail.match(/\bRetry after\s+([^\s.]+(?:\.\d+)?Z?)/i);
  if (!match?.[1]) return undefined;

  const retryAt = Date.parse(match[1]);
  if (!Number.isFinite(retryAt)) return undefined;

  return Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
}

export function parseGmailRetryAfterSeconds(input: {
  header?: string | null;
  detail?: string;
}): number | undefined {
  return parseRetryAfterHeader(input.header ?? null) ?? parseRetryAfterFromDetail(input.detail);
}

async function buildGmailApiError(res: Response): Promise<GmailApiError> {
  const body = await res.text().catch(() => "");
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

  return new GmailApiError(
    res.status,
    res.statusText,
    parseGmailRetryAfterSeconds({
      header: res.headers.get("Retry-After"),
      detail,
    }),
    reason,
    detail,
  );
}

export async function fetchGmailJson<T>(url: string, token: string): Promise<T> {
  await acquireGmailToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw await buildGmailApiError(res);
  }

  return await res.json() as T;
}

// ---------------------------------------------------------------------------
// Header helpers
// ---------------------------------------------------------------------------

export function getHeader(
  msg: { payload?: { headers?: Array<{ name: string; value: string }> } },
  name: string,
): string {
  return (
    msg.payload?.headers?.find(
      (h) => h.name.toLowerCase() === name.toLowerCase(),
    )?.value ?? ""
  );
}

export function parseFromHeader(raw: string): { name: string; email: string } {
  const namedMatch = raw.match(/^(.+?)\s*<(.+?)>$/);
  if (namedMatch) {
    return {
      name: namedMatch[1]!.trim().replace(/^"|"$/g, ""),
      email: namedMatch[2]!,
    };
  }
  const bareAngle = raw.match(/^<(.+?)>$/);
  if (bareAngle) {
    return { name: bareAngle[1]!.split("@")[0]!, email: bareAngle[1]! };
  }
  return { name: raw, email: raw };
}

// ---------------------------------------------------------------------------
// Body decoding — server-safe (no DOM)
// ---------------------------------------------------------------------------

export function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

export function extractBody(
  part: GmailPayloadPart,
): { html: string | null; text: string | null } {
  if (part.mimeType === "text/html" && part.body?.data) {
    return { html: decodeBase64Url(part.body.data), text: null };
  }
  if (part.mimeType === "text/plain" && part.body?.data) {
    return { html: null, text: decodeBase64Url(part.body.data) };
  }
  if (part.parts) {
    let html: string | null = null;
    let text: string | null = null;
    for (const sub of part.parts) {
      const result = extractBody(sub);
      if (result.html) html = result.html;
      if (result.text) text = result.text;
    }
    return { html, text };
  }
  return { html: null, text: null };
}

/** Strip HTML tags to get plain text (server-safe, no DOM). */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Decode HTML entities in snippet text (server-safe). */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// ---------------------------------------------------------------------------
// Attachment extraction
// ---------------------------------------------------------------------------

function extractAttachments(msg: GmailApiMessage): ParsedAttachment[] {
  const attachments: ParsedAttachment[] = [];

  function walk(part: GmailPayloadPart) {
    if (part.filename && part.filename.length > 0 && part.body) {
      attachments.push({
        gmailAttachmentId: part.body.attachmentId ?? null,
        filename: part.filename,
        mimeType: part.mimeType ?? "application/octet-stream",
        size: part.body.size ?? 0,
      });
    }
    if (part.parts) {
      for (const sub of part.parts) walk(sub);
    }
  }

  if (msg.payload) walk(msg.payload);
  return attachments;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get user profile (email address and current historyId).
 */
export async function getProfile(
  token: string,
): Promise<{ emailAddress: string; historyId: string }> {
  const data = await fetchGmailJson<{
    emailAddress: string;
    historyId: string;
  }>(`${GMAIL_API}/profile`, token);
  return data;
}

/**
 * Paginate through ALL thread IDs in the mailbox.
 */
export async function listAllThreadIds(
  token: string,
  query?: string,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ maxResults: "500" });
    if (query) params.set("q", query);
    if (pageToken) params.set("pageToken", pageToken);

    const data = await fetchGmailJson<{
      threads?: Array<{ id: string }>;
      nextPageToken?: string;
    }>(`${GMAIL_API}/threads?${params.toString()}`, token);

    for (const t of data.threads ?? []) {
      ids.push(t.id);
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return ids;
}

export async function listAllDraftMappings(
  token: string,
): Promise<Array<{ draftId: string; gmailMessageId: string }>> {
  const mappings: Array<{ draftId: string; gmailMessageId: string }> = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ maxResults: "500" });
    if (pageToken) params.set("pageToken", pageToken);

    const data = await fetchGmailJson<{
      drafts?: Array<{ id: string; message: { id: string; threadId: string } }>;
      nextPageToken?: string;
    }>(`${GMAIL_API}/drafts?${params.toString()}`, token);

    for (const d of data.drafts ?? []) {
      mappings.push({ draftId: d.id, gmailMessageId: d.message.id });
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return mappings;
}

/**
 * Get a single thread with full message payloads.
 */
export async function getThreadDetail(
  token: string,
  threadId: string,
): Promise<GmailApiThread> {
  return fetchGmailJson<GmailApiThread>(
    `${GMAIL_API}/threads/${encodeURIComponent(threadId)}?format=full`,
    token,
  );
}

/**
 * Get changed thread IDs since a historyId (for incremental sync).
 * Returns expired=true if the historyId is too old.
 */
export async function getHistory(
  token: string,
  startHistoryId: string,
): Promise<{
  threadIds: string[];
  newHistoryId: string;
  expired: boolean;
}> {
  const threadIds = new Set<string>();
  let pageToken: string | undefined;
  let newHistoryId = startHistoryId;

  try {
    do {
      const params = new URLSearchParams({
        startHistoryId,
        maxResults: "500",
      });
      if (pageToken) params.set("pageToken", pageToken);

      const data = await fetchGmailJson<{
        history?: Array<{
          messages?: Array<{ id: string; threadId: string }>;
          messagesAdded?: Array<{ message: { threadId: string } }>;
          messagesDeleted?: Array<{ message: { threadId: string } }>;
          labelsAdded?: Array<{ message: { threadId: string } }>;
          labelsRemoved?: Array<{ message: { threadId: string } }>;
        }>;
        historyId?: string;
        nextPageToken?: string;
      }>(`${GMAIL_API}/history?${params.toString()}`, token);

      if (data.historyId) newHistoryId = data.historyId;

      for (const entry of data.history ?? []) {
        for (const m of entry.messages ?? []) threadIds.add(m.threadId);
        for (const m of entry.messagesAdded ?? []) threadIds.add(m.message.threadId);
        for (const m of entry.messagesDeleted ?? []) threadIds.add(m.message.threadId);
        for (const m of entry.labelsAdded ?? []) threadIds.add(m.message.threadId);
        for (const m of entry.labelsRemoved ?? []) threadIds.add(m.message.threadId);
      }

      pageToken = data.nextPageToken;
    } while (pageToken);
  } catch (err) {
    if (err instanceof GmailApiError && err.status === 404) {
      return { threadIds: [], newHistoryId: startHistoryId, expired: true };
    }
    throw err;
  }

  return { threadIds: Array.from(threadIds), newHistoryId, expired: false };
}

/**
 * Get all labels for the account.
 */
export async function listLabels(token: string): Promise<GmailApiLabel[]> {
  const data = await fetchGmailJson<{ labels: GmailApiLabel[] }>(
    `${GMAIL_API}/labels`,
    token,
  );
  return data.labels ?? [];
}

export async function watchMailbox(
  token: string,
  input: {
    topicName: string;
    labelIds?: string[];
    labelFilterBehavior?: "include" | "exclude";
  },
): Promise<{ historyId: string; expiration: string }> {
  const res = await fetch(`${GMAIL_API}/watch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topicName: input.topicName,
      ...(input.labelIds?.length ? { labelIds: input.labelIds } : {}),
      ...(input.labelFilterBehavior
        ? { labelFilterBehavior: input.labelFilterBehavior }
        : {}),
    }),
  });

  if (!res.ok) {
    throw await buildGmailApiError(res);
  }

  return await res.json() as { historyId: string; expiration: string };
}

/**
 * Parse a raw Gmail API message into the DB model shape.
 */
export function parseGmailMessage(msg: GmailApiMessage): ParsedMessage {
  const from = parseFromHeader(getHeader(msg, "From"));
  const body = msg.payload ? extractBody(msg.payload) : { html: null, text: null };

  // If we got HTML but no text, strip HTML for a text version
  let bodyText = body.text;
  if (!bodyText && body.html) {
    bodyText = stripHtml(body.html);
  }

  return {
    gmailMessageId: msg.id,
    gmailThreadId: msg.threadId,
    fromName: from.name,
    fromEmail: from.email,
    toHeader: getHeader(msg, "To"),
    ccHeader: getHeader(msg, "Cc"),
    subject: getHeader(msg, "Subject") || "(no subject)",
    date: new Date(Number(msg.internalDate)).toISOString(),
    bodyHtml: body.html,
    bodyText: bodyText,
    snippet: decodeHtmlEntities(msg.snippet ?? ""),
    labels: msg.labelIds ?? [],
    messageIdHeader: getHeader(msg, "Message-ID") || null,
    inReplyTo: getHeader(msg, "In-Reply-To") || null,
    referencesHeader: getHeader(msg, "References") || null,
    isDraft: (msg.labelIds ?? []).includes("DRAFT"),
    historyId: msg.historyId ?? null,
    rawSizeEstimate: msg.sizeEstimate ?? null,
  };
}

/**
 * Parse attachment metadata from a message.
 */
export { extractAttachments as parseAttachments };

/**
 * Convert a parsed thread into a text summary suitable for LLM extraction.
 */
export function threadToText(
  subject: string,
  messages: ParsedMessage[],
): string {
  const lines: string[] = [`Subject: ${subject}`, ""];

  for (const msg of messages) {
    lines.push(`--- Message from ${msg.fromName} <${msg.fromEmail}> ---`);
    lines.push(`Date: ${msg.date}`);
    if (msg.toHeader) lines.push(`To: ${msg.toHeader}`);
    if (msg.ccHeader) lines.push(`Cc: ${msg.ccHeader}`);
    lines.push("");
    lines.push(msg.bodyText ?? msg.snippet ?? "");
    lines.push("");
  }

  return lines.join("\n");
}
