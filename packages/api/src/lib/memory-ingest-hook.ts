/**
 * Hook that runs after each chat turn to extract knowledge into memory.
 *
 * Follows the same fire-and-forget pattern as refreshChatTitle — called
 * with `void` so it doesn't block the chat stream response.
 */

import type { Message } from "@mariozechner/pi-ai";

import { extractAssistantText } from "./pi";
import { extractAndIngestThread } from "./memory-extractor";
import { scheduleDecayTick, registerUserForDecay } from "./memory-cron";

/** Single-tenant key for memory decay when Stack user ids are not used server-side. */
const LOCAL_MEMORY_USER_ID = "local";

/**
 * Build a text transcript from the last N messages for memory extraction.
 */
function buildTranscript(messages: Message[], maxMessages = 6): string {
  const recent = messages.slice(-maxMessages);
  const lines: string[] = [];

  for (const msg of recent) {
    if (msg.role === "user") {
      const content = msg.content;
      const text = typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .flatMap((part: any) => (part.type === "text" ? [part.text] : []))
              .join("\n")
          : "";
      if (text) lines.push(`User: ${text}`);
    } else if (msg.role === "assistant") {
      const text = extractAssistantText(msg);
      if (text) lines.push(`Assistant: ${text}`);
    }
  }

  return lines.join("\n\n");
}

/**
 * Extract knowledge from a completed chat turn and ingest into memory.
 *
 * Call as: `void extractChatTurnToMemory({ ... })`
 *
 * This:
 * 1. Builds a transcript from the last few messages
 * 2. Runs the agent-based extraction pipeline (agent uses tools autonomously)
 * 3. Schedules a decay tick (throttled to once per hour)
 *
 * The agent handles scratchpad updates internally via its memory tools,
 * so there is no separate scratchpad update step here.
 */
export async function extractChatTurnToMemory(args: {
  chatId: string;
  messages: Message[];
}): Promise<void> {
  try {
    const transcript = buildTranscript(args.messages);
    if (!transcript || transcript.length < 20) return;

    // Register user for background decay and schedule a tick
    registerUserForDecay(LOCAL_MEMORY_USER_ID);
    scheduleDecayTick(LOCAL_MEMORY_USER_ID);

    // Extract and ingest — the agent handles everything via tools
    await extractAndIngestThread(transcript, args.chatId);
  } catch (error) {
    console.error("[memory-ingest-hook] Failed:", error);
  }
}
