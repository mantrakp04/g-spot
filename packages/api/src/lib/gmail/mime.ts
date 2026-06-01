/**
 * Single MIME builder for every outgoing Gmail message.
 *
 * Replaces the three earlier in-tree builders: `gmail-agent-tools.buildRawMessage`,
 * `@g-spot/adapters/gmail.buildReplyMime`, and ad-hoc helpers. Goals:
 *
 *  - Encoded-word RFC 2047 for headers with non-ASCII.
 *  - Quoted-printable for text bodies (don't claim 7bit unless the body really is).
 *  - multipart/alternative when both text and HTML are supplied.
 *  - Locale-aware Re: detection so threading works on non-English subjects.
 *  - One canonical base64url encoder for the wire format Gmail expects.
 */

const REPLY_PREFIXES = [
  "re:",
  "aw:",
  "sv:",
  "antw:",
  "vs:",
  "回复:",
  "回覆:",
  "答复:",
  "rif:",
  "ynt:",
  "wg:",
  "fwd:",
  "fw:",
];

export interface MimeAddress {
  name?: string;
  email: string;
}

export interface MimeBuildInput {
  from: MimeAddress;
  to: MimeAddress[];
  cc?: MimeAddress[];
  bcc?: MimeAddress[];
  replyTo?: MimeAddress;
  subject: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  references?: string;
  threadIsReply?: boolean;
}

const NON_ASCII = /[^\x20-\x7e]/;

function needsEncoding(value: string): boolean {
  return NON_ASCII.test(value) || value.includes("=?");
}

function encodeWord(value: string): string {
  if (!needsEncoding(value)) return value;
  // RFC 2047 base64 encoded-word, UTF-8.
  return `=?utf-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function quoteIfNeeded(name: string): string {
  if (/^[\w \-.']+$/.test(name)) return name;
  // Escape backslashes and quotes, then wrap.
  return `"${name.replace(/[\\"]/g, (m) => `\\${m}`)}"`;
}

export function formatAddress(addr: MimeAddress): string {
  if (!addr.name) return addr.email;
  const display = needsEncoding(addr.name)
    ? encodeWord(addr.name)
    : quoteIfNeeded(addr.name);
  return `${display} <${addr.email}>`;
}

export function formatAddressList(addrs: MimeAddress[]): string {
  return addrs.map(formatAddress).join(", ");
}

/**
 * Quoted-printable encode per RFC 2045 §6.7. Folds at 76 chars.
 */
export function quotedPrintableEncode(input: string): string {
  const bytes = Buffer.from(input, "utf8");
  const lines: string[] = [];
  let line = "";

  const flush = () => {
    lines.push(line);
    line = "";
  };

  const append = (token: string) => {
    if (line.length + token.length > 75) {
      lines.push(`${line}=`);
      line = "";
    }
    line += token;
  };

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 0x0a) {
      flush();
      continue;
    }
    if (b === 0x0d) {
      // CR or CRLF — collapse into the LF we'll see next or treat as line break.
      if (bytes[i + 1] === 0x0a) {
        flush();
        i++;
        continue;
      }
      flush();
      continue;
    }
    if (b === 0x20 || b === 0x09) {
      // Trailing whitespace must be encoded; encode if next byte ends the line.
      if (i + 1 >= bytes.length || bytes[i + 1] === 0x0a || bytes[i + 1] === 0x0d) {
        append(`=${b.toString(16).toUpperCase().padStart(2, "0")}`);
        continue;
      }
      append(String.fromCharCode(b));
      continue;
    }
    if (b === 0x3d || b < 0x20 || b >= 0x7f) {
      append(`=${b.toString(16).toUpperCase().padStart(2, "0")}`);
      continue;
    }
    append(String.fromCharCode(b));
  }
  flush();
  return lines.join("\r\n");
}

function isPureAscii(value: string): boolean {
  return !NON_ASCII.test(value);
}

function htmlBodyTransferEncoding(html: string): "7bit" | "quoted-printable" {
  if (isPureAscii(html) && !html.split("\n").some((l) => l.length > 998)) {
    return "7bit";
  }
  return "quoted-printable";
}

