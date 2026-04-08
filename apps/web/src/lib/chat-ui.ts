import type {
  PiChatHistoryMessage,
  PiSdkMessage,
  PiSdkSessionEvent,
} from "@g-spot/types";

export type ChatStatus = "ready" | "submitted" | "streaming" | "error";

export type TextUIPart = {
  type: "text";
  text: string;
};

export type ReasoningUIPart = {
  type: "reasoning";
  text: string;
};

export type FileUIPart = {
  type: "file";
  url: string;
  mediaType?: string;
  filename?: string;
};

export type SourceDocumentUIPart = {
  type: "source-document";
  title?: string;
  filename?: string;
  url?: string;
  mediaType?: string;
};

export type ToolState =
  | "approval-requested"
  | "approval-responded"
  | "input-available"
  | "input-streaming"
  | "output-available"
  | "output-denied"
  | "output-error";

export type ToolUIPart = {
  type: `tool-${string}`;
  state: ToolState;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  toolName?: string;
  approval?: {
    id: string;
    approved?: boolean;
    reason?: string;
  };
};

export type DynamicToolUIPart = Omit<ToolUIPart, "type"> & {
  type: "dynamic-tool";
  toolName: string;
};

function isAnyToolPart(
  part: UIMessagePart,
): part is ToolUIPart | DynamicToolUIPart {
  return (
    "state" in part &&
    (part.type === "dynamic-tool" || part.type.startsWith("tool-"))
  );
}

export type StepStartUIPart = {
  type: "step-start";
};

export type UIMessagePart =
  | TextUIPart
  | ReasoningUIPart
  | FileUIPart
  | SourceDocumentUIPart
  | ToolUIPart
  | DynamicToolUIPart
  | StepStartUIPart;

export type UIMessage = {
  id: string;
  role: "user" | "assistant";
  parts: UIMessagePart[];
  createdAt?: string | Date;
};

export type LanguageModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};

export type Experimental_GeneratedImage = {
  base64?: string;
  uint8Array?: Uint8Array;
  mediaType?: string;
};

export type Experimental_TranscriptionResult = {
  text: string;
  segments: Array<{
    text: string;
    startSecond: number;
    endSecond: number;
  }>;
};

export type Experimental_SpeechResult = {
  audio: {
    base64: string;
    mediaType: string;
  };
};

export type Tool = {
  description?: string;
  inputSchema?: unknown;
  jsonSchema?: unknown;
};

export type GSpotErrorEvent = {
  type: "gspot_error";
  message: string;
};

export type ChatStreamEvent = PiSdkSessionEvent | GSpotErrorEvent;

function base64ImageUrl(data: string, mimeType: string) {
  return `data:${mimeType};base64,${data}`;
}

