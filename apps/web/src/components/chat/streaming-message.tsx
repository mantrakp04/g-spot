import { useSyncExternalStore } from "react";

import { ChatMessage } from "@/components/chat/chat-message";
import { perfCount } from "@/lib/chat-perf-log";
import type { UIMessage } from "@/lib/chat-ui";
import {
  getStreamingMessage,
  subscribeStreamingMessage,
} from "@/lib/streaming-message-store";

type StreamingMessageProps = {
  chatId: string;
  messages?: readonly UIMessage[];
};

function combineStreamingMessages(
  messages: readonly UIMessage[],
  liveMessage: UIMessage | null,
): UIMessage | null {
  const allMessages = liveMessage ? [...messages, liveMessage] : messages;
  if (allMessages.length === 0) return null;

  const first = allMessages[0]!;
  return {
    ...first,
    id: liveMessage?.id ?? first.id,
    role: "assistant",
    parts: allMessages.flatMap((message) => message.parts),
  };
}

/**
 * Renders the active assistant turn as one streaming bubble. Persisted chunks
 * from a running turn stay out of the finalized list, but don't become giant
 * separate flex items.
 */
export function StreamingMessage({
  chatId,
  messages = [],
}: StreamingMessageProps) {
  const liveMessage = useSyncExternalStore(
    (listener) => subscribeStreamingMessage(chatId, listener),
    () => getStreamingMessage(chatId),
    () => null,
  );
  const message = combineStreamingMessages(messages, liveMessage);

  if (!message) return null;

  perfCount("StreamingMessage.render", {
    id: message.id,
    persistedChunks: messages.length,
    liveParts: liveMessage?.parts.length ?? 0,
    parts: message.parts.length,
  });

  return (
    <div data-chat-message-id={message.id}>
      <ChatMessage message={message} variant="streaming" />
    </div>
  );
}
