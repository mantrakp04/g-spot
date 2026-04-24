const CHAT_RUNTIME_TTL_MS = 15 * 60 * 1000;

type PendingApproval = {
  toolName: string;
  args: unknown;
  resolve: (decision: { approved: boolean; reason?: string }) => void;
};

type ChatRuntimeSubscriber = (event: unknown) => void;
type ChatRuntimeStatusSubscriber = (
  statuses: Record<string, ChatRuntimeStatus>,
) => void;

type ChatRuntime = {
  configKey: string;
  activeStream: ActiveChatStream | null;
  abortCurrentRun: (() => Promise<void>) | null;
  pendingApprovals: Map<string, PendingApproval>;
  finishedUnread: boolean;
  touchedAt: number;
};

const chatRuntimes = new Map<string, ChatRuntime>();
const statusSubscribers = new Set<ChatRuntimeStatusSubscriber>();

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

function publishRuntimeStatuses() {
  const snapshot = snapshotChatRuntimeStatuses();
  for (const subscriber of statusSubscribers) {
    subscriber(snapshot);
  }
}

class ActiveChatStream {
  private readonly bufferedEvents: unknown[] = [];
  private readonly subscribers = new Set<ChatRuntimeSubscriber>();
  private isClosed = false;

  subscribe(subscriber: ChatRuntimeSubscriber) {
    const replayBuffer = [...this.bufferedEvents];

    for (const event of replayBuffer) {
      subscriber(event);
    }

    if (this.isClosed) {
      return () => {};
    }

    this.subscribers.add(subscriber);

    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  publish(event: unknown) {
    if (this.isClosed) {
      return;
    }

    this.bufferedEvents.push(event);

    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }

  close() {
    if (this.isClosed) {
      return;
    }

    this.isClosed = true;
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
    configKey: string;
  },
) {
  cleanupChatRuntimes();

  const existingRuntime = chatRuntimes.get(chatId);
  if (existingRuntime && existingRuntime.configKey === options.configKey) {
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
    configKey: options.configKey,
    activeStream: null,
    abortCurrentRun: null,
    pendingApprovals: new Map(),
    finishedUnread: false,
    touchedAt: Date.now(),
  };

  chatRuntimes.set(chatId, nextRuntime);
  publishRuntimeStatuses();
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

  const activeStream = new ActiveChatStream();
  runtime.activeStream = activeStream;
  runtime.abortCurrentRun = options.abortCurrentRun;
  runtime.finishedUnread = false;
  runtime.touchedAt = Date.now();

  publishRuntimeStatuses();

  return {
    stream: activeStream,
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
  runtime.finishedUnread = true;
  runtime.touchedAt = Date.now();
  publishRuntimeStatuses();
}

export function subscribeToChatRuntimeStream(
  chatId: string,
  subscriber: ChatRuntimeSubscriber,
) {
  cleanupChatRuntimes();

  const runtime = chatRuntimes.get(chatId);
  if (!runtime || runtime.activeStream == null) {
    return null;
  }

  runtime.touchedAt = Date.now();
  return runtime.activeStream.subscribe(subscriber);
}

export async function abortChatRuntimeRun(chatId: string): Promise<boolean> {
  const runtime = chatRuntimes.get(chatId);
  if (!runtime) {
    return false;
  }

  failPendingApprovalsForRuntime(runtime, "Run aborted before approval.");

  const abortCurrentRun = runtime.abortCurrentRun;
  if (abortCurrentRun) {
    await abortCurrentRun();
  }

  finishChatRuntimeStream(chatId);
  return true;
}

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
    publishRuntimeStatuses();
  });
}

export function resolveChatToolApproval(
  chatId: string,
  input: { toolCallId: string; approved: boolean; reason?: string },
): boolean {
  const runtime = chatRuntimes.get(chatId);
  if (!runtime) {
    return false;
  }

  const pending = runtime.pendingApprovals.get(input.toolCallId);
  if (!pending) {
    return false;
  }

  runtime.pendingApprovals.delete(input.toolCallId);
  pending.resolve({ approved: input.approved, reason: input.reason });
  publishRuntimeStatuses();
  return true;
}

export function getPendingApprovalCount(chatId: string): number {
  return chatRuntimes.get(chatId)?.pendingApprovals.size ?? 0;
}

export function snapshotChatRuntimeStatuses(): Record<string, ChatRuntimeStatus> {
  cleanupChatRuntimes();

  const result: Record<string, ChatRuntimeStatus> = {};
  for (const [chatId, runtime] of chatRuntimes) {
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

export function markChatRuntimeRead(chatId: string): boolean {
  const runtime = chatRuntimes.get(chatId);
  if (!runtime || !runtime.finishedUnread) {
    return false;
  }

  runtime.finishedUnread = false;
  runtime.touchedAt = Date.now();
  publishRuntimeStatuses();
  return true;
}

export function subscribeToChatRuntimeStatuses(
  subscriber: ChatRuntimeStatusSubscriber,
) {
  cleanupChatRuntimes();
  statusSubscribers.add(subscriber);
  subscriber(snapshotChatRuntimeStatuses());

  return () => {
    statusSubscribers.delete(subscriber);
  };
}

export type ChatRuntimeStatus =
  | "running"
  | "pending-approval"
  | "finished-unread";
