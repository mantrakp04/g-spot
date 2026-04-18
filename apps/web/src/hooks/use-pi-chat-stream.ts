import { useCallback, useEffect, useRef, useState } from "react";

import { logChatDebug } from "@/lib/chat-debug";
import {
  type ChatSocketStateEvent,
  type ChatStatus,
  type ChatStreamEvent,
  type UIMessage,
  isChatSocketStateEvent,
  isGSpotErrorEvent,
  parseChatSocketMessage,
} from "@/lib/chat-ui";

type StreamMode = "idle" | "post" | "reconnect";

type StreamEventCtx = {
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
  const socketRef = useRef<WebSocket | null>(null);
  const modeRef = useRef<StreamMode>("idle");

  const closeActiveSocket = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
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
    (
      targetChatId: string,
      mode: Exclude<StreamMode, "idle">,
      initialMessage: { type: "start"; message: UIMessage } | { type: "attach" },
    ) =>
      new Promise<boolean>((resolve, reject) => {
        const socket = new WebSocket(buildSocketUrl(targetChatId));
        let settled = false;
        let attached = false;

        socketRef.current = socket;
        modeRef.current = mode;

        const settle = (callback: () => void) => {
          if (settled) {
            return;
          }
          settled = true;
          callback();
        };

        socket.addEventListener("open", () => {
          socket.send(
            JSON.stringify(
              initialMessage.type === "start"
                ? { type: "start", message: initialMessage.message }
                : { type: "attach" },
            ),
          );
        });

        socket.addEventListener("message", (rawEvent) => {
          const payload =
            typeof rawEvent.data === "string" ? rawEvent.data : String(rawEvent.data);

          let event: ChatStreamEvent | ChatSocketStateEvent;
          try {
            event = parseChatSocketMessage(payload);
          } catch (error) {
            const err =
              error instanceof Error
                ? error
                : new Error("Invalid chat socket message");
            settle(() => reject(err));
            return;
          }

          if (isChatSocketStateEvent(event)) {
            if (event.type === "socket_missing") {
              settle(() => resolve(false));
              socket.close();
              return;
            }

            attached = true;
            setStatus("streaming");
            settle(() => resolve(true));
            return;
          }

          if (isGSpotErrorEvent(event)) {
            const err = new Error(event.message);
            settle(() => reject(err));
            setStatus("error");
            argsRef.current.onError?.(err);
            return;
          }

          argsRef.current.onEvent(event, {
            isReconnect: mode === "reconnect",
          });
        });

        socket.addEventListener("close", () => {
          if (socketRef.current === socket) {
            socketRef.current = null;
            modeRef.current = "idle";
          }

          if (!settled) {
            settle(() => resolve(false));
            return;
          }

          if (!attached) {
            return;
          }

          setStatus("ready");
          argsRef.current.onStreamComplete?.(targetChatId);
          logChatDebug("stream-complete", {
            targetChatId,
            isReconnect: mode === "reconnect",
          });
        });

        socket.addEventListener("error", () => {
          const err = new Error("Chat socket failed");
          if (!settled) {
            settle(() => reject(err));
          }
          setStatus("error");
          argsRef.current.onError?.(err);
        });
      }),
    [buildSocketUrl],
  );

  const startStream = useCallback(
    async (userMessage: UIMessage) => {
      const targetChatId = argsRef.current.chatId;
      if (!targetChatId) {
        return;
      }

      closeActiveSocket();
      modeRef.current = "post";
      setStatus("submitted");

      logChatDebug("stream-start", { targetChatId });

      try {
        const attached = await connectSocket(targetChatId, "post", {
          type: "start",
          message: userMessage,
        });
        if (!attached) {
          throw new Error("Chat socket did not attach");
        }
      } catch (error) {
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
