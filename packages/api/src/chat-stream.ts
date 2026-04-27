import {
  getChat,
  getChatMessages,
  saveChatMessage,
} from "@g-spot/db/chat";
import { getProject } from "@g-spot/db/projects";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { Message } from "@mariozechner/pi-ai";
import { nanoid } from "nanoid";

import {
  abortChatRuntimeRun,
  awaitChatToolApproval,
  finishChatRuntimeStream,
  getChatRuntime,
  markChatRuntimeRead,
  startChatRuntimeStream,
  subscribeToChatRuntimeStatuses,
  subscribeToChatRuntimeStream,
} from "./chat-runtime";
import { refreshChatTitle } from "./chat-title";
import { extractChatTurnToMemory } from "./lib/memory-ingest-hook";
import { listWorkspaces } from "./lib/git";
import {
  getMcpToolsForProject,
  loadProjectMcps,
} from "./lib/mcp/manager";
import {
  createPiAgentSession,
  normalizeStoredChatAgentConfig,
  type PiAgentSessionProject,
} from "./lib/pi";
import {
  createUserMessageFromUnknown,
  deserializePiMessages,
  serializePiMessage,
} from "./lib/pi-chat-messages";
import { decidePermission } from "./lib/pi-permissions";

type ChatStreamRequestBody = {
  chatId: string;
  prompt?: string;
  message?: unknown;
};

type ChatSocketClientMessage =
  | {
      type: "start";
      prompt?: string;
      message?: unknown;
    }
  | {
      type: "attach";
    };

type ChatSocket = {
  raw: {
    send: (data: string) => unknown;
  };
  data: {
    params: {
      chatId: string;
    };
  };
};

type ChatStatusSocket = {
  raw: {
    send: (data: string) => unknown;
  };
};

type ChatStatusSocketClientMessage = {
  type: "mark_read";
  chatId: string;
};

const chatSocketSubscriptions = new WeakMap<
  ChatSocket,
  () => void
>();
const chatStatusSocketSubscriptions = new WeakMap<
  ChatStatusSocket,
  () => void
>();

function publishSocketMessage(
  ws: ChatSocket,
  message: unknown,
) {
  ws.raw.send(JSON.stringify(message));
}

function detachChatSocket(
  ws: ChatSocket,
) {
  const unsubscribe = chatSocketSubscriptions.get(ws);
  if (!unsubscribe) {
    return;
  }

  unsubscribe();
  chatSocketSubscriptions.delete(ws);
}

function attachChatSocket(
  ws: ChatSocket,
  chatId: string,
) {
  detachChatSocket(ws);

  const unsubscribe = subscribeToChatRuntimeStream(chatId, (event) => {
    publishSocketMessage(ws, event);
  });

  if (!unsubscribe) {
    publishSocketMessage(ws, { type: "socket_missing" });
    return false;
  }

  chatSocketSubscriptions.set(ws, unsubscribe);
  publishSocketMessage(ws, { type: "socket_attached" });
  return true;
}

function isPersistablePiMessage(message: unknown): message is Message {
  if (!message || typeof message !== "object") {
    return false;
  }

  const role = (message as { role?: unknown }).role;
  return role === "user" || role === "assistant" || role === "toolResult";
}

