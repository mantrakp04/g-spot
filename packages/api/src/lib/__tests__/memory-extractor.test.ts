import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Pi agent system
vi.mock("../pi", () => ({
  getPiAgentDefaults: vi.fn().mockResolvedValue({
    worker: {
      provider: "test",
      modelId: "test-model",
      thinkingLevel: "off",
      transport: "sse",
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
      activeToolNames: [],
      sandboxMode: "read-only",
      networkAccess: "off",
      approvalPolicy: "auto",
    },
  }),
  normalizePiAgentConfig: vi.fn((config: any) => config),
  createPiAgentSession: vi.fn(),
  extractAssistantText: vi.fn(),
}));

// Mock the memory system
vi.mock("../memory", () => ({
  ingest: vi.fn().mockResolvedValue({
    entityIds: ["e1"],
    observationIds: ["o1"],
    edgeIds: ["ed1"],
  }),
  query: vi.fn().mockResolvedValue({
    observations: [],
    triplets: [],
    graphContext: "",
    scratchpad: "",
    timingMs: 10,
  }),
}));

import { createPiAgentSession, extractAssistantText } from "../pi";
import { ingest, query } from "../memory";
import { extractFromThread, resolveConflicts, extractAndIngestThread } from "../memory-extractor";

const mockCreateSession = createPiAgentSession as ReturnType<typeof vi.fn>;
const mockExtractText = extractAssistantText as ReturnType<typeof vi.fn>;
const mockIngest = ingest as ReturnType<typeof vi.fn>;

function mockSessionResponse(responseText: string) {
  const messages = [
    { role: "assistant", content: [{ type: "text", text: responseText }] },
  ];
  mockCreateSession.mockResolvedValue({
    session: {
      prompt: vi.fn(),
      messages,
    },
  });
  mockExtractText.mockReturnValue(responseText);
}

describe("extractFromThread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts entities, observations, and edges from thread content", async () => {
    const extraction = {
      entities: [
        { name: "Alice", entityType: "person", description: "A developer", aliases: [] },
      ],
      observations: [
        { content: "Alice is working on the API", observationType: "fact", entityNames: ["Alice"] },
      ],
      edges: [
        { sourceName: "Alice", targetName: "API", relationshipType: "works_on", description: "Alice works on the API" },
      ],
    };

    mockSessionResponse(JSON.stringify(extraction));

    const result = await extractFromThread("user1", "Email about Alice working on API");

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]!.name).toBe("Alice");
    expect(result.observations).toHaveLength(1);
    expect(result.edges).toHaveLength(1);
  });

  it("handles markdown-wrapped JSON response", async () => {
    const extraction = { entities: [], observations: [], edges: [] };
    mockSessionResponse("```json\n" + JSON.stringify(extraction) + "\n```");

    const result = await extractFromThread("user1", "Some email");
    expect(result.entities).toHaveLength(0);
  });

  it("throws on invalid JSON response", async () => {
    mockSessionResponse("This is not JSON at all");

    await expect(extractFromThread("user1", "Some email")).rejects.toThrow();
  });
});

describe("resolveConflicts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ADD for all observations when no existing memory", async () => {
    const extraction = {
      entities: [],
      observations: [
        { content: "New fact 1", observationType: "fact" as const, entityNames: [] },
        { content: "New fact 2", observationType: "fact" as const, entityNames: [] },
      ],
      edges: [],
    };

    const resolutions = await resolveConflicts("user1", extraction);

    expect(resolutions).toHaveLength(2);
    expect(resolutions[0]!.action).toBe("ADD");
    expect(resolutions[1]!.action).toBe("ADD");
  });

  it("returns empty array for empty observations", async () => {
    const extraction = { entities: [], observations: [], edges: [] };
    const resolutions = await resolveConflicts("user1", extraction);
    expect(resolutions).toHaveLength(0);
  });
});

describe("extractAndIngestThread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("short-circuits on empty extraction", async () => {
    const empty = { entities: [], observations: [], edges: [] };
    mockSessionResponse(JSON.stringify(empty));

    const result = await extractAndIngestThread("user1", "Boring email");

    expect(result.entityIds).toHaveLength(0);
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it("extracts, resolves, and ingests for non-empty content", async () => {
    const extraction = {
      entities: [{ name: "Bob", entityType: "person", description: "An engineer" }],
      observations: [{ content: "Bob joined the team", observationType: "event", entityNames: ["Bob"] }],
      edges: [],
    };

    // First call returns extraction, second call returns empty (no conflicts)
    let callCount = 0;
    mockCreateSession.mockImplementation(async () => {
      callCount++;
      const text =
        callCount === 1
          ? JSON.stringify(extraction)
          : "[]"; // empty resolution — but resolveConflicts will ADD everything since query returns empty
      return {
        session: {
          prompt: vi.fn(),
          messages: [
            { role: "assistant", content: [{ type: "text", text }] },
          ],
        },
      };
    });
    mockExtractText.mockImplementation((msg: any) => {
      return msg.content[0].text;
    });

    const result = await extractAndIngestThread("user1", "Bob joined the team email");

    expect(mockIngest).toHaveBeenCalledOnce();
    expect(result.entityIds).toEqual(["e1"]);
  });
});
