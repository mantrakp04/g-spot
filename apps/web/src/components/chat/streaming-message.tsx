import { useSyncExternalStore } from "react";

import { ChatMessage } from "@/components/chat/chat-message";
import { perfCount } from "@/lib/chat-perf-log";
import {
  getStreamingMessage,
  subscribeStreamingMessage,
} from "@/lib/streaming-message-store";

type StreamingMessageProps = {
  chatId: string;
};

/**
 * Renders the in-flight assistant message in isolation. Subscribes only to
 * the per-chat streaming slot, so token-by-token updates don't re-render the
 * rest of the conversation.
 */
export function StreamingMessage({ chatId }: StreamingMessageProps) {
  const message = useSyncExternalStore(
    (listener) => subscribeStreamingMessage(chatId, listener),
    () => getStreamingMessage(chatId),
    () => null,
  );

  if (!message) return null;

  perfCount("StreamingMessage.render", {
    id: message.id,
    parts: message.parts.length,
  });

  return <ChatMessage message={message} isStreaming />;
}