function getIncomingUiMessageId(message: unknown) {
  if (!message || typeof message !== "object") {
    return null;
  }

  const id = (message as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

async function startChatRun(body: ChatStreamRequestBody): Promise<void> {
  const chat = await getChat(body.chatId);
  if (!chat) {
    throw new Error("Chat not found");
  }

  const projectRow = await getProject(chat.projectId);
  if (!projectRow) {
    throw new Error("Project not found for chat");
  }

  const chatConfig = normalizeStoredChatAgentConfig(chat);
  let projectPath = projectRow.path;

  if (chatConfig.branch) {
    const { workspaces } = await listWorkspaces(projectRow.path);
    const worktree = workspaces.find(
      (workspace) =>
        workspace.kind === "worktree" && workspace.name === chatConfig.branch,
    );
    if (worktree && worktree.kind === "worktree") {
      projectPath = worktree.path;
    }
  }

  const project: PiAgentSessionProject = {
    id: projectRow.id,
    path: projectPath,
    customInstructions: projectRow.customInstructions,
    appendPrompt: projectRow.appendPrompt,
  };

  const userMessage = await createUserMessageFromUnknown(body.message, body.prompt);
  if (!userMessage) {
    throw new Error("Missing user message");
  }

  const runtime = await getChatRuntime(body.chatId, {
    configKey: JSON.stringify({ project: project.id, ...chatConfig }),
  });

  try {
    const storedMessages = await deserializePiMessages(
      await getChatMessages(body.chatId),
    );
    const history = storedMessages.map((row) => row.parsedMessage);

    const triggerMessageId = getIncomingUiMessageId(body.message) ?? nanoid();
    if (storedMessages.some((message) => message.id === triggerMessageId)) {
      throw new Error(
        "Trigger message is already persisted. Trim chat history before starting a run.",
      );
    }

    await saveChatMessage(body.chatId, {
      id: triggerMessageId,
      message: serializePiMessage(userMessage),
    });

    // First message in this project triggers MCP spawn (cached afterwards).
    // Errors here are logged inside the manager and don't block the chat.
    await loadProjectMcps({
      projectId: project.id,
      projectPath: projectRow.path,
    });

    const { session, config } = await createPiAgentSession({
      config: chatConfig,
      project,
      customTools: getMcpToolsForProject(project.id),
    });

    session.agent.state.messages = [...history];

    const { stream } = startChatRuntimeStream(body.chatId, {
      abortCurrentRun: () => session.abort(),
    });

    // Preserve Pi extension tool-call hooks, then layer g-spot's permission
    // policy and approval gate on top. The hook runs async, so
    // `require-approval` can await a promise that resolves once the client
    // calls `chat.resolveToolApproval`. See `awaitChatToolApproval` in
    // `chat-runtime.ts`.
    const extensionBeforeToolCall = session.agent.beforeToolCall;
    session.agent.beforeToolCall = async (context) => {
      const extensionDecision = await extensionBeforeToolCall?.(context);
      if (extensionDecision?.block) {
        return extensionDecision;
      }

      const decision = decidePermission(
        context.toolCall.name,
        context.args,
        chatConfig,
      );

      if (decision.kind === "block") {
        return { block: true, reason: decision.reason };
      }

      if (decision.kind === "require-approval") {
        stream.publish({
          type: "tool_approval_request",
          toolCallId: context.toolCall.id,
          toolName: context.toolCall.name,
          args: context.args,
          reason: decision.reason,
        });

        const response = await awaitChatToolApproval(
          body.chatId,
          context.toolCall.id,
          { toolName: context.toolCall.name, args: context.args },
        );

        stream.publish({
          type: "tool_approval_resolved",
          toolCallId: context.toolCall.id,
          toolName: context.toolCall.name,
          approved: response.approved,
          reason: response.reason,
        });

        if (!response.approved) {
          return {
            block: true,
            reason: response.reason ?? "User denied this tool call.",
          };
        }
      }

      return extensionDecision;
    };

    const persistenceTasks: Promise<void>[] = [];

    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      stream.publish(event);

      if (event.type !== "message_end" || !isPersistablePiMessage(event.message)) {
        return;
      }

      if (event.message.role === "user") {
        return;
      }

      const rowId = nanoid();

      persistenceTasks.push(
        saveChatMessage(body.chatId, {
          id: rowId,
          message: serializePiMessage(event.message),
        }),
      );
    });

    void (async () => {
      try {
        await session.sendUserMessage(userMessage.content);
        await Promise.all(persistenceTasks);

        const finalMessages = session.messages.filter(isPersistablePiMessage);
        const isFirstUserTurn =
          finalMessages.filter((message) => message.role === "user").length === 1;

        if (triggerMessageId && isFirstUserTurn) {
          void refreshChatTitle({
            chatId: body.chatId,
            messages: finalMessages,
            fallbackConfig: config,
            triggerMessageId,
            project,
          });

          // Extract knowledge into memory graph (fire-and-forget)
          void extractChatTurnToMemory({
            chatId: body.chatId,
            messages: finalMessages,
          });
        }
      } catch (error) {
        stream.publish({
          type: "gspot_error",
          message: error instanceof Error ? error.message : "Chat stream failed",
        });
      } finally {
        stream.publish({
          type: "stream_finished",
        });
        unsubscribe();
        finishChatRuntimeStream(body.chatId);
      }
    })();
  } catch (error) {
    await runtime.abortCurrentRun?.();
    console.error("[pi.chat] failed", {
      chatId: body.chatId,
      error,
    });
    throw error;
  }
}

export async function handleChatStreamAbort(
  _request: Request,
  chatId: string,
): Promise<Response> {
  await abortChatRuntimeRun(chatId);
  return new Response(null, { status: 204 });
}

export function handleChatSocketOpen(_ws: ChatSocket) {}

export async function handleChatSocketMessage(
  ws: ChatSocket,
  rawMessage: unknown,
) {
  let message: ChatSocketClientMessage;
  const payload =
    typeof rawMessage === "string"
      ? rawMessage
      : Buffer.isBuffer(rawMessage)
        ? rawMessage.toString()
        : JSON.stringify(rawMessage);

  try {
    message = JSON.parse(payload) as ChatSocketClientMessage;
  } catch {
    publishSocketMessage(ws, {
      type: "gspot_error",
      message: "Invalid chat socket payload",
    });
    return;
  }

  const chatId = ws.data.params.chatId;

  if (message.type === "attach") {
    attachChatSocket(ws, chatId);
    return;
  }

  detachChatSocket(ws);

  try {
    await startChatRun({
      chatId,
      prompt: message.prompt,
      message: message.message,
    });
    attachChatSocket(ws, chatId);
  } catch (error) {
    publishSocketMessage(ws, {
      type: "gspot_error",
      message: error instanceof Error ? error.message : "Chat stream failed",
    });
  }
}

export function handleChatSocketClose(
  ws: ChatSocket,
) {
  detachChatSocket(ws);
}

export function handleChatStatusSocketOpen(ws: ChatStatusSocket) {
  const unsubscribe = subscribeToChatRuntimeStatuses((statuses) => {
    ws.raw.send(JSON.stringify({
      type: "runtime_statuses",
      statuses,
    }));
  });

  chatStatusSocketSubscriptions.set(ws, unsubscribe);
}

export function handleChatStatusSocketMessage(
  _ws: ChatStatusSocket,
  rawMessage: unknown,
) {
  const payload =
    typeof rawMessage === "string"
      ? rawMessage
      : Buffer.isBuffer(rawMessage)
        ? rawMessage.toString()
        : JSON.stringify(rawMessage);

  let message: ChatStatusSocketClientMessage;
  try {
    message = JSON.parse(payload) as ChatStatusSocketClientMessage;
  } catch {
    return;
  }

  if (
    message.type === "mark_read" &&
    typeof message.chatId === "string" &&
    message.chatId.length > 0
  ) {
    markChatRuntimeRead(message.chatId);
  }
}

export function handleChatStatusSocketClose(ws: ChatStatusSocket) {
  const unsubscribe = chatStatusSocketSubscriptions.get(ws);
  if (!unsubscribe) {
    return;
  }

  unsubscribe();
  chatStatusSocketSubscriptions.delete(ws);
}