function partsFromValue(
  value: unknown,
  options: { streaming?: boolean } = {},
): UIMessagePart[] {
  if (typeof value === "string") {
    return value.length > 0 ? [{ type: "text", text: value }] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  const parts: UIMessagePart[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const contentPart = item as {
      type?: unknown;
      text?: unknown;
      thinking?: unknown;
      data?: unknown;
      mimeType?: unknown;
      id?: unknown;
      name?: unknown;
      arguments?: unknown;
      toolCallId?: unknown;
    };

    if (contentPart.type === "text" && typeof contentPart.text === "string") {
      parts.push({ type: "text", text: contentPart.text });
      continue;
    }

    if (
      contentPart.type === "image" &&
      typeof contentPart.data === "string" &&
      typeof contentPart.mimeType === "string"
    ) {
      parts.push({
        type: "file",
        url: base64ImageUrl(contentPart.data, contentPart.mimeType),
        mediaType: contentPart.mimeType,
        filename: "image",
      });
      continue;
    }

    if (
      contentPart.type === "thinking" &&
      typeof contentPart.thinking === "string"
    ) {
      parts.push({ type: "reasoning", text: contentPart.thinking });
      continue;
    }

    if (
      contentPart.type === "toolCall" &&
      typeof contentPart.name === "string"
    ) {
      const toolCallId =
        typeof contentPart.id === "string" ? contentPart.id : undefined;
      const hasArgs =
        contentPart.arguments !== undefined && contentPart.arguments !== null;
      // While the assistant is still streaming, a toolCall without arguments is
      // mid-flight — surface it as "Pending". Once args are present (or the
      // message was loaded from history), it's ready to run: "Running".
      const state: ToolState =
        options.streaming && !hasArgs ? "input-streaming" : "input-available";

      parts.push({
        type: "dynamic-tool",
        state,
        toolCallId,
        toolName: contentPart.name,
        input: contentPart.arguments,
      });
    }
  }

  return parts;
}

function stringifyUnknown(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function piMessageToUiMessage(
  message: PiSdkMessage,
  id: string,
  options: { createdAt?: string; streaming?: boolean } = {},
): UIMessage | null {
  const createdAt =
    options.createdAt ?? new Date(message.timestamp).toISOString();

  if (message.role === "user") {
    return {
      id,
      role: "user",
      parts: partsFromValue(message.content, { streaming: options.streaming }),
      createdAt,
    };
  }

  if (message.role === "assistant") {
    const parts = partsFromValue(message.content, {
      streaming: options.streaming,
    });
    const errorMessage =
      "errorMessage" in message && typeof message.errorMessage === "string"
        ? message.errorMessage.trim()
        : "";

    return {
      id,
      role: "assistant",
      parts:
        parts.length > 0
          ? parts
          : errorMessage
            ? [{ type: "text", text: errorMessage }]
            : [],
      createdAt,
    };
  }

  // toolResult messages never become standalone UI messages — they get folded
  // into the prior assistant message's matching tool invocation. Callers that
  // want to apply one should use `applyPiToolResultToMessages` instead.
  return null;
}

type ToolResultCandidate = Extract<PiSdkMessage, { role: "toolResult" }>;

function isToolResultMessage(
  message: PiSdkMessage,
): message is ToolResultCandidate {
  return message.role === "toolResult";
}

function toolResultOutput(message: ToolResultCandidate) {
  if (Array.isArray(message.content)) {
    // When every entry is text, join for a clean string output. Otherwise
    // fall back to the raw structured content so ToolOutput can render it.
    if (
      message.content.every(
        (entry) =>
          entry &&
          typeof entry === "object" &&
          (entry as { type?: unknown }).type === "text" &&
          typeof (entry as { text?: unknown }).text === "string",
      )
    ) {
      return (message.content as Array<{ text: string }>)
        .map((entry) => entry.text)
        .join("\n");
    }
    return message.content;
  }

  return message.content;
}

function applyToolResultToParts(
  parts: UIMessagePart[],
  message: ToolResultCandidate,
): { parts: UIMessagePart[]; applied: boolean } {
  let applied = false;
  const next = parts.map((part) => {
    if (applied || !isAnyToolPart(part)) {
      return part;
    }
    if (part.toolCallId !== message.toolCallId) {
      return part;
    }

    applied = true;
    const output = toolResultOutput(message);
    const errorText = message.isError
      ? typeof output === "string"
        ? output
        : stringifyUnknown(output)
      : undefined;

    return {
      ...part,
      state: message.isError ? "output-error" : "output-available",
      toolName: part.toolName ?? message.toolName,
      output: message.isError ? undefined : output,
      errorText,
    } as UIMessagePart;
  });

  return { parts: next, applied };
}

/**
 * Fold a toolResult PiSdkMessage into the most recent assistant UI message
 * whose parts contain a tool call with the same id. Returns a new array if
 * something changed; otherwise returns the input untouched.
 */
export function applyPiToolResultToMessages(
  messages: UIMessage[],
  toolResult: PiSdkMessage,
): UIMessage[] {
  if (!isToolResultMessage(toolResult)) {
    return messages;
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const candidate = messages[i]!;
    if (candidate.role !== "assistant") {
      continue;
    }

    const { parts, applied } = applyToolResultToParts(
      candidate.parts,
      toolResult,
    );
    if (!applied) {
      continue;
    }

    const next = [...messages];
    next[i] = { ...candidate, parts };
    return next;
  }

  return messages;
}

/**
 * Build a list of UI messages from a chat history, folding toolResult
 * messages into the matching tool call on a prior assistant message.
 */
export function piHistoryToUiMessages(
  history: PiChatHistoryMessage[],
): UIMessage[] {
  const result: UIMessage[] = [];

  for (const message of history) {
    if (isToolResultMessage(message)) {
      const folded = applyPiToolResultToMessages(result, message);
      if (folded !== result) {
        result.length = 0;
        result.push(...folded);
      }
      continue;
    }

    const ui = piMessageToUiMessage(message, message.id, {
      createdAt: message.createdAt,
    });
    if (ui) {
      result.push(ui);
    }
  }

  return result;
}

export function isGSpotErrorEvent(event: ChatStreamEvent): event is GSpotErrorEvent {
  return event.type === "gspot_error";
}

/**
 * Parse an SSE byte stream from /api/chat (or its reconnect variant) into a
 * sequence of typed events. Handles partial chunks, multi-line `data:` blocks,
 * and the standard `\n\n` boundary.
 */
export async function* readChatEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatStreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        break;
      }

      buffer += decoder.decode(result.value, { stream: true });

      for (;;) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary === -1) {
          break;
        }

        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const payload = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");

        if (!payload) {
          continue;
        }

        yield JSON.parse(payload) as ChatStreamEvent;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function getMessageText(message: UIMessage) {
  return message.parts
    .filter((part): part is TextUIPart => part.type === "text")
    .map((part) => part.text)
    .join("");
}
