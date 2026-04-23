import {
  Message,
  NotImplementedError,
  parseMarkdown,
  stringifyMarkdown,
  type Adapter,
  type AdapterPostableMessage,
  type Attachment,
  type ChatInstance,
  type FetchOptions,
  type FetchResult,
  type FormattedContent,
  type RawMessage,
  type ThreadInfo,
} from "chat";
import { z } from "zod";

export type GmailThreadRef = {
  accountId: string;
  gmailThreadId: string;
};

export type GmailRawMessage = {
  id: string;
  threadId: string;
  historyId?: string;
  internalDate?: string;
  labelIds?: string[];
  snippet?: string;
  payload?: GmailMessagePart;
};

export type GmailMessagePart = {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailMessagePart[];
};

export type GmailPushPayload = {
  emailAddress: string;
  historyId: string;
};

export type GmailAccountContext = {
  accessToken: string;
  emailAddress: string;
};

export type GmailTokenProvider = (accountId: string) => Promise<GmailAccountContext>;

export type GmailAccountResolver = (
  emailAddress: string,
) => Promise<Array<{ accountId: string }>>;

export type GmailPushHandler = (args: {
  accountId: string;
  emailAddress: string;
  historyId: string;
  receivedAt: string;
  adapter: Adapter<GmailThreadRef, GmailRawMessage>;
}) => Promise<void>;

export interface GmailAdapterOptions {
  /** Bot username. Required by chat-sdk (used as default from address / display name). */
  userName: string;
  /** Resolve OAuth access token + primary address for a given accountId. */
  tokenProvider: GmailTokenProvider;
  /** Resolve a push-target emailAddress to one or more local accountIds. */
  accountResolver: GmailAccountResolver;
  /** Called once per resolved account when a pub/sub push arrives. */
  onPush: GmailPushHandler;
  /** Optional shared secret for verifying pub/sub pushes (checked in `?token=` or `x-goog-token`). */
  pubsubVerificationToken?: string;
  /** Adapter name. Defaults to "gmail". */
  name?: string;
}

const pubSubEnvelopeSchema = z.object({
  message: z
    .object({
      data: z.string().optional(),
      messageId: z.string().optional(),
      publishTime: z.string().optional(),
    })
    .optional(),
});

const gmailPushPayloadSchema = z.object({
  emailAddress: z.string().min(1),
  historyId: z.coerce.string().min(1),
});

