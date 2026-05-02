import type {
  PiChatHistoryMessage,
  PiSdkMessage,
} from "@g-spot/types";

import {
  type ChatStreamEvent,
  type UIMessage,
  applyPiToolResultToMessages,
  applyToolApprovalRequestToMessages,
  applyToolApprovalResolvedToMessages,
  applyToolExecutionEndToMessages,
  applyToolExecutionStartToMessages,
  applyToolExecutionUpdateToMessages,
  piMessageToUiMessage,
} from "@/lib/chat-ui";

type ChatReductionInput = {
  messages: UIMessage[];
  streamingMessage: UIMessage | null;
  event: ChatStreamEvent;
  streamingId: string;
  isReconnect?: boolean;
};

export type ChatReduction = {
  messages: UIMessage[];
  streamingMessage: UIMessage | null;
  messagesChanged: boolean;
  streamingChanged: boolean;
};

function reduceTo(
  input: ChatReductionInput,
  messages: UIMessage[],
  streamingMessage: UIMessage | null,
  options: { forceStreamingChanged?: boolean } = {},
): ChatReduction {
  return {
    messages,
    streamingMessage,
    messagesChanged: messages !== input.messages,
    streamingChanged:
      options.forceStreamingChanged || streamingMessage !== input.streamingMessage,
  };
}

function unchanged(input: ChatReductionInput): ChatReduction {
  return reduceTo(input, input.messages, input.streamingMessage);
}

function reduceMessagesAndStreaming(
  input: ChatReductionInput,
  apply: (messages: UIMessage[]) => UIMessage[],
): ChatReduction {
  const messages = apply(input.messages);
  const streamingMessage = input.streamingMessage
    ? apply([input.streamingMessage])[0] ?? null
    : null;

  return reduceTo(input, messages, streamingMessage);
}

export function reduceChatHistory(
  history: PiChatHistoryMessage[],
): UIMessage[] {
  let messages: UIMessage[] = [];

  for (const message of history) {
    const piMessage = message as PiSdkMessage;

    if (piMessage.role === "toolResult") {
      messages = applyPiToolResultToMessages(messages, piMessage);
      continue;
    }

    const ui = piMessageToUiMessage(piMessage, message.id);
    if (ui) {
      messages = [...messages, ui];
    }
  }

  return messages;
}

function createdAtKey(value: UIMessage["createdAt"]) {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : value;
}

function hasAssistantAtSameTime(messages: UIMessage[], candidate: UIMessage) {
  if (candidate.role !== "assistant") return false;

  const createdAt = createdAtKey(candidate.createdAt);
  return messages.some(
    (message) =>
      message.role === "assistant" && createdAtKey(message.createdAt) === createdAt,
  );
}

export function reduceChatStreamEvent(
  input: ChatReductionInput,
): ChatReduction {
  const { event } = input;

  if (event.type === "tool_approval_request") {
    return reduceMessagesAndStreaming(input, (messages) =>
      applyToolApprovalRequestToMessages(messages, event),
    );
  }

  if (event.type === "tool_approval_resolved") {
    return reduceMessagesAndStreaming(input, (messages) =>
      applyToolApprovalResolvedToMessages(messages, event),
    );
  }

  if (event.type === "tool_execution_start") {
    return reduceMessagesAndStreaming(input, (messages) =>
      applyToolExecutionStartToMessages(messages, event),
    );
  }

  if (event.type === "tool_execution_update") {
    return reduceMessagesAndStreaming(input, (messages) =>
      applyToolExecutionUpdateToMessages(messages, event),
    );
  }

  if (event.type === "tool_execution_end") {
    return reduceMessagesAndStreaming(input, (messages) =>
      applyToolExecutionEndToMessages(messages, event),
    );
  }

  if (
    event.type !== "message_start" &&
    event.type !== "message_update" &&
    event.type !== "message_end"
  ) {
    return unchanged(input);
  }

  const piMessage = event.message as PiSdkMessage;

  if (piMessage.role === "user") {
    return unchanged(input);
  }

  if (piMessage.role === "toolResult") {
    if (event.type !== "message_end") {
      return unchanged(input);
    }

    return reduceMessagesAndStreaming(input, (messages) =>
      applyPiToolResultToMessages(messages, piMessage),
    );
  }

  const assistantMessage = piMessageToUiMessage(piMessage, input.streamingId, {
    streaming: event.type !== "message_end",
  });

  if (!assistantMessage) {
    return unchanged(input);
  }

  if (
    input.isReconnect &&
    event.type !== "message_end" &&
    hasAssistantAtSameTime(input.messages, assistantMessage)
  ) {
    return unchanged(input);
  }

  if (event.type === "message_end") {
    const messages =
      input.isReconnect && hasAssistantAtSameTime(input.messages, assistantMessage)
        ? input.messages
        : [...input.messages, assistantMessage];

    return reduceTo(input, messages, null, { forceStreamingChanged: true });
  }

  return reduceTo(input, input.messages, assistantMessage);
}
