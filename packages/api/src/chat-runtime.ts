const CHAT_RUNTIME_TTL_MS = 15 * 60 * 1000;

type ChatRuntime = {
  userId: string;
  configKey: string;
  activeStream: ActiveSseStream | null;
  abortCurrentRun: (() => Promise<void>) | null;
  touchedAt: number;
};

const encoder = new TextEncoder();
const chatRuntimes = new Map<string, ChatRuntime>();

function toSseChunk(event: unknown) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function cleanupChatRuntimes() {
  const now = Date.now();

  for (const [chatId, runtime] of chatRuntimes) {
    if (runtime.activeStream) {
      continue;
    }

    if (now - runtime.touchedAt > CHAT_RUNTIME_TTL_MS) {
      chatRuntimes.delete(chatId);
    }
  }
}

class ActiveSseStream {
  private readonly bufferedEvents: string[] = [];
  private readonly subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private isClosed = false;

  connect() {
    const replayBuffer = [...this.bufferedEvents];
    let controllerRef: ReadableStreamDefaultController<Uint8Array>;

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        controllerRef = controller;

        for (const chunk of replayBuffer) {
          controller.enqueue(encoder.encode(chunk));
        }

        if (this.isClosed) {
          controller.close();
          return;
        }

        this.subscribers.add(controller);
      },
      cancel: () => {
        this.subscribers.delete(controllerRef);
      },
    });
  }

  publish(event: unknown) {
    if (this.isClosed) {
      return;
    }

    const chunk = toSseChunk(event);
    this.bufferedEvents.push(chunk);

    for (const subscriber of this.subscribers) {
      subscriber.enqueue(encoder.encode(chunk));
    }
  }

  close() {
    if (this.isClosed) {
      return;
    }

    this.isClosed = true;

    for (const subscriber of this.subscribers) {
      subscriber.close();
    }

    this.subscribers.clear();
  }
}

export async function getChatRuntime(
  chatId: string,
  options: {
    userId: string;
    configKey: string;
  },
) {
  cleanupChatRuntimes();

  const existingRuntime = chatRuntimes.get(chatId);
  if (
    existingRuntime &&
    existingRuntime.userId === options.userId &&
    existingRuntime.configKey === options.configKey
  ) {
    existingRuntime.touchedAt = Date.now();
    return existingRuntime;
  }

  if (existingRuntime?.abortCurrentRun) {
    await existingRuntime.abortCurrentRun();
  }

  const nextRuntime: ChatRuntime = {
    userId: options.userId,
    configKey: options.configKey,
    activeStream: null,
    abortCurrentRun: null,
    touchedAt: Date.now(),
  };

  chatRuntimes.set(chatId, nextRuntime);
  return nextRuntime;
}

export function startChatRuntimeStream(
  chatId: string,
  options: {
    abortCurrentRun: () => Promise<void>;
  },
) {
  const runtime = chatRuntimes.get(chatId);
  if (!runtime) {
    throw new Error(`Missing chat runtime for chat ${chatId}`);
  }

  runtime.activeStream?.close();

  const activeStream = new ActiveSseStream();
  runtime.activeStream = activeStream;
  runtime.abortCurrentRun = options.abortCurrentRun;
  runtime.touchedAt = Date.now();

  return {
    stream: activeStream,
    readable: activeStream.connect(),
  };
}

export function finishChatRuntimeStream(chatId: string) {
  const runtime = chatRuntimes.get(chatId);
  if (!runtime) {
    return;
  }

  runtime.activeStream?.close();
  runtime.activeStream = null;
  runtime.abortCurrentRun = null;
  runtime.touchedAt = Date.now();
}

export function getChatRuntimeReconnectStream(chatId: string, userId: string) {
  cleanupChatRuntimes();

  const runtime = chatRuntimes.get(chatId);
  if (!runtime || runtime.userId !== userId || runtime.activeStream == null) {
    return null;
  }

  runtime.touchedAt = Date.now();
  return runtime.activeStream.connect();
}

export async function abortChatRuntimeRun(
  chatId: string,
  userId: string,
): Promise<boolean> {
  const runtime = chatRuntimes.get(chatId);
  if (!runtime || runtime.userId !== userId) {
    return false;
  }

  const abortCurrentRun = runtime.abortCurrentRun;
  if (abortCurrentRun) {
    await abortCurrentRun();
  }

  finishChatRuntimeStream(chatId);
  return true;
}