function encodeBody(body: string, encoding: "7bit" | "quoted-printable"): string {
  if (encoding === "7bit") return body.replace(/\r?\n/g, "\r\n");
  return quotedPrintableEncode(body);
}

/**
 * Returns the subject prefixed with `Re: ` only if no recognised reply prefix
 * is present (in any locale we know about). Avoids infinite Re: Re: Re: chains
 * and avoids breaking threading on non-English subjects.
 */
export function ensureReplySubject(subject: string): string {
  const trimmed = subject.trim();
  if (!trimmed) return "Re:";
  const lower = trimmed.toLowerCase();
  for (const prefix of REPLY_PREFIXES) {
    if (lower.startsWith(prefix)) return trimmed;
  }
  return `Re: ${trimmed}`;
}

function buildBoundary(): string {
  return `=_g${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function buildHeaders(headers: Array<[string, string | undefined]>): string {
  return headers
    .filter((h): h is [string, string] => Boolean(h[1]))
    .map(([k, v]) => `${k}: ${v}`)
    .join("\r\n");
}

/**
 * Build an RFC 2822 message (raw, not yet base64url encoded).
 *
 * Caller decides if this is a reply; we don't auto-mutate the subject. Use
 * `ensureReplySubject` first when building a reply.
 */
export function buildMime(input: MimeBuildInput): string {
  const headerLines: Array<[string, string | undefined]> = [
    ["From", formatAddress(input.from)],
    ["To", formatAddressList(input.to)],
  ];
  if (input.cc?.length) headerLines.push(["Cc", formatAddressList(input.cc)]);
  if (input.bcc?.length) headerLines.push(["Bcc", formatAddressList(input.bcc)]);
  if (input.replyTo) headerLines.push(["Reply-To", formatAddress(input.replyTo)]);
  headerLines.push(["Subject", encodeWord(input.subject)]);
  if (input.inReplyTo) headerLines.push(["In-Reply-To", input.inReplyTo]);
  if (input.references) headerLines.push(["References", input.references]);
  headerLines.push(["MIME-Version", "1.0"]);

  const text = input.text;
  const html = input.html;

  if (text && html) {
    const boundary = buildBoundary();
    const htmlEncoding = htmlBodyTransferEncoding(html);
    headerLines.push([
      "Content-Type",
      `multipart/alternative; boundary="${boundary}"`,
    ]);
    const body: string[] = [
      buildHeaders(headerLines),
      "",
      `--${boundary}`,
      `Content-Type: text/plain; charset=utf-8`,
      `Content-Transfer-Encoding: quoted-printable`,
      "",
      quotedPrintableEncode(text),
      `--${boundary}`,
      `Content-Type: text/html; charset=utf-8`,
      `Content-Transfer-Encoding: ${htmlEncoding}`,
      "",
      encodeBody(html, htmlEncoding),
      `--${boundary}--`,
    ];
    return body.join("\r\n");
  }

  if (html) {
    const encoding = htmlBodyTransferEncoding(html);
    headerLines.push(["Content-Type", "text/html; charset=utf-8"]);
    headerLines.push(["Content-Transfer-Encoding", encoding]);
    return [buildHeaders(headerLines), "", encodeBody(html, encoding)].join("\r\n");
  }

  // text only (or fallback)
  const encoding: "7bit" | "quoted-printable" = text && isPureAscii(text)
    ? "7bit"
    : "quoted-printable";
  headerLines.push(["Content-Type", "text/plain; charset=utf-8"]);
  headerLines.push(["Content-Transfer-Encoding", encoding]);
  return [
    buildHeaders(headerLines),
    "",
    encodeBody(text ?? "", encoding),
  ].join("\r\n");
}

export function encodeRawForGmail(rfc822: string): string {
  return Buffer.from(rfc822, "utf8").toString("base64url");
}

export function buildAndEncodeMime(input: MimeBuildInput): string {
  return encodeRawForGmail(buildMime(input));
}
