import { getChat, getLatestUserChatMessageId, updateChatTitle } from "@g-spot/db/chat";
import type { Message } from "@mariozechner/pi-ai";

import {
  createPiAgentSession,
  extractAssistantText,
  getPiAgentDefaults,
  normalizePiAgentConfig,
  type PiAgentSessionProject,
} from "./lib/pi";

function extractTranscriptText(messages: Message[]) {
  return messages
    .map((message) => {
      if (message.role !== "user" && message.role !== "assistant") {
        return null;
      }

      const text =
        typeof message.content === "string"
          ? message.content.trim()
          : message.content
              .flatMap((part: (typeof message.content)[number]) => {
                if (part.type === "text") {
                  return [part.text.trim()];
                }

                if (part.type === "thinking") {
                  return [];
                }

                if (part.type === "toolCall") {
                  return [];
                }

                return ["[image]"];
              })
              .filter(Boolean)
              .join("\n");

      return text ? `${message.role}: ${text}` : null;
    })
    .filter(Boolean)
    .slice(-12)
    .join("\n\n");
}

function sanitizeGeneratedTitle(text: string) {
  return text
    .split("\n")[0]
    ?.trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getStableLatestUserMessageId(
  chatId: string,
  expectedMessageId: string,
) {
  let latestUserMessageId: string | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    latestUserMessageId = await getLatestUserChatMessageId(chatId);

    if (
      latestUserMessageId === null ||
      latestUserMessageId === expectedMessageId
    ) {
      return latestUserMessageId;
    }

    await sleep(75 * (attempt + 1));
  }

  return latestUserMessageId;
}

export async function refreshChatTitle(args: {
  userId: string;
  chatId: string;
  messages: Message[];
  fallbackConfig?: unknown;
  triggerMessageId: string;
  /**
   * Project the parent chat belongs to. Threaded through so the title worker
   * can reuse the same `cwd` (for consistency) without paying for project
   * resource discovery — see `disableProjectResources` below.
   */
  project?: PiAgentSessionProject;
}) {
  const triggerMessage = [...args.messages].reverse().find((message) => message.role === "user");
  if (!triggerMessage) {
    return;
  }

  try {
    const chat = await getChat(args.userId, args.chatId);
    if (!chat) {
      return;
    }

    const transcript = extractTranscriptText(args.messages);
    if (!transcript) {
      return;
    }

    const defaults = await getPiAgentDefaults(args.userId);
    const workerConfig = normalizePiAgentConfig(
      defaults.worker,
      normalizePiAgentConfig(args.fallbackConfig),
    );

    const { session } = await createPiAgentSession({
      userId: args.userId,
      config: workerConfig,
      activeToolNames: [],
      project: args.project,
      // Title generation runs hot for every first turn — skip on-disk
      // discovery so we don't rescan the project on every chat.
      disableProjectResources: true,
    });

    await session.prompt(
      [
        "Generate a short chat title.",
        "Respond with title text only.",
        "Use sentence case.",
        "Keep it under 8 words.",
        "",
        "Transcript:",
        transcript,
      ].join("\n"),
    );

    const assistantMessage = [...session.messages]
      .reverse()
      .find((message): message is Message => message.role === "assistant");
    if (!assistantMessage) {
      return;
    }

    const title = sanitizeGeneratedTitle(extractAssistantText(assistantMessage));
    if (!title) {
      return;
    }

    const latestUserMessageId = await getStableLatestUserMessageId(
      args.chatId,
      args.triggerMessageId,
    );
    if (
      latestUserMessageId !== null &&
      latestUserMessageId !== args.triggerMessageId
    ) {
      return;
    }

    if (title !== chat.title) {
      await updateChatTitle(args.userId, args.chatId, title);
    }
  } catch (error) {
    console.error("[chat.title] failed", {
      chatId: args.chatId,
      error,
    });
  }
}
