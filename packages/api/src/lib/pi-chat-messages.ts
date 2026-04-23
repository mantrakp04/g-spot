import { env } from "@g-spot/env/server";
import type { Message, UserMessage } from "@mariozechner/pi-ai";

import { detectDocumentKind, extractDocumentText } from "./extract-document";

const INLINE_TEXT_FILE_EXTENSIONS = new Set([
  "c",
  "cc",
  "cpp",
  "css",
  "csv",
  "go",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "md",
  "markdown",
  "mjs",
  "py",
  "rb",
  "rs",
  "sh",
  "sql",
  "svg",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

const INLINE_TEXT_MEDIA_TYPES = new Set([
  "application/javascript",
  "application/json",
  "application/ld+json",
  "application/sql",
  "application/toml",
  "application/typescript",
  "application/x-httpd-php",
  "application/x-javascript",
  "application/x-sh",
  "application/x-typescript",
  "application/x-yaml",
  "application/xml",
  "application/yaml",
  "image/svg+xml",
]);

type ChatMessageRow = {
  id: string;
  message: string;
  createdAt: string;
};

type IncomingUserPart = {
  type?: unknown;
  text?: unknown;
  url?: unknown;
  mediaType?: unknown;
  filename?: unknown;
};

type IncomingUserMessage = {
  role?: unknown;
  parts?: unknown;
};

function getServerOrigin() {
  return `http://${env.SERVER_HOST}:${env.SERVER_PORT}`;
}

function resolveAttachmentUrl(url: string) {
  return new URL(url, getServerOrigin()).toString();
}

function getFileExtension(filename: string | undefined) {
  if (!filename) {
    return null;
  }

  const extension = filename.split(".").pop()?.trim().toLowerCase();
  return extension && extension.length > 0 ? extension : null;
}

function isTextLikeFile(part: IncomingUserPart) {
  const mediaType =
    typeof part.mediaType === "string"
      ? part.mediaType.trim().toLowerCase()
      : null;

  if (mediaType) {
    if (mediaType.startsWith("image/") || mediaType === "application/pdf") {
      return false;
    }

    if (
      mediaType.startsWith("text/") ||
      mediaType.endsWith("+json") ||
      mediaType.endsWith("+xml") ||
      INLINE_TEXT_MEDIA_TYPES.has(mediaType)
    ) {
      return true;
    }
  }

  const extension =
    typeof part.filename === "string"
      ? getFileExtension(part.filename)
      : null;
  return extension ? INLINE_TEXT_FILE_EXTENSIONS.has(extension) : false;
}

async function readTextFromUrl(url: string) {
  const response = await fetch(resolveAttachmentUrl(url));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

async function readImageFromUrl(url: string, mediaType?: string) {
  const response = await fetch(resolveAttachmentUrl(url));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer()).toString("base64");
  return {
    type: "image" as const,
    data: bytes,
    mimeType: response.headers.get("content-type") ?? mediaType ?? "image/png",
  };
}

async function readArrayBufferFromUrl(url: string) {
  const response = await fetch(resolveAttachmentUrl(url));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.arrayBuffer();
}

function escapeXmlAttr(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function extractFileIdFromUrl(url: string): string | null {
  const match = url.match(/\/api\/files\/([^/?#]+)/);
  return match?.[1] ?? null;
}

/**
 * Envelope format that survives pi-coding-agent's `sendUserMessage` text-join:
 * every text block gets joined with "\n" into one string, so the client has
 * to pull attachments back out via tag parsing.
 */
function createAttachmentEnvelope(
  filename: string | undefined,
  fileId: string | null,
  mediaType: string | undefined,
  body: string,
) {
  const attrs: string[] = [];
  if (filename) attrs.push(`filename="${escapeXmlAttr(filename)}"`);
  if (fileId) attrs.push(`fileId="${escapeXmlAttr(fileId)}"`);
  if (mediaType) attrs.push(`mediaType="${escapeXmlAttr(mediaType)}"`);
  const openTag = attrs.length > 0
    ? `<gs-attachment ${attrs.join(" ")}>`
    : "<gs-attachment>";
  return `${openTag}\n${body}\n</gs-attachment>`;
}

async function createUserContentFromParts(
  parts: unknown,
): Promise<Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>> {
  if (!Array.isArray(parts)) {
    return [];
  }

  // Split into buckets so attachments land ABOVE the user's typed text after
  // pi-coding-agent joins adjacent text blocks with "\n". Order in output:
  //   [doc attachments..., image blocks..., user text].
  const attachmentBlocks: Array<{ type: "text"; text: string }> = [];
  const imageBlocks: Array<{ type: "image"; data: string; mimeType: string }> = [];
  const textBlocks: Array<{ type: "text"; text: string }> = [];

  for (const rawPart of parts) {
    const part = rawPart as IncomingUserPart;

    if (part.type === "text" && typeof part.text === "string") {
      const text = part.text.trim();
      if (text.length > 0) {
        textBlocks.push({ type: "text", text });
      }
      continue;
    }

    if (part.type !== "file" || typeof part.url !== "string") {
      continue;
    }

    const filename =
      typeof part.filename === "string" ? part.filename : undefined;
    const mediaType =
      typeof part.mediaType === "string" ? part.mediaType : undefined;
    const fileId = extractFileIdFromUrl(part.url);

    if (mediaType?.startsWith("image/")) {
      imageBlocks.push(await readImageFromUrl(part.url, mediaType));
      continue;
    }

    if (isTextLikeFile(part)) {
      attachmentBlocks.push({
        type: "text",
        text: createAttachmentEnvelope(
          filename,
          fileId,
          mediaType ?? "text/plain",
          await readTextFromUrl(part.url),
        ),
      });
      continue;
    }

    const kind = detectDocumentKind(mediaType, filename);

    if (kind) {
      try {
        const buffer = await readArrayBufferFromUrl(part.url);
        const extracted = await extractDocumentText(
          buffer,
          kind,
          filename ?? "attachment",
        );
        attachmentBlocks.push({
          type: "text",
          text: createAttachmentEnvelope(filename, fileId, mediaType, extracted),
        });
      } catch (error) {
        console.error("Failed to extract document text", {
          filename,
          mediaType,
          kind,
          error,
        });
        attachmentBlocks.push({
          type: "text",
          text: createAttachmentEnvelope(
            filename,
            fileId,
            mediaType,
            `[Failed to extract ${kind.toUpperCase()} contents: ${
              error instanceof Error ? error.message : String(error)
            }]`,
          ),
        });
      }
      continue;
    }

    attachmentBlocks.push({
      type: "text",
      text: createAttachmentEnvelope(
        filename,
        fileId,
        mediaType,
        "[Unsupported attachment omitted from model context.]",
      ),
    });
  }

  return [...attachmentBlocks, ...imageBlocks, ...textBlocks];
}

function isPiMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") {
    return false;
  }

  const role = (value as { role?: unknown }).role;
  return role === "user" || role === "assistant" || role === "toolResult";
}

export function serializePiMessage(message: Message) {
  return JSON.stringify(message);
}

export async function deserializePiMessages(rows: ChatMessageRow[]) {
  const messages: Array<ChatMessageRow & { parsedMessage: Message }> = [];

  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.message) as unknown;
      if (!isPiMessage(parsed)) {
        continue;
      }

      messages.push({
        ...row,
        parsedMessage: parsed,
      });
    } catch {
    }
  }

  return messages;
}

export async function createUserMessageFromUnknown(
  input: unknown,
  fallbackText?: string,
) {
  const now = Date.now();
  const trimmedFallback =
    typeof fallbackText === "string" ? fallbackText.trim() : "";

  if (trimmedFallback.length > 0) {
    return {
      role: "user" as const,
      content: [{ type: "text" as const, text: trimmedFallback }],
      timestamp: now,
    };
  }

  if (!input || typeof input !== "object") {
    return null;
  }

  const message = input as IncomingUserMessage;
  if (message.role !== "user") {
    return null;
  }

  const content = await createUserContentFromParts(message.parts);
  if (content.length === 0) {
    return null;
  }

  return {
    role: "user" as const,
    content,
    timestamp: now,
  } satisfies UserMessage;
}
