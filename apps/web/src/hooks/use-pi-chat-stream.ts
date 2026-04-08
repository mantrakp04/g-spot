import { useCallback, useEffect, useRef, useState } from "react";

import { logChatDebug } from "@/lib/chat-debug";
import {
  type ChatStatus,
  type ChatStreamEvent,
  type UIMessage,
  isGSpotErrorEvent,
  readChatEvents,
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
 * Owns the network + SSE consumer lifecycle for chat streams. Does not own
 * `messages` state — the caller mutates messages from `onEvent`. The hook
 * exposes both `startStream` (POST a fresh user message) and
 * `attachToExistingStream` (GET probe to reattach to a server-side run that's
 * still buffering events). Both feed into the same internal consume loop.
 *
 * Reattach safety:
 * - A single `AbortController` guards the active reader; new starts/attaches
 *   abort the previous one.
 * - `modeRef` prevents `attachToExistingStream` from racing a live POST.
 * - Component unmount aborts the reader only — the server-side run keeps
 *   going (per `ActiveSseStream.connect()` cancel handler) so a future
 *   reconnect probe can re-attach.
 */
export function usePiChatStream(args: UsePiChatStreamArgs): PiChatStreamApi {
  const argsRef = useRef(args);
  argsRef.current = args;

  const [status, setStatus] = useState<ChatStatus>("ready");
  const abortControllerRef = useRef<AbortController | null>(null);
  const modeRef = useRef<StreamMode>("idle");

  const consumeStream = useCallback(
    async (
      body: ReadableStream<Uint8Array>,
      targetChatId: string,
      controller: AbortController,
      isReconnect: boolean,
    ) => {
      try {
        for await (const event of readChatEvents(body)) {
          if (controller.signal.aborted) {
            break;
          }

          if (isGSpotErrorEvent(event)) {
            throw new Error(event.message);
          }

          argsRef.current.onEvent(event, { isReconnect });
        }

        if (!controller.signal.aborted) {
          setStatus("ready");
          argsRef.current.onStreamComplete?.(targetChatId);
          logChatDebug("stream-complete", { targetChatId, isReconnect });
        }
      } catch (error) {
        if (controller.signal.aborted) {
          logChatDebug("stream-aborted", { targetChatId, isReconnect });
          return;
        }

        setStatus("error");
        const err = error instanceof Error ? error : new Error(String(error));
        logChatDebug("stream-error", { targetChatId, isReconnect, error: err });
        argsRef.current.onError?.(err);
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
          modeRef.current = "idle";
        }
      }
    },
    [],
  );

  const startStream = useCallback(
    async (userMessage: UIMessage) => {
      const targetChatId = argsRef.current.chatId;
      if (!targetChatId) {
        return;
      }

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      modeRef.current = "post";
      setStatus("submitted");

      logChatDebug("stream-start", { targetChatId });

      try {
        const response = await fetch(`${argsRef.current.serverUrl}/api/chat`, {
          method: "POST",
          headers: await argsRef.current.getHeaders(),
          body: JSON.stringify({
            chatId: targetChatId,
            message: userMessage,
          }),
          signal: controller.signal,
        });

        logChatDebug("stream-response", {
          targetChatId,
          ok: response.ok,
          status: response.status,
          hasBody: Boolean(response.body),
        });

        if (!response.ok || !response.body) {
          throw new Error(`Chat request failed (${response.status})`);
        }

        if (controller.signal.aborted) {
          return;
        }

        setStatus("streaming");
        await consumeStream(response.body, targetChatId, controller, false);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setStatus("error");
        const err = error instanceof Error ? error : new Error(String(error));
        logChatDebug("stream-start-error", { targetChatId, error: err });
        argsRef.current.onError?.(err);

        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
          modeRef.current = "idle";
        }
      }
    },
    [consumeStream],
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

    const controller = new AbortController();
    abortControllerRef.current = controller;
    modeRef.current = "reconnect";

    try {
      const response = await fetch(
        `${argsRef.current.serverUrl}/api/chat/${targetChatId}/stream`,
        {
          method: "GET",
          headers: await argsRef.current.getHeaders(),
          signal: controller.signal,
        },
      );

      if (response.status === 204) {
        logChatDebug("reconnect-no-stream", { targetChatId });
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
          modeRef.current = "idle";
        }
        return false;
      }

      if (!response.ok || !response.body) {
        throw new Error(`Reconnect failed (${response.status})`);
      }

      if (controller.signal.aborted) {
        return false;
      }

      logChatDebug("stream-reattached", { targetChatId });
      setStatus("streaming");
      void consumeStream(response.body, targetChatId, controller, true);
      return true;
    } catch (error) {
      if (controller.signal.aborted) {
        return false;
      }

      const err = error instanceof Error ? error : new Error(String(error));
      logChatDebug("reconnect-error", { targetChatId, error: err });

      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        modeRef.current = "idle";
      }
      return false;
    }
  }, [consumeStream]);

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
        // DELETE is best-effort. Even if it fails, we still want to detach
        // locally so the UI is responsive.
        logChatDebug("stream-stop-delete-failed", { targetChatId, error });
      }
    }

    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    modeRef.current = "idle";
    setStatus("ready");
  }, []);

  // Unmount cleanup: detach the local reader, but do NOT call DELETE. The
  // server-side run keeps going and a future reconnect probe can reattach.
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      modeRef.current = "idle";
    };
  }, []);

  return {
    status,
    isActive: status === "submitted" || status === "streaming",
    startStream,
    attachToExistingStream,
    stopEverywhere,
  };
}
