import type { UIMessage } from "@/lib/chat-ui";

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
    const parts: UIMessage["parts"] = [];

    while (
      index < messages.length &&
      messages[index]!.role === "assistant"
    ) {
      const assistantMessage = messages[index]!;
      assistantMessages.push(assistantMessage);
      parts.push(...assistantMessage.parts);
      index += 1;
    }

    const first = assistantMessages[0]!;
    entries.push({
      kind: "assistant-turn",
      message: { ...first, parts },
      messages: assistantMessages,
      firstIndex,
      lastIndex: index - 1,
    });
  }

  return entries;
}
