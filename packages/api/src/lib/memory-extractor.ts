/**
 * LLM-powered memory extraction from email threads.
 *
 * Uses the Pi worker session pattern (same as chat-title.ts):
 * create session with no tools, call session.prompt(), parse response.
 */

import type { Message } from "@mariozechner/pi-ai";

import {
  createPiAgentSession,
  extractAssistantText,
  getPiAgentDefaults,
  normalizePiAgentConfig,
} from "./pi";
import {
  ingest,
  query,
  type ExtractionResult,
  type ResolveAction,
} from "./memory";

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const EXTRACTION_PROMPT = `You are a memory extraction agent. Given an email thread, extract structured knowledge.

Extract:
1. **Entities**: people, organizations, projects, concepts, tools mentioned
2. **Observations**: key facts, events, preferences, decisions, agreements, deadlines, action items
3. **Edges**: relationships between entities (e.g. "Alice -> works_at -> Acme Corp")

Rules:
- Focus on information useful for future reference
- Skip signatures, legal disclaimers, marketing content, auto-generated footers
- For people: extract full names when available, use email username as fallback
- For observations: be specific and self-contained (don't use pronouns without referents)
- Entity names should be normalized (e.g. "John Smith" not "john" or "Smith, John")

Respond with ONLY valid JSON matching this exact schema:
{
  "entities": [
    { "name": "string", "entityType": "person|organization|project|concept|tool|event|preference", "description": "string", "aliases": ["string"] }
  ],
  "observations": [
    { "content": "string", "observationType": "fact|event|preference|belief|procedure|reflection", "entityNames": ["string"] }
  ],
  "edges": [
    { "sourceName": "string", "targetName": "string", "relationshipType": "string", "description": "string" }
  ]
}

If there is nothing meaningful to extract, return: {"entities":[],"observations":[],"edges":[]}`;

const RESOLUTION_PROMPT = `You are a memory conflict resolver. Given newly extracted knowledge and existing memory entries, decide what to do with each new observation.

For each new observation (by index), choose:
- **ADD**: This is genuinely new information not already in memory
- **UPDATE**: This refines or supersedes an existing entry (provide existingId)
- **DELETE**: This contradicts and invalidates an existing entry (provide existingId)
- **NONE**: This is already known and unchanged (skip it)

Prefer ADD for new information. Prefer NONE if the observation is semantically equivalent to an existing one.
Only use UPDATE if the new observation is strictly more specific or more recent than the existing one.
Only use DELETE if there is a clear contradiction.

Existing memory entries:
{EXISTING}

New extractions to resolve:
{NEW}

Respond with ONLY a valid JSON array:
[{"index": 0, "action": "ADD|UPDATE|DELETE|NONE", "existingId": "optional-id", "reason": "brief explanation"}]`;

// ---------------------------------------------------------------------------
// LLM call helpers
// ---------------------------------------------------------------------------

async function callWorkerLLM(
  userId: string,
  prompt: string,
): Promise<string> {
  const defaults = await getPiAgentDefaults(userId);
  const workerConfig = normalizePiAgentConfig(defaults.worker);

  const { session } = await createPiAgentSession({
    userId,
    config: workerConfig,
    activeToolNames: [],
    disableProjectResources: true,
  });

  await session.prompt(prompt);

  const assistantMessage = [...session.messages]
    .reverse()
    .find((m): m is Message => m.role === "assistant");

  if (!assistantMessage) {
    throw new Error("No assistant response from worker LLM");
  }

  return extractAssistantText(assistantMessage);
}

function parseJsonResponse<T>(text: string): T {
  // Strip markdown code fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  return JSON.parse(cleaned) as T;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * LLM Call 1: Extract entities, observations, and edges from email thread content.
 */
export async function extractFromThread(
  userId: string,
  threadContent: string,
): Promise<ExtractionResult> {
  const prompt = [
    EXTRACTION_PROMPT,
    "",
    "--- EMAIL THREAD ---",
    threadContent,
    "--- END ---",
  ].join("\n");

  const response = await callWorkerLLM(userId, prompt);
  return parseJsonResponse<ExtractionResult>(response);
}

/**
 * LLM Call 2: Resolve conflicts between new extractions and existing memory.
 * If there are no existing memories to conflict with, returns ADD for everything.
 */
export async function resolveConflicts(
  userId: string,
  extraction: ExtractionResult,
): Promise<ResolveAction[]> {
  // Quick path: if no observations, nothing to resolve
  if (extraction.observations.length === 0) {
    return [];
  }

  // Query existing memory for potential conflicts
  const queryTexts = extraction.observations.map((o) => o.content);
  const existingResults = await Promise.all(
    queryTexts.slice(0, 5).map((q) =>
      query(q, { userId, topK: 3, threshold: 0.6, includeGraph: false, includeScratchpad: false }),
    ),
  );

  // Collect unique existing observations
  const existingObs = new Map<string, { id: string; content: string }>();
  for (const result of existingResults) {
    for (const obs of result.observations) {
      existingObs.set(obs.id, { id: obs.id, content: obs.content });
    }
  }

  // If no existing memories, ADD everything
  if (existingObs.size === 0) {
    return extraction.observations.map((_, index) => ({
      index,
      action: "ADD" as const,
      reason: "No existing memories to conflict with",
    }));
  }

  // Build context for the LLM
  const existingContext = Array.from(existingObs.values())
    .map((o) => `[${o.id}] ${o.content}`)
    .join("\n");

  const newContext = extraction.observations
    .map((o, i) => `[${i}] ${o.content}`)
    .join("\n");

  const prompt = RESOLUTION_PROMPT
    .replace("{EXISTING}", existingContext)
    .replace("{NEW}", newContext);

  const response = await callWorkerLLM(userId, prompt);
  const resolutions = parseJsonResponse<ResolveAction[]>(response);

  // Ensure every observation has a resolution (default to ADD if missing)
  const resolvedIndices = new Set(resolutions.map((r) => r.index));
  for (let i = 0; i < extraction.observations.length; i++) {
    if (!resolvedIndices.has(i)) {
      resolutions.push({
        index: i,
        action: "ADD",
        reason: "No resolution provided by LLM, defaulting to ADD",
      });
    }
  }

  return resolutions;
}

/**
 * Combined pipeline: extract → resolve → ingest.
 * Returns the IDs of ingested entities, observations, and edges.
 */
export async function extractAndIngestThread(
  userId: string,
  threadContent: string,
  sourceMessageId?: string,
): Promise<{
  entityIds: string[];
  observationIds: string[];
  edgeIds: string[];
}> {
  const extraction = await extractFromThread(userId, threadContent);

  // Short-circuit: nothing to ingest
  if (
    extraction.entities.length === 0 &&
    extraction.observations.length === 0 &&
    extraction.edges.length === 0
  ) {
    return { entityIds: [], observationIds: [], edgeIds: [] };
  }

  const resolutions = await resolveConflicts(userId, extraction);
  return ingest(userId, extraction, resolutions, sourceMessageId);
}