export function createGmailAdapter(
  options: GmailAdapterOptions,
): Adapter<GmailThreadRef, GmailRawMessage> {
  const name = options.name ?? "gmail";
  let chatRef: ChatInstance | null = null;

  const adapter: Adapter<GmailThreadRef, GmailRawMessage> = {
    name,
    userName: options.userName,

    async initialize(chat) {
      chatRef = chat;
    },

    async disconnect() {
      chatRef = null;
    },

    encodeThreadId(data) {
      return `${name}:${data.accountId}:${data.gmailThreadId}`;
    },

    decodeThreadId(threadId) {
      const [prefix, accountId, gmailThreadId, ...rest] = threadId.split(":");
      if (prefix !== name || !accountId || !gmailThreadId || rest.length > 0) {
        throw new Error(`Invalid ${name} thread id: ${threadId}`);
      }
      return { accountId, gmailThreadId };
    },

    channelIdFromThreadId(threadId) {
      const { accountId } = adapter.decodeThreadId(threadId);
      return `${name}:${accountId}`;
    },

    async handleWebhook(request, webhookOptions) {
      if (options.pubsubVerificationToken) {
        const supplied =
          new URL(request.url).searchParams.get("token")
          ?? request.headers.get("x-goog-token")
          ?? request.headers.get("x-gspot-pubsub-token");
        if (supplied !== options.pubsubVerificationToken) {
          return new Response("Unauthorized", { status: 401 });
        }
      }

      let envelope: z.infer<typeof pubSubEnvelopeSchema>;
      try {
        envelope = pubSubEnvelopeSchema.parse(await request.json());
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }

      const data = envelope.message?.data;
      if (!data) return new Response(null, { status: 204 });

      let payload: GmailPushPayload;
      try {
        const decoded = Buffer.from(data, "base64url").toString("utf-8");
        payload = gmailPushPayloadSchema.parse(JSON.parse(decoded));
      } catch {
        return new Response("Invalid pub/sub payload", { status: 400 });
      }

      const receivedAt = envelope.message?.publishTime ?? new Date().toISOString();
      const accounts = await options.accountResolver(payload.emailAddress);

      const run = async () => {
        for (const account of accounts) {
          await options.onPush({
            accountId: account.accountId,
            emailAddress: payload.emailAddress,
            historyId: payload.historyId,
            receivedAt,
            adapter,
          });
        }
      };

      if (webhookOptions?.waitUntil) {
        webhookOptions.waitUntil(run());
      } else {
        await run();
      }

      return new Response(null, { status: 204 });
    },

    parseMessage(raw) {
      const headers = normalizeHeaders(raw.payload?.headers);
      const from = headers.get("from") ?? "";
      const messageIdHeader = headers.get("message-id") ?? raw.id;
      const dateHeader = headers.get("date");
      const internalMs = raw.internalDate ? Number.parseInt(raw.internalDate, 10) : null;
      const dateSent = dateHeader
        ? new Date(dateHeader)
        : internalMs !== null && !Number.isNaN(internalMs)
          ? new Date(internalMs)
          : new Date();

      const text = extractPlainText(raw.payload) ?? raw.snippet ?? "";
      const attachments = extractAttachments(raw.payload);
      const { userName, fullName } = parseFromHeader(from);

      return new Message<GmailRawMessage>({
        id: messageIdHeader,
        threadId: adapter.encodeThreadId({
          accountId: "unknown",
          gmailThreadId: raw.threadId,
        }),
        text,
        formatted: parseMarkdown(text),
        raw,
        author: {
          userId: userName,
          userName,
          fullName: fullName || userName,
          isBot: "unknown",
          isMe: false,
        },
        metadata: {
          dateSent,
          edited: false,
        },
        attachments,
        links: [],
      });
    },

    renderFormatted(content: FormattedContent) {
      return stringifyMarkdown(content);
    },

    async postMessage(threadId, message) {
      const { accountId, gmailThreadId } = adapter.decodeThreadId(threadId);
      const { accessToken, emailAddress } = await options.tokenProvider(accountId);

      const body = adapterMessageToText(adapter, message);
      const mime = buildReplyMime({
        from: emailAddress,
        threadHeaders: await fetchThreadHeaders(accessToken, gmailThreadId),
        body,
      });

      const raw = base64UrlEncode(mime);
      const response = await gmailFetch<{ id: string; threadId: string }>(accessToken, {
        method: "POST",
        path: `/users/me/messages/send`,
        body: { raw, threadId: gmailThreadId },
      });

      return {
        id: response.id,
        threadId: adapter.encodeThreadId({ accountId, gmailThreadId: response.threadId }),
        raw: { id: response.id, threadId: response.threadId },
      } satisfies RawMessage<GmailRawMessage>;
    },

    async editMessage(_threadId, _messageId, _message) {
      throw new NotImplementedError("Gmail messages are immutable and cannot be edited");
    },

    async deleteMessage(threadId, messageId) {
      const { accountId } = adapter.decodeThreadId(threadId);
      const { accessToken } = await options.tokenProvider(accountId);
      await gmailFetch<unknown>(accessToken, {
        method: "POST",
        path: `/users/me/messages/${encodeURIComponent(messageId)}/trash`,
      });
    },

    async addReaction() {
      throw new NotImplementedError("Gmail does not support reactions");
    },

    async removeReaction() {
      throw new NotImplementedError("Gmail does not support reactions");
    },

    async startTyping() {
      // no-op: Gmail has no typing indicator
    },

    async fetchMessages(threadId, fetchOptions?: FetchOptions) {
      const { accountId, gmailThreadId } = adapter.decodeThreadId(threadId);
      const { accessToken } = await options.tokenProvider(accountId);

      const thread = await gmailFetch<{
        id: string;
        messages?: GmailRawMessage[];
      }>(accessToken, {
        method: "GET",
        path: `/users/me/threads/${encodeURIComponent(gmailThreadId)}?format=full`,
      });

      const messages = (thread.messages ?? []).map((raw) => {
        const parsed = adapter.parseMessage(raw);
        (parsed as { threadId: string }).threadId = adapter.encodeThreadId({
          accountId,
          gmailThreadId,
        });
        return parsed;
      });

      const limit = fetchOptions?.limit;
      const direction = fetchOptions?.direction ?? "backward";
      const window = direction === "backward" && limit ? messages.slice(-limit) : limit ? messages.slice(0, limit) : messages;

      return {
        messages: window,
        nextCursor: undefined,
      } satisfies FetchResult<GmailRawMessage>;
    },

    async fetchThread(threadId): Promise<ThreadInfo> {
      const { accountId, gmailThreadId } = adapter.decodeThreadId(threadId);
      return {
        id: threadId,
        channelId: adapter.channelIdFromThreadId(threadId),
        channelName: accountId,
        isDM: false,
        metadata: { gmailThreadId, accountId },
      };
    },
  };

  // Reference chatRef to silence unused warning when handlers don't need it yet.
  void chatRef;

  return adapter;
}

