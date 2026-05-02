import type {
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
  /** Content-addressed file id, when the part originated from a server upload. */
  fileId?: string;
  /** Populated only for on-demand document previews. Model-facing extracted
   * text is not part of persisted UI messages. */
  extractedText?: string;
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

/**
 * Fired by the server when a tool call is gated by the chat's approval
 * policy. The client renders approve/deny buttons on the matching tool
 * invocation and calls `chat.resolveToolApproval` to unblock it.
 */
export type ToolApprovalRequestEvent = {
  type: "tool_approval_request";
  toolCallId: string;
  toolName: string;
  args: unknown;
  reason: string;
};

/**
 * Fired by the server once a pending approval is resolved — either because
 * the client called `chat.resolveToolApproval` or because the runtime
 * cancelled it (abort, reconnect). The client uses this to tear down its
 * "awaiting approval" UI.
 */
export type ToolApprovalResolvedEvent = {
  type: "tool_approval_resolved";
  toolCallId: string;
  toolName: string;
  approved: boolean;
  reason?: string;
};

export type ToolExecutionStartEvent = {
  type: "tool_execution_start";
  toolCallId: string;
  toolName: string;
  args: unknown;
};

export type ToolExecutionUpdateEvent = {
  type: "tool_execution_update";
  toolCallId: string;
  toolName: string;
  args: unknown;
  partialResult: unknown;
};

export type ToolExecutionEndEvent = {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
};

export type ToolExecutionEvent =
  | ToolExecutionStartEvent
  | ToolExecutionUpdateEvent
  | ToolExecutionEndEvent;

export type ChatStreamEvent =
  | PiSdkSessionEvent
  | GSpotErrorEvent
  | ToolApprovalRequestEvent
  | ToolApprovalResolvedEvent
  | ToolExecutionEvent;

export type ChatSocketStateEvent =
  | { type: "socket_attached" }
  | { type: "socket_missing" }
  | { type: "stream_finished" };

function base64ImageUrl(data: string, mimeType: string) {
  return `data:${mimeType};base64,${data}`;
}

function warnUnsupportedPiContentPart(part: unknown) {
  if (!import.meta.env.DEV) {
    return;
  }

  console.warn("[chat-ui] unsupported Pi content part", part);
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
      warnUnsupportedPiContentPart(item);
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
      continue;
    }

    warnUnsupportedPiContentPart(item);
  }

  return parts;
}

function isModelAttachmentText(text: string) {
  return text.trimStart().startsWith("<gs-attachment");
}

function userPartsFromPiValue(value: unknown): UIMessagePart[] {
  const parts = partsFromValue(value);
  return parts.filter(
    (part) => part.type !== "text" || !isModelAttachmentText(part.text),
  );
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
      parts: userPartsFromPiValue(message.content),
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
 * Mutate (immutably) the most recent tool part matching `toolCallId` across
 * `messages`. Used by the approval-request / -resolved stream events to
 * transition a single tool invocation through approval states without
 * touching any other parts.
 */
function updateToolPart(
  messages: UIMessage[],
  toolCallId: string,
  update: (
    part: ToolUIPart | DynamicToolUIPart,
  ) => ToolUIPart | DynamicToolUIPart,
): UIMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== "assistant") {
      continue;
    }

    let applied = false;
    let changed = false;
    const nextParts = message.parts.map((part) => {
      if (applied || !isAnyToolPart(part) || part.toolCallId !== toolCallId) {
        return part;
      }
      applied = true;
      const nextPart = update(part);
      changed ||= nextPart !== part;
      return nextPart;
    });

    if (!applied) {
      continue;
    }

    if (!changed) {
      return messages;
    }

    const next = [...messages];
    next[i] = { ...message, parts: nextParts };
    return next;
  }

  return messages;
}

function isTerminalToolState(state: ToolState) {
  return state === "output-available" || state === "output-error" || state === "output-denied";
}

