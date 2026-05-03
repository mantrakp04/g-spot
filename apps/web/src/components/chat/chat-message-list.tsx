import { memo, useMemo } from "react";

import { ChatMessage } from "@/components/chat/chat-message";
import { perfCount } from "@/lib/chat-perf-log";
import type { PreparedEntry } from "@/lib/chat-render-model";

type MessageActionHandlers = {
  onRegenerate: (index: number) => void;
  onEdit: (index: number, newText: string) => void;
  onFork: (index: number) => void;
};

type ChatMessageListProps = {
  entries: PreparedEntry[];
  handlers: MessageActionHandlers;
};

/**
 * Stable, memoized list of *finalized* messages. This component never
 * rerenders during token streaming — the in-flight message is rendered
 * separately by <StreamingMessage />.
 */
export const ChatMessageList = memo(function ChatMessageList({
  entries,
  handlers,
}: ChatMessageListProps) {
  perfCount("ChatMessageList.render", { count: entries.length });

  // Pre-bind per-entry callbacks so ChatMessage memo holds across renders
  // when neither `entries` nor `handlers` changed identity.
  const bound = useMemo(
    () =>
      entries.map((entry) => {
        if (entry.kind === "user") {
          return {
            entry,
            onEdit: (newText: string) => handlers.onEdit(entry.index, newText),
            onFork: () => handlers.onFork(entry.index),
            onReload: undefined,
          };
        }
        return {
          entry,
          onEdit: undefined,
          onFork: () => handlers.onFork(entry.lastIndex),
          onReload: () => handlers.onRegenerate(entry.firstIndex),
        };
      }),
    [entries, handlers],
  );

  return (
    <>
      {bound.map(({ entry, onEdit, onFork, onReload }) => (
        <div
          key={entry.message.id}
          data-chat-message-id={entry.message.id}
        >
          {entry.kind === "user" ? (
            <ChatMessage
              message={entry.message}
              variant="final"
              userText={entry.text}
              onEdit={onEdit}
              onFork={onFork}
            />
          ) : (
            <ChatMessage
              message={entry.message}
              variant="final"
              responseParts={entry.responseParts}
              copyText={entry.copyText}
              thoughtItems={entry.thoughtItems}
              onReload={onReload}
              onFork={onFork}
            />
          )}
        </div>
      ))}
    </>
  );
});
