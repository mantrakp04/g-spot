import { memo, useMemo } from "react";

import { ChatMessage } from "@/components/chat/chat-message";
import type { UIMessage } from "@/lib/chat-ui";
import { perfCount } from "@/lib/chat-perf-log";
import { createChatRenderModel } from "@/lib/chat-render-model";

type MessageActionHandlers = {
  onRegenerate: (index: number) => void;
  onEdit: (index: number, newText: string) => void;
  onFork: (index: number) => void;
};

type ChatMessageListProps = {
  messages: UIMessage[];
  handlers: MessageActionHandlers;
};

/**
 * Stable, memoized list of *finalized* messages. This component never
 * rerenders during token streaming — the in-flight message is rendered
 * separately by <StreamingMessage />.
 */
export const ChatMessageList = memo(function ChatMessageList({
  messages,
  handlers,
}: ChatMessageListProps) {
  perfCount("ChatMessageList.render", { count: messages.length });
  const entries = useMemo(() => createChatRenderModel(messages), [messages]);

  return (
    <>
      {entries.map((entry) => {
        return (
          <div key={entry.message.id} data-chat-message-id={entry.message.id}>
            <ChatMessage
            message={entry.message}
            previousMessages={
              entry.kind === "assistant-turn"
                ? entry.messages.slice(0, -1)
                : undefined
            }
            variant="final"
            onReload={
              entry.kind === "assistant-turn"
                ? () => handlers.onRegenerate(entry.firstIndex)
                : undefined
            }
            onEdit={
              entry.kind === "user"
                ? (newText: string) => handlers.onEdit(entry.index, newText)
                : undefined
            }
              onFork={() =>
                handlers.onFork(
                  entry.kind === "assistant-turn" ? entry.lastIndex : entry.index,
                )
              }
            />
          </div>
        );
      })}
    </>
  );
});
