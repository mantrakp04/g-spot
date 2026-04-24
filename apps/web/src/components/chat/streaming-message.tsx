import { useSyncExternalStore } from "react";

import { ChatMessage } from "@/components/chat/chat-message";
import { combineActiveStreamingMessages } from "@/lib/chat-active-turn";
import type { UIMessage } from "@/lib/chat-ui";
import { perfCount } from "@/lib/chat-perf-log";
import {
  getStreamingMessage,
  subscribeStreamingMessage,
} from "@/lib/streaming-message-store";

type StreamingMessageProps = {
  chatId: string;
  activeMessages: UIMessage[];
};

/**
 * Renders the in-flight assistant message in isolation. Subscribes only to
 * the per-chat streaming slot, so token-by-token updates don't re-render the
 * rest of the conversation.
 */
export function StreamingMessage({
  chatId,
  activeMessages,
}: StreamingMessageProps) {
  const streamingMessage = useSyncExternalStore(
    (listener) => subscribeStreamingMessage(chatId, listener),
    () => getStreamingMessage(chatId),
    () => null,
  );

  const message = combineActiveStreamingMessages(
    activeMessages,
    streamingMessage,
  );

  if (!message) return null;

  perfCount("StreamingMessage.render", {
    id: message.id,
    parts: message.parts.length,
  });

  return <ChatMessage message={message} variant="streaming" />;
}
