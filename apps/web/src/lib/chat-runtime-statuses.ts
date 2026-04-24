import { useEffect, useSyncExternalStore } from "react";

import { env } from "@g-spot/env/web";

import type { ChatRuntimeDotStatus } from "@/components/chat/chat-status-dot";

type RuntimeStatusSnapshot = Record<string, ChatRuntimeDotStatus>;

const EMPTY_SNAPSHOT: RuntimeStatusSnapshot = {};
let snapshot: RuntimeStatusSnapshot = EMPTY_SNAPSHOT;
const listeners = new Set<() => void>();
let statusSocket: WebSocket | null = null;
let activeChatId: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function setSnapshot(next: RuntimeStatusSnapshot) {
  snapshot = next;
  emit();
}

function buildStatusSocketUrl() {
  const url = new URL(env.VITE_SERVER_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/chat/status/socket";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function clearReconnectTimer() {
  if (!reconnectTimer) {
    return;
  }

  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function scheduleReconnect() {
  if (listeners.size === 0 || reconnectTimer) {
    return;
  }

  const delay = Math.min(1000 * 2 ** reconnectAttempt, 15_000);
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectStatusSocket();
  }, delay);
}

function sendMarkRead(chatId: string) {
  if (statusSocket?.readyState !== WebSocket.OPEN) {
    return;
  }

  statusSocket.send(JSON.stringify({ type: "mark_read", chatId }));
}

function connectStatusSocket() {
  if (
    statusSocket &&
    (statusSocket.readyState === WebSocket.OPEN ||
      statusSocket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  clearReconnectTimer();
  const socket = new WebSocket(buildStatusSocketUrl());
  statusSocket = socket;

  socket.addEventListener("open", () => {
    reconnectAttempt = 0;
    if (activeChatId) {
      sendMarkRead(activeChatId);
    }
  });

  socket.addEventListener("message", (event) => {
    const payload =
      typeof event.data === "string" ? event.data : String(event.data);

    try {
      const parsed = JSON.parse(payload) as {
        type?: unknown;
        statuses?: unknown;
      };
      if (
        parsed.type === "runtime_statuses" &&
        parsed.statuses &&
        typeof parsed.statuses === "object"
      ) {
        const next = parsed.statuses as RuntimeStatusSnapshot;
        setSnapshot(next);
        if (
          activeChatId &&
          next[activeChatId] === "finished-unread"
        ) {
          sendMarkRead(activeChatId);
        }
      }
    } catch {
    }
  });

  socket.addEventListener("close", () => {
    if (statusSocket === socket) {
      statusSocket = null;
      scheduleReconnect();
    }
  });

  socket.addEventListener("error", () => {
    if (statusSocket === socket) {
      statusSocket = null;
      scheduleReconnect();
    }
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  connectStatusSocket();

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearReconnectTimer();
      statusSocket?.close();
      statusSocket = null;
      reconnectAttempt = 0;
    }
  };
}

export function getChatRuntimeStatuses() {
  return snapshot;
}

export function useChatRuntimeStatuses(activeId: string | null | undefined) {
  useEffect(() => {
    const nextActiveChatId = activeId ?? null;
    activeChatId = nextActiveChatId;
    if (activeChatId) {
      sendMarkRead(activeChatId);
    }

    return () => {
      if (activeChatId === nextActiveChatId) {
        activeChatId = null;
      }
    };
  }, [activeId]);

  return useSyncExternalStore(subscribe, getChatRuntimeStatuses, () => EMPTY_SNAPSHOT);
}
