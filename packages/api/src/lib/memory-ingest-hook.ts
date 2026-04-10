/**
 * Hook that runs after each chat turn to extract knowledge into memory.
 *
 * Follows the same fire-and-forget pattern as refreshChatTitle — called
 * with `void` so it doesn't block the chat stream response.
 */

import type { Message } from "@mariozechner/pi-ai";

import { extractAssistantText } from "./pi";
import { extractAndIngestThread } from "./memory-extractor";
import { ensureDefaultBlocks, scratchpadRewrite } from "./memory";
import { scheduleDecayTick, registerUserForDecay } from "./memory-cron";

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
 * 2. Runs the 2-call LLM extraction pipeline (extract → resolve → ingest)
 * 3. Optionally updates the scratchpad active_context block
 * 4. Schedules a decay tick (throttled to once per hour)
 */
export async function extractChatTurnToMemory(args: {
  userId: string;
  chatId: string;
  messages: Message[];
}): Promise<void> {
  try {
    const transcript = buildTranscript(args.messages);
    if (!transcript || transcript.length < 20) return;

    // Register user for background decay and schedule a tick
    registerUserForDecay(args.userId);
    scheduleDecayTick(args.userId);

    // Extract and ingest
    const result = await extractAndIngestThread(
      args.userId,
      transcript,
      args.chatId,
    );

    if (
      result.entityIds.length > 0 ||
      result.observationIds.length > 0
    ) {
      // Update the active_context scratchpad block with what user is doing
      try {
        ensureDefaultBlocks(args.userId);
        const lastUserMsg = [...args.messages]
          .reverse()
          .find((m) => m.role === "user");

        if (lastUserMsg) {
          const content = lastUserMsg.content;
          const userText = (
            typeof content === "string"
              ? content
              : Array.isArray(content)
                ? content
                    .flatMap((part: any) => (part.type === "text" ? [part.text] : []))
                    .join(" ")
                : ""
          ).slice(0, 200);

          if (userText) {
            scratchpadRewrite(
              args.userId,
              "active_context",
              `Last activity: ${userText}\nChat: ${args.chatId}`,
              "system",
            );
          }
        }
      } catch {
        // Scratchpad update is best-effort
      }
    }
  } catch (error) {
    console.error("[memory-ingest-hook] Failed:", error);
  }
}