// ----------------------------------------------------------------------------
// Gmail REST helpers
// ----------------------------------------------------------------------------

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1";

type GmailRequest = {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
};

async function gmailFetch<T>(accessToken: string, req: GmailRequest): Promise<T> {
  const response = await fetch(`${GMAIL_BASE}${req.path}`, {
    method: req.method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(req.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Gmail API ${req.method} ${req.path} failed (${response.status}): ${errText}`,
    );
  }

  return (await response.json()) as T;
}

async function fetchThreadHeaders(
  accessToken: string,
  gmailThreadId: string,
): Promise<Map<string, string>> {
  const thread = await gmailFetch<{
    messages?: Array<{ payload?: GmailMessagePart }>;
  }>(accessToken, {
    method: "GET",
    path: `/users/me/threads/${encodeURIComponent(gmailThreadId)}?format=metadata&metadataHeaders=Message-Id&metadataHeaders=References&metadataHeaders=Subject&metadataHeaders=From`,
  });

  const last = thread.messages?.[thread.messages.length - 1];
  return normalizeHeaders(last?.payload?.headers);
}

// ----------------------------------------------------------------------------
// MIME + encoding
// ----------------------------------------------------------------------------

function buildReplyMime(args: {
  from: string;
  threadHeaders: Map<string, string>;
  body: string;
}): string {
  const inReplyTo = args.threadHeaders.get("message-id");
  const referencesPrev = args.threadHeaders.get("references");
  const references = [referencesPrev, inReplyTo].filter(Boolean).join(" ");
  const subjectRaw = args.threadHeaders.get("subject") ?? "";
  const subject = subjectRaw.toLowerCase().startsWith("re:")
    ? subjectRaw
    : subjectRaw
      ? `Re: ${subjectRaw}`
      : "";
  const toHeader = args.threadHeaders.get("from") ?? "";

  const lines = [
    `From: ${args.from}`,
    toHeader ? `To: ${toHeader}` : null,
    subject ? `Subject: ${subject}` : null,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    references ? `References: ${references}` : null,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    args.body,
  ].filter((line): line is string => line !== null);

  return lines.join("\r\n");
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ----------------------------------------------------------------------------
// Message parsing helpers
// ----------------------------------------------------------------------------

function normalizeHeaders(
  headers: Array<{ name: string; value: string }> | undefined,
): Map<string, string> {
  const out = new Map<string, string>();
  if (!headers) return out;
  for (const { name, value } of headers) {
    out.set(name.toLowerCase(), value);
  }
  return out;
}

function extractPlainText(part: GmailMessagePart | undefined): string | null {
  if (!part) return null;

  if (part.mimeType === "text/plain" && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }

  if (part.parts) {
    for (const child of part.parts) {
      const text = extractPlainText(child);
      if (text) return text;
    }
  }

  if (part.mimeType === "text/html" && part.body?.data) {
    return stripHtml(decodeBase64Url(part.body.data));
  }

  return null;
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf-8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+\n/g, "\n")
    .trim();
}

function extractAttachments(part: GmailMessagePart | undefined): Attachment[] {
  if (!part) return [];
  const out: Attachment[] = [];
  walkParts(part, (p) => {
    if (p.filename && p.body?.attachmentId) {
      out.push({
        type: inferAttachmentType(p.mimeType),
        mimeType: p.mimeType,
        name: p.filename,
        size: p.body.size,
      });
    }
  });
  return out;
}

function walkParts(part: GmailMessagePart, visit: (p: GmailMessagePart) => void): void {
  visit(part);
  if (part.parts) {
    for (const child of part.parts) walkParts(child, visit);
  }
}

function inferAttachmentType(mimeType: string | undefined): Attachment["type"] {
  if (!mimeType) return "file";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
}

function parseFromHeader(from: string): { userName: string; fullName: string } {
  const match = from.match(/^\s*(?:"?([^"<]*)"?\s*)?<?([^>]+@[^>]+)>?\s*$/);
  const fullName = match?.[1]?.trim() ?? "";
  const email = match?.[2]?.trim() ?? from.trim();
  return { userName: email, fullName };
}

function adapterMessageToText(
  adapter: Adapter<GmailThreadRef, GmailRawMessage>,
  message: AdapterPostableMessage,
): string {
  if (typeof message === "string") return message;
  if ("raw" in message && typeof message.raw === "string") return message.raw;
  if ("markdown" in message && typeof message.markdown === "string") return message.markdown;
  if ("ast" in message && message.ast) return stringifyMarkdown(message.ast);
  if ("card" in message) return message.fallbackText ?? adapter.renderFormatted(parseMarkdown(""));
  // CardElement — no fallback text available, render empty
  return "";
}
