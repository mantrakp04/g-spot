import { env } from "@g-spot/env/server";
import type { Message, UserMessage } from "@mariozechner/pi-ai";

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

function createAttachmentNote(filename: string | undefined, text: string) {
  return `Attached file: ${filename ?? "attachment"}\n\n${text}`;
}

async function createUserContentFromParts(
  parts: unknown,
): Promise<Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>> {
  if (!Array.isArray(parts)) {
    return [];
  }

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  > = [];

  for (const rawPart of parts) {
    const part = rawPart as IncomingUserPart;

    if (part.type === "text" && typeof part.text === "string") {
      const text = part.text.trim();
      if (text.length > 0) {
        content.push({ type: "text", text });
      }
      continue;
    }

    if (part.type !== "file" || typeof part.url !== "string") {
      continue;
    }

    if (
      typeof part.mediaType === "string" &&
      part.mediaType.startsWith("image/")
    ) {
      content.push(await readImageFromUrl(part.url, part.mediaType));
      continue;
    }

    if (isTextLikeFile(part)) {
      content.push({
        type: "text",
        text: createAttachmentNote(
          typeof part.filename === "string" ? part.filename : undefined,
          await readTextFromUrl(part.url),
        ),
      });
      continue;
    }

    content.push({
      type: "text",
      text: createAttachmentNote(
        typeof part.filename === "string" ? part.filename : undefined,
        "[Unsupported attachment omitted from model context.]",
      ),
    });
  }

  return content;
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
        console.warn("[pi.chat] skipping malformed stored message", {
          messageId: row.id,
        });
        continue;
      }

      messages.push({
        ...row,
        parsedMessage: parsed,
      });
    } catch (error) {
      console.warn("[pi.chat] failed to parse stored message", {
        messageId: row.id,
        error,
      });
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
