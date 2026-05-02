import type { UIMessage } from "@/lib/chat-ui";

export type ActiveChatMessages = {
  finalMessages: UIMessage[];
  streamingMessages: UIMessage[];
};

export function splitActiveChatMessages(
  messages: UIMessage[],
  isActive: boolean,
): ActiveChatMessages {
  if (!isActive) {
    return { finalMessages: messages, streamingMessages: [] };
  }

  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }

  if (lastUserIndex === -1) {
    return {
      finalMessages: [],
      streamingMessages: messages.filter((message) => message.role === "assistant"),
    };
  }

  return {
    finalMessages: messages.slice(0, lastUserIndex + 1),
    streamingMessages: messages
      .slice(lastUserIndex + 1)
      .filter((message) => message.role === "assistant"),
  };
}

export type ChatRenderEntry =
  | {
      kind: "user";
      message: UIMessage;
      index: number;
    }
  | {
      kind: "assistant-turn";
      message: UIMessage;
      messages: UIMessage[];
      firstIndex: number;
      lastIndex: number;
    };

export function createChatRenderModel(messages: UIMessage[]): ChatRenderEntry[] {
  const entries: ChatRenderEntry[] = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index]!;

    if (message.role !== "assistant") {
      entries.push({ kind: "user", message, index });
      index += 1;
      continue;
    }

    const firstIndex = index;
    const assistantMessages: UIMessage[] = [];

    while (
      index < messages.length &&
      messages[index]!.role === "assistant"
    ) {
      const assistantMessage = messages[index]!;
      assistantMessages.push(assistantMessage);
      index += 1;
    }

    entries.push({
      kind: "assistant-turn",
      message: assistantMessages.at(-1)!,
      messages: assistantMessages,
      firstIndex,
      lastIndex: index - 1,
    });
  }

  return entries;
}
