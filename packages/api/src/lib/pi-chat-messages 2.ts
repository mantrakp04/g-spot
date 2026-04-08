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

type LegacyPart = {
  type?: unknown;
  text?: unknown;
  url?: unknown;
  mediaType?: unknown;
  filename?: unknown;
};

type LegacyUiMessage = {
  role?: unknown;
  parts?: unknown;
  createdAt?: unknown;
  provider?: unknown;
  model?: unknown;
};

function getFileExtension(filename: string | undefined) {
  if (!filename) {
    return null;
  }

  const extension = filename.split(".").pop()?.trim().toLowerCase();
  return extension && extension.length > 0 ? extension : null;
}

function isTextLikeLegacyFile(part: LegacyPart) {
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

function fallbackTimestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function createTextAttachmentNote(filename: string | undefined, text: string) {
  return `Attached file: ${filename ?? "attachment"}\n\n${text}`;
}

async function readTextFromUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

async function readImageFromUrl(url: string, mediaType?: string) {
  const response = await fetch(url);
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

async function convertLegacyUserContent(
  parts: unknown,
): Promise<UserMessage["content"]> {
  if (!Array.isArray(parts)) {
    return [];
  }

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  > = [];

  for (const rawPart of parts) {
    const part = rawPart as LegacyPart;

    if (part.type === "text" && typeof part.text === "string") {
      content.push({ type: "text", text: part.text });
      continue;
    }

    if (part.type !== "file" || typeof part.url !== "string") {
      continue;
    }

    if (
      typeof part.mediaType === "string" &&
      part.mediaType.startsWith("image/")
    ) {
      try {
        content.push(await readImageFromUrl(part.url, part.mediaType));
      } catch {
        content.push({
          type: "text",
          text: createTextAttachmentNote(
            typeof part.filename === "string" ? part.filename : undefined,
            "[Unable to load attached image.]",
          ),
        });
      }
      continue;
    }

    if (isTextLikeLegacyFile(part)) {
      try {
        content.push({
          type: "text",
          text: createTextAttachmentNote(
            typeof part.filename === "string" ? part.filename : undefined,
            await readTextFromUrl(part.url),
          ),
        });
      } catch {
        content.push({
          type: "text",
          text: createTextAttachmentNote(
            typeof part.filename === "string" ? part.filename : undefined,
            "[Unable to load attached text file.]",
          ),
        });
      }
      continue;
    }

    content.push({
      type: "text",
      text: createTextAttachmentNote(
        typeof part.filename === "string" ? part.filename : undefined,
        "[Unsupported attachment omitted from model context.]",
      ),
    });
  }

  return content;
}

async function convertLegacyUiMessage(
  rawMessage: LegacyUiMessage,
  createdAt: string,
): Promise<Message | null> {
  if (rawMessage.role === "user") {
    const content = await convertLegacyUserContent(rawMessage.parts);
    if (!Array.isArray(content) || content.length === 0) {
      return null;
    }

    return {
      role: "user",
      content,
      timestamp: fallbackTimestamp(createdAt),
    };
  }

  if (rawMessage.role === "assistant") {
    const textParts = Array.isArray(rawMessage.parts)
      ? rawMessage.parts.flatMap((part) =>
          (part as LegacyPart).type === "text" &&
          typeof (part as LegacyPart).text === "string"
            ? [{ type: "text" as const, text: (part as LegacyPart).text as string }]
            : [],
        )
      : [];

    return {
      role: "assistant",
      content: textParts,
      api: "openai-codex-responses",
      provider:
        typeof rawMessage.provider === "string"
          ? rawMessage.provider
          : "legacy",
      model:
        typeof rawMessage.model === "string" ? rawMessage.model : "legacy",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: "stop",
      timestamp: fallbackTimestamp(createdAt),
    };
  }

  return null;
}

function isPiMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") {
    return false;
  }

  const role = (value as { role?: unknown }).role;
  return role === "user" || role === "assistant" || role === "toolResult";
}

function normalizeStoredPiMessage(message: Message): Message | null {
  if (message.role === "user") {
    const rawContent = message.content;
    const content =
      typeof rawContent === "string"
        ? rawContent.trim().length > 0
          ? [{ type: "text" as const, text: rawContent }]
          : []
        : Array.isArray(rawContent)
          ? rawContent
          : [];

    if (content.length === 0) {
      return null;
    }

    return {
      ...message,
      content,
    };
  }

  if (message.role === "assistant") {
    const assistantMessage = message as Message & { errorMessage?: unknown };
    if (
      Array.isArray(message.content) &&
      message.content.length === 0 &&
      typeof assistantMessage.errorMessage === "string" &&
      assistantMessage.errorMessage.trim().length > 0
    ) {
      return {
        ...message,
        content: [
          {
            type: "text" as const,
            text: assistantMessage.errorMessage,
          },
        ],
      };
    }
  }

  return message;
}

export function serializePiMessage(message: Message) {
  return JSON.stringify(message);
}

export async function deserializePiMessages(rows: ChatMessageRow[]) {
  const messages: Array<ChatMessageRow & { parsedMessage: Message }> = [];

  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.message) as unknown;

      if (isPiMessage(parsed)) {
        const normalizedMessage = normalizeStoredPiMessage(parsed);
        if (normalizedMessage) {
          messages.push({
            ...row,
            parsedMessage: normalizedMessage,
          });
        }
        continue;
      }

      const legacyMessage = await convertLegacyUiMessage(
        parsed as LegacyUiMessage,
        row.createdAt,
      );

      if (legacyMessage) {
        messages.push({
          ...row,
          parsedMessage: legacyMessage,
        });
      }
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

  if (typeof fallbackText === "string" && fallbackText.trim().length > 0) {
    return {
      role: "user" as const,
      content: fallbackText.trim(),
      timestamp: now,
    };
  }

  if (!input || typeof input !== "object") {
    return null;
  }

  const legacyMessage = await convertLegacyUiMessage(
    input as LegacyUiMessage,
    new Date(now).toISOString(),
  );

  return legacyMessage?.role === "user" ? legacyMessage : null;
}
