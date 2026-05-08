/**
 * Gmail message + thread parsing.
 *
 * One canonical implementation that:
 *  - Uses `addressparser` for headers (RFC 2047, IDN, group syntax).
 *  - Walks payloads container-aware (multipart/alternative picks last text+html;
 *    multipart/related and multipart/mixed prefer the leading body part).
 *  - Body text is derived from text/plain when present, else from the HTML via
 *    `html-to-text` (keeps URLs and reasonable structure).
 */

// addressparser ships no types; declare inline.
// @ts-expect-error — pre-ESM CJS module without bundled types
import addressparser from "addressparser";
import { convert as htmlToText } from "html-to-text";

type AddressParserResult = Array<{ name?: string; address?: string }>;
type AddressParser = (raw: string) => AddressParserResult;
const parseAddresses = addressparser as AddressParser;

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

export interface ParsedAddress {
  name: string;
  email: string;
}

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

export function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

export function parseAddressList(raw: string): ParsedAddress[] {
  if (!raw) return [];
  const list = parseAddresses(raw);
  const out: ParsedAddress[] = [];
  for (const entry of list) {
    if (!entry.address) continue;
    out.push({
      name: (entry.name ?? "").trim(),
      email: entry.address.trim(),
    });
  }
  return out;
}

export function parseFromHeader(raw: string): ParsedAddress {
  const list = parseAddressList(raw);
  if (list.length > 0) return list[0]!;
  // Bare token / fallback so callers always get a string.
  const trimmed = raw.trim();
  return { name: trimmed, email: trimmed };
}

/**
 * Walk a Gmail payload tree and pick the best text + html bodies.
 *
 * - For `multipart/alternative` we pick the LAST text and LAST html part (HTML
 *   is conventionally the richer last entry).
 * - For everything else we recurse depth-first and keep the first body of each
 *   kind we encounter.
 */
export function extractBody(
  part: GmailPayloadPart,
): { html: string | null; text: string | null } {
  if (part.mimeType === "text/html" && part.body?.data) {
    return { html: decodeBase64Url(part.body.data), text: null };
  }
  if (part.mimeType === "text/plain" && part.body?.data) {
    return { html: null, text: decodeBase64Url(part.body.data) };
  }

  if (!part.parts) return { html: null, text: null };

  const isAlternative = part.mimeType === "multipart/alternative";
  let html: string | null = null;
  let text: string | null = null;

  for (const sub of part.parts) {
    const result = extractBody(sub);
    if (isAlternative) {
      // Prefer last occurrence in alternatives.
      if (result.html) html = result.html;
      if (result.text) text = result.text;
    } else {
      // Keep first occurrence elsewhere.
      if (result.html && !html) html = result.html;
      if (result.text && !text) text = result.text;
    }
  }
  return { html, text };
}

/** Convert HTML to plain text, preserving URLs. */
export function htmlBodyToText(html: string): string {
  return htmlToText(html, {
    wordwrap: false,
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "script", format: "skip" },
      { selector: "a", options: { ignoreHref: false, hideLinkHrefIfSameAsText: true } },
    ],
  }).trim();
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function parseAttachments(msg: GmailApiMessage): ParsedAttachment[] {
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
    if (part.parts) for (const sub of part.parts) walk(sub);
  }
  if (msg.payload) walk(msg.payload);
  return attachments;
}

export function parseGmailMessage(msg: GmailApiMessage): ParsedMessage {
  const from = parseFromHeader(getHeader(msg, "From"));
  const body = msg.payload
    ? extractBody(msg.payload)
    : { html: null, text: null };

  let bodyText = body.text;
  if (!bodyText && body.html) bodyText = htmlBodyToText(body.html);

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
    bodyText,
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
