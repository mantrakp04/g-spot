import { memo } from "react";

import { ChatMessage } from "@/components/chat/chat-message";
import type { UIMessage } from "@/lib/chat-ui";

type MessageActionHandlers = {
  onRegenerate: (messageId: string) => void;
  onEdit: (index: number, newText: string) => void;
  onFork: (index: number) => void;
  onResolveApproval: (
    toolCallId: string,
    approved: boolean,
    reason?: string,
  ) => void | Promise<void>;
};

type ChatMessageListProps = {
  messages: UIMessage[];
  handlers: MessageActionHandlers;
};

/**
 * Stable, memoized list of *finalized* messages. This component never
 * rerenders during token streaming — the in-flight message is rendered
 * separately by <StreamingMessage />. `status` is intentionally NOT a prop:
 * threading it would bust every child memo on every transition. Finalized
 * messages always render with `isStreaming={false}`.
 */
export const ChatMessageList = memo(function ChatMessageList({
  messages,
  handlers,
}: ChatMessageListProps) {
  return (
    <>
      {messages.map((msg, index) => (
        <ChatMessage
          key={msg.id}
          message={msg}
          isStreaming={false}
          onReload={
            msg.role === "assistant"
              ? () => handlers.onRegenerate(msg.id)
              : undefined
          }
          onEdit={
            msg.role === "user"
              ? (newText: string) => handlers.onEdit(index, newText)
              : undefined
          }
          onFork={() => handlers.onFork(index)}
          onResolveApproval={handlers.onResolveApproval}
        />
      ))}
    </>
  );
});
