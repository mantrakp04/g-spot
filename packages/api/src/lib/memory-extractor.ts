/**
 * Agent-powered memory extraction from conversation transcripts and email threads.
 *
 * Instead of prompting an LLM to "respond with JSON" and parsing, this module
 * creates a Pi worker session WITH memory tools. The agent autonomously calls
 * memory_search, memory_add_entity, memory_add_observation, etc. Tool call
 * schemas enforce structure, so no fragile JSON parsing is needed.
 */

import {
  createPiAgentSession,
  getPiAgentDefaults,
  normalizePiAgentConfig,
} from "./pi";
import { createMemoryTools } from "./memory-tools";

// ---------------------------------------------------------------------------
// System prompt for the memory extraction agent
// ---------------------------------------------------------------------------

const MEMORY_AGENT_SYSTEM_PROMPT = `You are a memory extraction agent. You have been given a conversation transcript (or email thread). Your job is to:

1. SEARCH existing memory first to understand what is already known
2. EXTRACT new entities (people, organizations, projects, concepts, tools)
3. EXTRACT new observations (facts, events, preferences, decisions)
4. CREATE edges between related entities
5. UPDATE or DELETE observations that are now outdated
6. UPDATE the scratchpad with current context

IMPORTANT RULES:
- Always search before adding — avoid duplicates
- Be selective — only extract information worth remembering long-term
- Skip signatures, disclaimers, marketing content, boilerplate
- Entity names should be normalized (e.g., "John Smith" not "john")
- Observations should be self-contained (no dangling pronouns)
- When you find conflicting info, update the old observation and explain why
- Do NOT produce any final text output — just use the tools to write to memory

WORKFLOW:
1. Start with memory_search using key terms from the content
2. Read relevant scratchpad blocks (user_profile, active_context)
3. Create entities for any new people, organizations, projects, etc.
4. Add observations for important facts, events, preferences, decisions
5. Add edges to connect related entities
6. If you find outdated observations, update or delete them
7. Update active_context scratchpad with a summary of what you learned`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract knowledge from a transcript and ingest it into the memory graph
 * using an autonomous agent session with memory tools.
 *
 * The agent will search existing memory, create entities, add observations,
 * build edges, and update the scratchpad — all via structured tool calls.
 */
export async function extractAndIngestThread(
  userId: string,
  threadContent: string,
  _sourceMessageId?: string,
): Promise<void> {
  const memoryTools = createMemoryTools(userId);
  const defaults = await getPiAgentDefaults(userId);
  const workerConfig = normalizePiAgentConfig(defaults.worker);

  const { session } = await createPiAgentSession({
    userId,
    config: workerConfig,
    activeToolNames: [],
    disableProjectResources: true,
    customTools: memoryTools,
  });

  const prompt = [
    MEMORY_AGENT_SYSTEM_PROMPT,
    "",
    "--- CONTENT TO EXTRACT FROM ---",
    threadContent,
    "--- END ---",
    "",
    "Begin by searching memory for key terms from the content above, then extract and store relevant knowledge using the available tools.",
  ].join("\n");

  await session.prompt(prompt);
}
