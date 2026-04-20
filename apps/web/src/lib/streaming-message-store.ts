import type { UIMessage } from "@/lib/chat-ui";

/**
 * Per-chat holder for the in-flight assistant message. Isolated from the main
 * `messages` array so that streaming token updates trigger re-renders only
 * inside <StreamingMessage /> — never inside <ChatMessageList />.
 *
 * Writes are coalesced per animation frame: many token updates within one
 * frame produce exactly one listener notification.
 */

type Listener = () => void;

type StreamingSlot = {
  message: UIMessage | null;
  listeners: Set<Listener>;
  pending: UIMessage | null;
  scheduled: boolean;
};

const slots = new Map<string, StreamingSlot>();

function getSlot(chatId: string): StreamingSlot {
  let slot = slots.get(chatId);
  if (!slot) {
    slot = { message: null, listeners: new Set(), pending: null, scheduled: false };
    slots.set(chatId, slot);
  }
  return slot;
}

function emit(slot: StreamingSlot) {
  for (const listener of slot.listeners) listener();
}

function flush(chatId: string) {
  const slot = slots.get(chatId);
  if (!slot) return;
  slot.scheduled = false;
  slot.message = slot.pending;
  slot.pending = null;
  emit(slot);
}

function schedule(chatId: string, slot: StreamingSlot) {
  if (slot.scheduled) return;
  slot.scheduled = true;
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => flush(chatId));
  } else {
    queueMicrotask(() => flush(chatId));
  }
}

export function setStreamingMessage(
  chatId: string,
  message: UIMessage | null,
  options: { immediate?: boolean } = {},
) {
  const slot = getSlot(chatId);
  slot.pending = message;

  if (options.immediate) {
    slot.scheduled = false;
    slot.message = slot.pending;
    slot.pending = null;
    emit(slot);
    return;
  }

  schedule(chatId, slot);
}

export function clearStreamingMessage(chatId: string) {
  setStreamingMessage(chatId, null, { immediate: true });
}

export function subscribeStreamingMessage(
  chatId: string,
  listener: Listener,
): () => void {
  const slot = getSlot(chatId);
  slot.listeners.add(listener);
  return () => {
    slot.listeners.delete(listener);
    if (slot.listeners.size === 0 && !slot.message && !slot.pending) {
      slots.delete(chatId);
    }
  };
}

export function getStreamingMessage(chatId: string): UIMessage | null {
  return slots.get(chatId)?.message ?? null;
}