export function applyToolApprovalRequestToMessages(
  messages: UIMessage[],
  event: ToolApprovalRequestEvent,
): UIMessage[] {
  return updateToolPart(messages, event.toolCallId, (part) =>
    isTerminalToolState(part.state)
      ? part
      : {
          ...part,
          state: "approval-requested",
          approval: {
            id: event.toolCallId,
            // `reason` is the human-readable "why approval is needed" text that
            // the server emitted. Stored alongside the eventual approval.reason
            // field so the UI can surface both the prompt and the response.
            reason: event.reason,
          },
        },
  );
}

export function applyToolApprovalResolvedToMessages(
  messages: UIMessage[],
  event: ToolApprovalResolvedEvent,
): UIMessage[] {
  return updateToolPart(messages, event.toolCallId, (part) =>
    isTerminalToolState(part.state)
      ? part
      : {
          ...part,
          // If the user denied, the tool is about to surface as an error; if they
          // approved, Pi will fire the normal `tool_execution_*` events and the
          // state will move forward from here. In both cases we park on
          // `approval-responded` until the real transition happens.
          state: "approval-responded",
          approval: {
            id: event.toolCallId,
            approved: event.approved,
            reason: event.reason,
          },
        },
  );
}

function toolPartFromExecutionEvent(
  event: ToolExecutionStartEvent | ToolExecutionUpdateEvent,
): DynamicToolUIPart {
  return {
    type: "dynamic-tool",
    state: "input-available",
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    input: event.args,
  };
}

function applyToolExecutionToMessages(
  messages: UIMessage[],
  event: ToolExecutionEvent,
  update: (
    part: ToolUIPart | DynamicToolUIPart,
  ) => ToolUIPart | DynamicToolUIPart,
): UIMessage[] {
  const updated = updateToolPart(messages, event.toolCallId, update);
  if (updated !== messages) {
    return updated;
  }

  if (event.type === "tool_execution_end") {
    return messages;
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== "assistant") {
      continue;
    }

    const next = [...messages];
    next[i] = {
      ...message,
      parts: [...message.parts, toolPartFromExecutionEvent(event)],
    };
    return next;
  }

  return messages;
}

export function applyToolExecutionStartToMessages(
  messages: UIMessage[],
  event: ToolExecutionStartEvent,
): UIMessage[] {
  return applyToolExecutionToMessages(messages, event, (part) =>
    isTerminalToolState(part.state)
      ? part
      : {
          ...part,
          state: "input-available",
          toolName: part.toolName ?? event.toolName,
          input: event.args,
        },
  );
}

export function applyToolExecutionUpdateToMessages(
  messages: UIMessage[],
  event: ToolExecutionUpdateEvent,
): UIMessage[] {
  return applyToolExecutionToMessages(messages, event, (part) =>
    isTerminalToolState(part.state)
      ? part
      : {
          ...part,
          state: "input-available",
          toolName: part.toolName ?? event.toolName,
          input: event.args,
          output: event.partialResult,
        },
  );
}

export function applyToolExecutionEndToMessages(
  messages: UIMessage[],
  event: ToolExecutionEndEvent,
): UIMessage[] {
  return applyToolExecutionToMessages(messages, event, (part) => {
    const output = event.result;
    return {
      ...part,
      state: event.isError ? "output-error" : "output-available",
      toolName: part.toolName ?? event.toolName,
      output: event.isError ? undefined : output,
      errorText: event.isError
        ? typeof output === "string"
          ? output
          : stringifyUnknown(output)
        : undefined,
    };
  });
}

export function isGSpotErrorEvent(event: ChatStreamEvent): event is GSpotErrorEvent {
  return event.type === "gspot_error";
}

export function parseChatSocketMessage(
  payload: string,
): ChatStreamEvent | ChatSocketStateEvent {
  return JSON.parse(payload) as ChatStreamEvent | ChatSocketStateEvent;
}

export function isChatSocketStateEvent(
  event: ChatStreamEvent | ChatSocketStateEvent,
): event is ChatSocketStateEvent {
  return (
    event.type === "socket_attached" ||
    event.type === "socket_missing" ||
    event.type === "stream_finished"
  );
}
