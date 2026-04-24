import {
  type ChatSocketStateEvent,
  type ChatStreamEvent,
  type UIMessage,
  isChatSocketStateEvent,
  isGSpotErrorEvent,
  parseChatSocketMessage,
} from "@/lib/chat-ui";

export type ChatStreamSocketMode = "start" | "reconnect";

type ChatStreamSocketInput =
  | { type: "start"; message: UIMessage }
  | { type: "attach" };

type ChatStreamSocketOptions = {
  url: string;
  mode: ChatStreamSocketMode;
  initialMessage: ChatStreamSocketInput;
  onEvent: (event: ChatStreamEvent, ctx: { isReconnect: boolean }) => void;
  onError: (error: Error) => void;
  onComplete: () => void;
  onUnexpectedClose: (error: Error) => void;
};

export type ChatStreamSocketHandle = {
  socket: WebSocket;
  attached: Promise<boolean>;
  close: () => void;
};

export function createChatStreamSocket(
  options: ChatStreamSocketOptions,
): ChatStreamSocketHandle {
  const socket = new WebSocket(options.url);
  let settled = false;
  let attached = false;
  let completionHandled = false;
  let ignoredClose = false;

  const settle = (
    resolve: (value: boolean) => void,
    reject: (reason: Error) => void,
    callback: () => boolean,
  ) => {
    if (settled) {
      return;
    }
    try {
      settled = true;
      resolve(callback());
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const attachedPromise = new Promise<boolean>((resolve, reject) => {
    const rejectAttachOrNotify = (err: Error) => {
      if (!settled) {
        settle(resolve, reject, () => {
          throw err;
        });
        return;
      }

      if (attached && !completionHandled) {
        options.onError(err);
      }
    };

    const handleComplete = () => {
      if (completionHandled) {
        return;
      }
      completionHandled = true;
      options.onComplete();
      ignoredClose = true;
      socket.close();
    };

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify(
          options.initialMessage.type === "start"
            ? { type: "start", message: options.initialMessage.message }
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
        settle(resolve, reject, () => {
          throw err;
        });
        return;
      }

      if (isChatSocketStateEvent(event)) {
        if (event.type === "socket_missing") {
          settle(resolve, reject, () => false);
          ignoredClose = true;
          socket.close();
          return;
        }

        if (event.type === "stream_finished") {
          attached = true;
          settle(resolve, reject, () => true);
          handleComplete();
          return;
        }

        if (completionHandled) {
          return;
        }

        attached = true;
        settle(resolve, reject, () => true);
        return;
      }

      if (isGSpotErrorEvent(event)) {
        const err = new Error(event.message);
        rejectAttachOrNotify(err);
        return;
      }

      options.onEvent(event, {
        isReconnect: options.mode === "reconnect",
      });
    });

    socket.addEventListener("close", () => {
      if (!settled) {
        settle(resolve, reject, () => false);
        return;
      }

      if (ignoredClose || completionHandled || !attached) {
        return;
      }

      options.onUnexpectedClose(new Error("Chat socket closed unexpectedly"));
    });

    socket.addEventListener("error", () => {
      const err = new Error("Chat socket failed");
      rejectAttachOrNotify(err);
    });
  });

  return {
    socket,
    attached: attachedPromise,
    close: () => {
      ignoredClose = true;
      socket.close();
    },
  };
}
