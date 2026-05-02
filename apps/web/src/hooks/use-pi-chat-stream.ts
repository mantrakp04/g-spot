import { useCallback, useEffect, useRef, useState } from "react";

import { logChatDebug } from "@/lib/chat-debug";
import {
  type ChatStatus,
  type ChatStreamEvent,
  type UIMessage,
} from "@/lib/chat-ui";
import {
  createChatStreamSocket,
  type ChatStreamSocketHandle,
} from "@/lib/chat-stream-socket";

type StreamMode = "idle" | "start" | "reconnect";

type StreamEventCtx = {
  chatId: string;
  isReconnect: boolean;
};

export type UsePiChatStreamArgs = {
  chatId: string | null;
  serverUrl: string;
  getHeaders: () => Promise<Record<string, string>>;
  onEvent: (event: ChatStreamEvent, ctx: StreamEventCtx) => void;
  onError?: (error: Error) => void;
  onStreamComplete?: (chatId: string) => void;
};

export type PiChatStreamApi = {
  status: ChatStatus;
  isActive: boolean;
  startStream: (userMessage: UIMessage) => Promise<void>;
  attachToExistingStream: () => Promise<boolean>;
  stopEverywhere: () => Promise<void>;
};

/**
 * Owns the network + WebSocket consumer lifecycle for chat streams. Does not
 * own `messages` state — the caller mutates messages from `onEvent`.
 */
export function usePiChatStream(args: UsePiChatStreamArgs): PiChatStreamApi {
  const argsRef = useRef(args);
  argsRef.current = args;

  const [status, setStatus] = useState<ChatStatus>("ready");
  const socketHandleRef = useRef<ChatStreamSocketHandle | null>(null);
  const modeRef = useRef<StreamMode>("idle");

  const closeActiveSocket = useCallback(() => {
    socketHandleRef.current?.close();
    socketHandleRef.current = null;
    modeRef.current = "idle";
  }, []);

  const buildSocketUrl = useCallback((targetChatId: string) => {
    const url = new URL(argsRef.current.serverUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `/api/chat/${targetChatId}/socket`;
    url.search = "";
    url.hash = "";
    return url.toString();
  }, []);

  const connectSocket = useCallback(
    async (
      targetChatId: string,
      mode: Exclude<StreamMode, "idle">,
      initialMessage: { type: "start"; message: UIMessage } | { type: "attach" },
    ) => {
      modeRef.current = mode;

      const handle = createChatStreamSocket({
        url: buildSocketUrl(targetChatId),
        mode,
        initialMessage,
        onEvent: (event, ctx) => {
          if (
            socketHandleRef.current !== handle ||
            argsRef.current.chatId !== targetChatId
          ) {
            return;
          }

          argsRef.current.onEvent(event, {
            ...ctx,
            chatId: targetChatId,
          });
        },
        onError: (err) => {
          if (
            socketHandleRef.current !== handle ||
            argsRef.current.chatId !== targetChatId
          ) {
            return;
          }

          setStatus("error");
          argsRef.current.onError?.(err);
        },
        onComplete: () => {
          const isCurrentSocket = socketHandleRef.current === handle;
          if (isCurrentSocket) {
            setStatus("ready");
          }

          argsRef.current.onStreamComplete?.(targetChatId);
          logChatDebug("stream-complete", {
            targetChatId,
            isReconnect: mode === "reconnect",
          });

          if (isCurrentSocket) {
            socketHandleRef.current = null;
            modeRef.current = "idle";
          }
        },
        onUnexpectedClose: (err) => {
          if (
            socketHandleRef.current !== handle ||
            argsRef.current.chatId !== targetChatId
          ) {
            return;
          }

          socketHandleRef.current = null;
          modeRef.current = "idle";
          setStatus("error");
          logChatDebug("stream-close-unexpected", {
            targetChatId,
            isReconnect: mode === "reconnect",
            error: err,
          });
          argsRef.current.onError?.(err);
        },
      });

      socketHandleRef.current = handle;
      const attached = await handle.attached;
      if (attached && socketHandleRef.current === handle) {
        setStatus("streaming");
      } else if (!attached && socketHandleRef.current === handle) {
        socketHandleRef.current = null;
        modeRef.current = "idle";
      }
      return attached;
    },
    [buildSocketUrl],
  );

  const startStream = useCallback(
    async (userMessage: UIMessage) => {
      const targetChatId = argsRef.current.chatId;
      if (!targetChatId) {
        return;
      }

      closeActiveSocket();
      modeRef.current = "start";
      setStatus("submitted");

      logChatDebug("stream-start", { targetChatId });

      try {
        const attached = await connectSocket(targetChatId, "start", {
          type: "start",
          message: userMessage,
        });
        if (!attached && argsRef.current.chatId === targetChatId) {
          throw new Error("Chat socket did not attach");
        }
      } catch (error) {
        if (argsRef.current.chatId !== targetChatId) {
          return;
        }

        setStatus("error");
        const err = error instanceof Error ? error : new Error(String(error));
        logChatDebug("stream-start-error", { targetChatId, error: err });
        argsRef.current.onError?.(err);
        closeActiveSocket();
      }
    },
    [closeActiveSocket, connectSocket],
  );

  const attachToExistingStream = useCallback(async (): Promise<boolean> => {
    const targetChatId = argsRef.current.chatId;
    if (!targetChatId) {
      return false;
    }

    if (modeRef.current !== "idle") {
      logChatDebug("reconnect-skipped", {
        targetChatId,
        reason: modeRef.current,
      });
      return false;
    }

    closeActiveSocket();

    try {
      const attached = await connectSocket(targetChatId, "reconnect", {
        type: "attach",
      });
      if (attached) {
        logChatDebug("stream-reattached", { targetChatId });
      } else {
        logChatDebug("reconnect-no-stream", { targetChatId });
      }
      return attached;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logChatDebug("reconnect-error", { targetChatId, error: err });
      closeActiveSocket();
      return false;
    }
  }, [closeActiveSocket, connectSocket]);

  const stopEverywhere = useCallback(async () => {
    const targetChatId = argsRef.current.chatId;
    logChatDebug("stream-stop-everywhere", { targetChatId });

    if (targetChatId) {
      try {
        await fetch(
          `${argsRef.current.serverUrl}/api/chat/${targetChatId}/stream`,
          {
            method: "DELETE",
            headers: await argsRef.current.getHeaders(),
          },
        );
      } catch (error) {
        logChatDebug("stream-stop-delete-failed", { targetChatId, error });
      }
    }

    closeActiveSocket();
    setStatus("ready");
  }, [closeActiveSocket]);

  useEffect(() => {
    closeActiveSocket();
    setStatus("ready");
  }, [args.chatId, closeActiveSocket]);

  useEffect(() => {
    return () => {
      closeActiveSocket();
    };
  }, [closeActiveSocket]);

  return {
    status,
    isActive: status === "submitted" || status === "streaming",
    startStream,
    attachToExistingStream,
    stopEverywhere,
  };
}
