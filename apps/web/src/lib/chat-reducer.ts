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
  piMessageToUiMessage,
} from "@/lib/chat-ui";

type ChatReductionInput = {
  messages: UIMessage[];
  streamingMessage: UIMessage | null;
  event: ChatStreamEvent;
  streamingId: string;
};

export type ChatReduction = {
  messages: UIMessage[];
  streamingMessage: UIMessage | null;
  messagesChanged: boolean;
  streamingChanged: boolean;
};

function unchanged(input: ChatReductionInput): ChatReduction {
  return {
    messages: input.messages,
    streamingMessage: input.streamingMessage,
    messagesChanged: false,
    streamingChanged: false,
  };
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

    const ui = piMessageToUiMessage(piMessage, message.id, {
      createdAt: message.createdAt,
    });
    if (ui) {
      messages = [...messages, ui];
    }
  }

  return messages;
}

export function reduceChatStreamEvent(
  input: ChatReductionInput,
): ChatReduction {
  const { event } = input;

  if (event.type === "tool_approval_request") {
    return {
      messages: applyToolApprovalRequestToMessages(input.messages, event),
      streamingMessage: input.streamingMessage
        ? applyToolApprovalRequestToMessages([input.streamingMessage], event)[0] ?? null
        : null,
      messagesChanged: true,
      streamingChanged: input.streamingMessage !== null,
    };
  }

  if (event.type === "tool_approval_resolved") {
    return {
      messages: applyToolApprovalResolvedToMessages(input.messages, event),
      streamingMessage: input.streamingMessage
        ? applyToolApprovalResolvedToMessages([input.streamingMessage], event)[0] ?? null
        : null,
      messagesChanged: true,
      streamingChanged: input.streamingMessage !== null,
    };
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

    return {
      messages: applyPiToolResultToMessages(input.messages, piMessage),
      streamingMessage: input.streamingMessage
        ? applyPiToolResultToMessages([input.streamingMessage], piMessage)[0] ?? null
        : null,
      messagesChanged: true,
      streamingChanged: input.streamingMessage !== null,
    };
  }

  const assistantMessage = piMessageToUiMessage(piMessage, input.streamingId, {
    streaming: event.type !== "message_end",
  });

  if (!assistantMessage) {
    return unchanged(input);
  }

  if (event.type === "message_end") {
    return {
      messages: [...input.messages, assistantMessage],
      streamingMessage: null,
      messagesChanged: true,
      streamingChanged: input.streamingMessage !== null,
    };
  }

  return {
    messages: input.messages,
    streamingMessage: assistantMessage,
    messagesChanged: false,
    streamingChanged: true,
  };
}
