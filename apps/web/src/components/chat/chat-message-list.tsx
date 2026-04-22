import { memo, useMemo } from "react";

import { ChatMessage } from "@/components/chat/chat-message";
import type { UIMessage } from "@/lib/chat-ui";
import { perfCount } from "@/lib/chat-perf-log";

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

type RenderEntry = {
  /** Synthetic message rendered as one bubble. For assistant groups this
   * merges the parts of every consecutive assistant message in the turn. */
  message: UIMessage;
  /** Index of the first message in the group — used by regenerate to slice
   * the conversation before the whole assistant turn. */
  firstIndex: number;
  /** Index of the last message in the group — used by fork to include the
   * full turn when branching. For user messages this equals firstIndex. */
  lastIndex: number;
};

/**
 * Consecutive assistant messages from the PI SDK represent a single agent
 * turn that happened to emit multiple steps (tool call + follow-up, etc.).
 * Render them as one bubble so the turn has a single Chain of Thought
 * instead of one per step.
 */
function groupMessages(messages: UIMessage[]): RenderEntry[] {
  const entries: RenderEntry[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i]!;
    if (msg.role !== "assistant") {
      entries.push({ message: msg, firstIndex: i, lastIndex: i });
      i += 1;
      continue;
    }

    let j = i;
    const parts: UIMessage["parts"] = [];
    while (j < messages.length && messages[j]!.role === "assistant") {
      parts.push(...messages[j]!.parts);
      j += 1;
    }

    const first = messages[i]!;
    entries.push({
      message: { ...first, parts },
      firstIndex: i,
      lastIndex: j - 1,
    });
    i = j;
  }
  return entries;
}

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
  perfCount("ChatMessageList.render", { count: messages.length });
  const entries = useMemo(() => groupMessages(messages), [messages]);
  return (
    <>
      {entries.map(({ message, firstIndex, lastIndex }) => (
        <ChatMessage
          key={message.id}
          message={message}
          isStreaming={false}
          onReload={
            message.role === "assistant"
              ? () => handlers.onRegenerate(message.id)
              : undefined
          }
          onEdit={
            message.role === "user"
              ? (newText: string) => handlers.onEdit(firstIndex, newText)
              : undefined
          }
          onFork={() => handlers.onFork(lastIndex)}
          onResolveApproval={handlers.onResolveApproval}
        />
      ))}
    </>
  );
});
