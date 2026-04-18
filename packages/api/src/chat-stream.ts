import { getChat, getChatMessages, saveChatMessage } from "@g-spot/db/chat";
import { getProject } from "@g-spot/db/projects";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { Message } from "@mariozechner/pi-ai";
import { nanoid } from "nanoid";

import {
  abortChatRuntimeRun,
  awaitChatToolApproval,
  finishChatRuntimeStream,
  getChatRuntime,
  startChatRuntimeStream,
  subscribeToChatRuntimeStream,
} from "./chat-runtime";
import { refreshChatTitle } from "./chat-title";
import { extractChatTurnToMemory } from "./lib/memory-ingest-hook";
import { ensureWorktree } from "./lib/git";
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

const chatSocketSubscriptions = new WeakMap<
  ChatSocket,
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

/**
 * Compare two user messages by their content. Used to detect that the
 * incoming user message is the trigger row that the client just persisted
 * via `chat.replaceMessages` (regenerate / edit flow). Timestamps differ
 * between calls so we ignore them and only compare role + content.
 */
function userMessageContentMatches(
  stored: Message,
  incoming: Message,
): boolean {
  if (stored.role !== "user" || incoming.role !== "user") {
    return false;
  }

  return JSON.stringify(stored.content) === JSON.stringify(incoming.content);
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

  if (chatConfig.workMode === "worktree") {
    try {
      const worktreePath = await ensureWorktree({
        projectPath: projectRow.path,
        chatId: body.chatId,
        branch: chatConfig.branch,
      });

      if (worktreePath) {
        projectPath = worktreePath;
      }
    } catch (error) {
      const { stream } = startChatRuntimeStream(body.chatId, {
        abortCurrentRun: () => undefined,
      });

      stream.publish({
        type: "gspot_error",
        message:
          error instanceof Error
            ? `Could not create worktree: ${error.message}`
            : "Could not create worktree.",
      });
      finishChatRuntimeStream(body.chatId);
      return;
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

    // Regenerate / edit flow: the client persists the truncated history
    // (including the trigger user message) via `chat.replaceMessages` and
    // then re-sends that user message via this stream. If we don't dedupe
    // here, we'd both add it to the agent's in-memory history a second time
    // and persist it as a brand-new row, leaving a duplicate user bubble in
    // the chat. Detect that case by comparing the last persisted message
    // against the incoming user message — when they match, drop it from the
    // in-memory history (so `sendUserMessage` is the single source) and
    // remember the existing row id so the persistence subscriber can reuse
    // it instead of inserting a duplicate.
    let preExistingTriggerRowId: string | null = null;
    if (storedMessages.length > 0) {
      const lastStored = storedMessages[storedMessages.length - 1]!;
      if (userMessageContentMatches(lastStored.parsedMessage, userMessage)) {
        history.pop();
        preExistingTriggerRowId = lastStored.id;
      }
    }

    const { session, config } = await createPiAgentSession({
      config: chatConfig,
      project,
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
    let triggerMessageId: string | null = null;

    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      stream.publish(event);

      if (event.type !== "message_end" || !isPersistablePiMessage(event.message)) {
        return;
      }

      // First user message_end is the trigger. If the row already exists in
      // DB (regenerate / edit dedupe above), reuse its id and skip the
      // duplicate insert; otherwise create a fresh row id like normal.
      if (
        event.message.role === "user" &&
        triggerMessageId === null &&
        preExistingTriggerRowId !== null
      ) {
        triggerMessageId = preExistingTriggerRowId;
        preExistingTriggerRowId = null;
        return;
      }

      const rowId = nanoid();
      if (event.message.role === "user" && triggerMessageId === null) {
        triggerMessageId = rowId;
      }

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
        if (triggerMessageId) {
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

export async function handleChatStream(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as ChatStreamRequestBody;
    await startChatRun(body);
    return new Response(null, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stream failed";
    const status =
      message === "Missing user message"
        ? 400
        : message === "Chat not found"
          ? 404
          : 502;

    return new Response(
      JSON.stringify({ error: message }),
      {
        status,
        headers: { "content-type": "application/json" },
      },
    );
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
