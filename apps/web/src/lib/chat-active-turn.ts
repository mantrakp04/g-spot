import type { UIMessage } from "@/lib/chat-ui";

export type ActiveChatTurn = {
  visibleMessages: UIMessage[];
  activeAssistantMessages: UIMessage[];
};

export function splitActiveChatTurn(
  messages: UIMessage[],
  isStreamActive: boolean,
): ActiveChatTurn {
  if (!isStreamActive) {
    return {
      visibleMessages: messages,
      activeAssistantMessages: [],
    };
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== "user") {
      continue;
    }

    return {
      visibleMessages: messages.slice(0, index + 1),
      activeAssistantMessages: messages
        .slice(index + 1)
        .filter((message) => message.role === "assistant"),
    };
  }

  return {
    visibleMessages: [],
    activeAssistantMessages: messages.filter(
      (message) => message.role === "assistant",
    ),
  };
}

export function combineActiveStreamingMessages(
  activeMessages: readonly UIMessage[],
  streamingMessage: UIMessage | null,
): UIMessage | null {
  if (activeMessages.length === 0) {
    return streamingMessage;
  }

  const first = activeMessages[0]!;
  return {
    ...first,
    id: streamingMessage?.id ?? first.id,
    role: "assistant",
    parts: [
      ...activeMessages.flatMap((message) => message.parts),
      ...(streamingMessage?.parts ?? []),
    ],
  };
}
