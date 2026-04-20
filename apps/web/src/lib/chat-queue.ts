import { useSyncExternalStore } from "react";
import { nanoid } from "nanoid";

export type QueuedPart =
  | { type: "text"; text: string }
  | {
      type: "file";
      url: string;
      mediaType?: string;
      filename?: string;
    };

export type QueueKind = "steer" | "followup";

export type QueueItem = {
  id: string;
  kind: QueueKind;
  parts: QueuedPart[];
  createdAt: number;
};

type ChatQueueState = {
  steer: QueueItem[];
  followup: QueueItem[];
};

const EMPTY_STATE: ChatQueueState = { steer: [], followup: [] };

const stateByChat = new Map<string, ChatQueueState>();
const listenersByChat = new Map<string, Set<() => void>>();

function getChatState(chatId: string): ChatQueueState {
  return stateByChat.get(chatId) ?? EMPTY_STATE;
}

function emit(chatId: string) {
  const listeners = listenersByChat.get(chatId);
  if (!listeners) return;
  for (const listener of listeners) listener();
}

function mutate(
  chatId: string,
  update: (current: ChatQueueState) => ChatQueueState,
) {
  const next = update(getChatState(chatId));
  if (next.steer.length === 0 && next.followup.length === 0) {
    stateByChat.delete(chatId);
  } else {
    stateByChat.set(chatId, next);
  }
  emit(chatId);
}

function subscribe(chatId: string, listener: () => void) {
  let listeners = listenersByChat.get(chatId);
  if (!listeners) {
    listeners = new Set();
    listenersByChat.set(chatId, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners!.delete(listener);
    if (listeners!.size === 0) listenersByChat.delete(chatId);
  };
}

export function useChatQueue(chatId: string | null): ChatQueueState {
  return useSyncExternalStore(
    (listener) => (chatId ? subscribe(chatId, listener) : () => {}),
    () => (chatId ? getChatState(chatId) : EMPTY_STATE),
    () => EMPTY_STATE,
  );
}

export function enqueueChatMessage(
  chatId: string,
  kind: QueueKind,
  parts: QueuedPart[],
): QueueItem {
  const item: QueueItem = {
    id: nanoid(),
    kind,
    parts,
    createdAt: Date.now(),
  };
  mutate(chatId, (current) => ({
    ...current,
    [kind]: [...current[kind], item],
  }));
  return item;
}

export function removeChatQueueItem(chatId: string, itemId: string) {
  mutate(chatId, (current) => ({
    steer: current.steer.filter((item) => item.id !== itemId),
    followup: current.followup.filter((item) => item.id !== itemId),
  }));
}

export function clearChatQueue(chatId: string) {
  mutate(chatId, () => EMPTY_STATE);
}

/** Drain the followup queue according to the configured mode. */
export function drainFollowUpQueue(
  chatId: string,
  mode: "one-at-a-time" | "all",
): QueueItem[] {
  const current = getChatState(chatId);
  if (current.followup.length === 0) return [];

  const drained =
    mode === "all" ? current.followup : current.followup.slice(0, 1);
  const remaining =
    mode === "all" ? [] : current.followup.slice(1);

  mutate(chatId, (c) => ({ ...c, followup: remaining }));
  return drained;
}

/** Drain the steer queue (always fully — steering fires at turn boundaries). */
export function drainSteerQueue(chatId: string): QueueItem[] {
  const current = getChatState(chatId);
  if (current.steer.length === 0) return [];
  const drained = current.steer;
  mutate(chatId, (c) => ({ ...c, steer: [] }));
  return drained;
}

export function getQueueCount(chatId: string): number {
  const s = getChatState(chatId);
  return s.steer.length + s.followup.length;
}
