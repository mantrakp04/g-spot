const CHAT_RUNTIME_TTL_MS = 15 * 60 * 1000;

/**
 * A single in-flight `beforeToolCall` awaiting an approve/deny decision from
 * the user. Resolved by `resolveChatToolApproval`, which is itself called by
 * the `chat.resolveToolApproval` tRPC mutation.
 */
type PendingApproval = {
  toolName: string;
  args: unknown;
  resolve: (decision: { approved: boolean; reason?: string }) => void;
};

type ChatRuntime = {
  userId: string;
  configKey: string;
  activeStream: ActiveSseStream | null;
  abortCurrentRun: (() => Promise<void>) | null;
  pendingApprovals: Map<string, PendingApproval>;
  /**
   * A run just finished on this chat and nobody has acknowledged it yet. The
   * sidebar shows a green dot on the chat row until the user opens it and
   * the web calls `chat.markChatRead`. Reset to `false` whenever a new
   * stream starts.
   */
  finishedUnread: boolean;
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

function failPendingApprovalsForRuntime(runtime: ChatRuntime, reason: string) {
  if (runtime.pendingApprovals.size === 0) {
    return;
  }

  for (const [, approval] of runtime.pendingApprovals) {
    approval.resolve({ approved: false, reason });
  }
  runtime.pendingApprovals.clear();
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

  if (existingRuntime) {
    failPendingApprovalsForRuntime(
      existingRuntime,
      "Chat runtime rebuilt — pending approval cancelled.",
    );
    if (existingRuntime.abortCurrentRun) {
      await existingRuntime.abortCurrentRun();
    }
  }

  const nextRuntime: ChatRuntime = {
    userId: options.userId,
    configKey: options.configKey,
    activeStream: null,
    abortCurrentRun: null,
    pendingApprovals: new Map(),
    finishedUnread: false,
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
  // A new run starts fresh — any prior "unread finished" mark is stale now.
  runtime.finishedUnread = false;
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
  // Mark the chat as "unread completion" so the sidebar keeps showing a
  // green dot until the user actually opens the chat and calls
  // `chat.markChatRead` (or they were already viewing it and the web
  // auto-acks on stream complete).
  runtime.finishedUnread = true;
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

  // Any tool calls still waiting on approval need to fail first — otherwise
  // the promise chain inside `beforeToolCall` would leak and the session
  // couldn't actually abort.
  failPendingApprovalsForRuntime(
    runtime,
    "Run aborted before approval.",
  );

  const abortCurrentRun = runtime.abortCurrentRun;
  if (abortCurrentRun) {
    await abortCurrentRun();
  }

  finishChatRuntimeStream(chatId);
  return true;
}

/**
 * Register a pending tool-call approval on the chat runtime. Returns a
 * promise that resolves once the client calls `chat.resolveToolApproval` for
 * the given `toolCallId` — or rejects implicitly via
 * `resolveChatToolApproval` when a deny is received.
 *
 * If the chat runtime disappears mid-wait (server restart, TTL cleanup, new
 * run), the returned promise resolves as `{ approved: false }` so the caller
 * can fail the tool gracefully instead of hanging forever.
 */
export function awaitChatToolApproval(
  chatId: string,
  toolCallId: string,
  context: { toolName: string; args: unknown },
): Promise<{ approved: boolean; reason?: string }> {
  const runtime = chatRuntimes.get(chatId);
  if (!runtime) {
    return Promise.resolve({
      approved: false,
      reason: "Chat runtime unavailable.",
    });
  }

  return new Promise((resolve) => {
    runtime.pendingApprovals.set(toolCallId, {
      toolName: context.toolName,
      args: context.args,
      resolve,
    });
  });
}

/**
 * Called from `chat.resolveToolApproval`. Returns `true` when a matching
 * pending approval was actually resolved so the router can 204 vs 404-ish
 * back to the client.
 */
export function resolveChatToolApproval(
  chatId: string,
  userId: string,
  input: { toolCallId: string; approved: boolean; reason?: string },
): boolean {
  const runtime = chatRuntimes.get(chatId);
  if (!runtime || runtime.userId !== userId) {
    return false;
  }

  const pending = runtime.pendingApprovals.get(input.toolCallId);
  if (!pending) {
    return false;
  }

  runtime.pendingApprovals.delete(input.toolCallId);
  pending.resolve({ approved: input.approved, reason: input.reason });
  return true;
}

/** Read-only snapshot used by debug tooling. */
export function getPendingApprovalCount(chatId: string): number {
  return chatRuntimes.get(chatId)?.pendingApprovals.size ?? 0;
}

/**
 * Per-chat runtime status used by the sidebar dot. A chat is:
 *
 *   - "pending-approval" — at least one tool call is waiting on the user
 *   - "running"          — a stream is active (model is generating or a
 *                          tool is executing)
 *   - "finished-unread"  — a run just finished and the user hasn't opened
 *                          the chat yet. Cleared via `markChatRuntimeRead`.
 *
 * Chats with no active runtime and nothing unread are absent from the map,
 * which the client treats as "idle / nothing to show".
 */
export type ChatRuntimeStatus =
  | "running"
  | "pending-approval"
  | "finished-unread";

export function snapshotChatRuntimeStatuses(
  userId: string,
): Record<string, ChatRuntimeStatus> {
  cleanupChatRuntimes();

  const result: Record<string, ChatRuntimeStatus> = {};

  for (const [chatId, runtime] of chatRuntimes) {
    if (runtime.userId !== userId) {
      continue;
    }

    if (runtime.pendingApprovals.size > 0) {
      result[chatId] = "pending-approval";
      continue;
    }

    if (runtime.activeStream) {
      result[chatId] = "running";
      continue;
    }

    if (runtime.finishedUnread) {
      result[chatId] = "finished-unread";
    }
  }

  return result;
}

/**
 * Clear the "finished-unread" flag when the user opens (or is actively
 * viewing) the chat. The web calls this on chat mount and again whenever a
 * stream completes while the chat is visible.
 */
export function markChatRuntimeRead(
  chatId: string,
  userId: string,
): boolean {
  const runtime = chatRuntimes.get(chatId);
  if (!runtime || runtime.userId !== userId) {
    return false;
  }
  if (!runtime.finishedUnread) {
    return false;
  }
  runtime.finishedUnread = false;
  runtime.touchedAt = Date.now();
  return true;
}
