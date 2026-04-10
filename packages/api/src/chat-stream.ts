import { getChat, getChatMessages, saveChatMessage } from "@g-spot/db/chat";
import { getProject } from "@g-spot/db/projects";
import { listSkillsForAgent } from "@g-spot/db/skills";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { Message } from "@mariozechner/pi-ai";
import { nanoid } from "nanoid";

import {
  abortChatRuntimeRun,
  awaitChatToolApproval,
  finishChatRuntimeStream,
  getChatRuntime,
  getChatRuntimeReconnectStream,
  startChatRuntimeStream,
} from "./chat-runtime";
import { refreshChatTitle } from "./chat-title";
import { extractChatTurnToMemory } from "./lib/memory-ingest-hook";
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
import {
  disposeSkillsRoot,
  materializeSkills,
} from "./lib/skill-materializer";
import { verifyStackToken } from "./lib/verify-token";

type ChatStreamRequestBody = {
  chatId: string;
  prompt?: string;
  message?: unknown;
};

function sseResponse(stream: ReadableStream<Uint8Array>) {
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

async function authenticateChatRequest(request: Request) {
  const accessToken = request.headers.get("x-stack-access-token");
  if (!accessToken) {
    return null;
  }

  return verifyStackToken(accessToken);
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

export async function handleChatStream(request: Request): Promise<Response> {
  const userId = await authenticateChatRequest(request);
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as ChatStreamRequestBody;
  const chat = await getChat(userId, body.chatId);
  if (!chat) {
    return new Response("Chat not found", { status: 404 });
  }

  const projectRow = await getProject(userId, chat.projectId);
  if (!projectRow) {
    return new Response("Project not found for chat", { status: 500 });
  }

  const project: PiAgentSessionProject = {
    id: projectRow.id,
    path: projectRow.path,
    customInstructions: projectRow.customInstructions,
    appendPrompt: projectRow.appendPrompt,
  };

  const chatConfig = normalizeStoredChatAgentConfig(chat);

  const userMessage = await createUserMessageFromUnknown(body.message, body.prompt);
  if (!userMessage) {
    return new Response("Missing user message", { status: 400 });
  }

  const runtime = await getChatRuntime(body.chatId, {
    userId,
    configKey: JSON.stringify({ project: project.id, ...chatConfig }),
  });

  let skillsRoot: string | null = null;

  try {
    const skillRecords = await listSkillsForAgent(userId, project.id);
    const materialized = await materializeSkills(project.id, skillRecords);
    skillsRoot = materialized.skillsRoot;

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
      userId,
      config: chatConfig,
      project,
      materializedSkills: materialized.skills,
    });

    session.agent.state.messages = [...history];

    const { stream, readable } = startChatRuntimeStream(body.chatId, {
      abortCurrentRun: () => session.abort(),
    });

    // Install the permission / approval hook. `session.agent.beforeToolCall`
    // was already set to an extension-runner bridge by `AgentSession`, but
    // since we run with `noExtensions`, that bridge is a no-op — so
    // overwriting it here is safe and the cleanest way to inject policy.
    //
    // The hook runs async, so `require-approval` can await a promise that
    // resolves once the client calls `chat.resolveToolApproval`. See
    // `awaitChatToolApproval` in `chat-runtime.ts`.
    session.agent.beforeToolCall = async ({ toolCall, args }) => {
      const decision = decidePermission(
        toolCall.name,
        args,
        chatConfig,
      );

      if (decision.kind === "block") {
        return { block: true, reason: decision.reason };
      }

      if (decision.kind === "require-approval") {
        stream.publish({
          type: "tool_approval_request",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          args,
          reason: decision.reason,
        });

        const response = await awaitChatToolApproval(
          body.chatId,
          toolCall.id,
          { toolName: toolCall.name, args },
        );

        stream.publish({
          type: "tool_approval_resolved",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
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

      return undefined;
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
            userId,
            chatId: body.chatId,
            messages: finalMessages,
            fallbackConfig: config,
            triggerMessageId,
            project,
          });

          // Extract knowledge into memory graph (fire-and-forget)
          void extractChatTurnToMemory({
            userId,
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
        void disposeSkillsRoot(skillsRoot);
      }
    })();

    return sseResponse(readable);
  } catch (error) {
    await runtime.abortCurrentRun?.();
    void disposeSkillsRoot(skillsRoot);
    console.error("[pi.chat] failed", {
      chatId: body.chatId,
      userId,
      error,
    });

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Stream failed",
      }),
      {
        status: 502,
        headers: { "content-type": "application/json" },
      },
    );
  }
}

export async function handleChatStreamReconnect(
  request: Request,
  chatId: string,
): Promise<Response> {
  const userId = await authenticateChatRequest(request);
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const stream = getChatRuntimeReconnectStream(chatId, userId);
  if (!stream) {
    return new Response(null, { status: 204 });
  }

  return sseResponse(stream);
}

export async function handleChatStreamAbort(
  request: Request,
  chatId: string,
): Promise<Response> {
  const userId = await authenticateChatRequest(request);
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  await abortChatRuntimeRun(chatId, userId);
  return new Response(null, { status: 204 });
}
