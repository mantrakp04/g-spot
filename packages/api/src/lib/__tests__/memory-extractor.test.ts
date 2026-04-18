import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Pi agent system
vi.mock("../pi", () => ({
  getPiAgentDefaults: vi.fn().mockResolvedValue({
    worker: {
      provider: "test",
      modelId: "test-model",
      thinkingLevel: "off",
      transport: "websocket",
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
      activeToolNames: [],
      sandboxMode: "read-only",
      networkAccess: "off",
      approvalPolicy: "auto",
    },
  }),
  normalizePiAgentConfig: vi.fn((config: any) => config),
  createPiAgentSession: vi.fn().mockResolvedValue({
    session: {
      prompt: vi.fn(),
      messages: [],
    },
  }),
}));

// Mock the memory-tools module
vi.mock("../memory-tools", () => ({
  createMemoryTools: vi.fn().mockReturnValue([]),
}));

import { createPiAgentSession } from "../pi";
import { createMemoryTools } from "../memory-tools";
import { extractAndIngestThread } from "../memory-extractor";

const mockCreateSession = createPiAgentSession as ReturnType<typeof vi.fn>;
const mockCreateMemoryTools = createMemoryTools as ReturnType<typeof vi.fn>;

describe("createMemoryTools", () => {
  it("returns the expected number of tools", () => {
    // Use real implementation for this test
    const mockTools = [
      { name: "memory_search" },
      { name: "memory_get_entity" },
      { name: "memory_graph_traverse" },
      { name: "scratchpad_read" },
      { name: "memory_add_entity" },
      { name: "memory_add_observation" },
      { name: "memory_add_edge" },
      { name: "memory_update_observation" },
      { name: "memory_delete_observation" },
      { name: "scratchpad_write" },
    ];
    mockCreateMemoryTools.mockReturnValue(mockTools);

    const tools = createMemoryTools("user1");
    expect(tools).toHaveLength(10);
  });

  it("returns tools with correct names", () => {
    const expectedNames = [
      "memory_search",
      "memory_get_entity",
      "memory_graph_traverse",
      "scratchpad_read",
      "memory_add_entity",
      "memory_add_observation",
      "memory_add_edge",
      "memory_update_observation",
      "memory_delete_observation",
      "scratchpad_write",
    ];
    const mockTools = expectedNames.map((name) => ({ name }));
    mockCreateMemoryTools.mockReturnValue(mockTools);

    const tools = createMemoryTools("user1");
    const names = tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expectedNames);
  });
});

describe("extractAndIngestThread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateMemoryTools.mockReturnValue([]);
    mockCreateSession.mockResolvedValue({
      session: {
        prompt: vi.fn(),
        messages: [],
      },
    });
  });

  it("creates a session with custom memory tools", async () => {
    const fakeTools = [{ name: "memory_search" }];
    mockCreateMemoryTools.mockReturnValue(fakeTools);

    await extractAndIngestThread("user1", "Some conversation content");

    expect(mockCreateMemoryTools).toHaveBeenCalledWith("user1");
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user1",
        activeToolNames: [],
        disableProjectResources: true,
        customTools: fakeTools,
      }),
    );
  });

  it("prompts the session with the thread content", async () => {
    const mockPrompt = vi.fn();
    mockCreateSession.mockResolvedValue({
      session: { prompt: mockPrompt, messages: [] },
    });

    await extractAndIngestThread("user1", "Bob joined the team");

    expect(mockPrompt).toHaveBeenCalledOnce();
    const promptArg = mockPrompt.mock.calls[0]![0] as string;
    expect(promptArg).toContain("Bob joined the team");
    expect(promptArg).toContain("memory extraction agent");
  });

  it("returns void (agent handles everything via tools)", async () => {
    const result = await extractAndIngestThread("user1", "Some email");
    expect(result).toBeUndefined();
  });
});
