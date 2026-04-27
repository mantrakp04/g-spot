/**
 * In-memory MCP server registry.
 *
 *  - One global config (`~/.g-spot/mcp.json`) loaded once on server boot. Edits
 *    require an explicit reload (file-watching is intentionally out-of-scope
 *    for the first cut — keeps lifecycle predictable).
 *  - Per-project configs (`<project.path>/.mcp.json`) loaded lazily the first
 *    time a chat in that project sends a message. Stays resident until the
 *    server restarts, the file is reloaded, or the entry is marked
 *    `disabled: true`.
 *
 * The agent never sees a partially-initialised server: tools are only surfaced
 * after the MCP `connect()` + `listTools()` round-trip succeeds.
 */

import {
  type McpConfig,
  type McpServerEntry,
  type McpServerSnapshot,
  type McpServerStatus,
  mcpConfigSchema,
} from "@g-spot/types";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildMcpToolDefinition } from "./tool-adapter";

const CLIENT_INFO = { name: "g-spot", version: "0.1.0" } as const;

type Scope = "global" | { kind: "project"; projectId: string };

type ServerHandle = {
  scope: Scope;
  name: string;
  fingerprint: string;
  transport: "stdio" | "http" | "sse";
  status: McpServerStatus;
  client: Client | null;
  tools: ToolDefinition[];
  dispose: () => Promise<void>;
};

const handles = new Map<string, ServerHandle>();
const projectsLoaded = new Set<string>();

function handleId(scope: Scope, name: string): string {
  if (scope === "global") return `global:${name}`;
  return `project:${scope.projectId}:${name}`;
}

function detectTransport(entry: McpServerEntry): "stdio" | "http" | "sse" {
  if ("url" in entry) {
    return entry.type === "sse" ? "sse" : "http";
  }
  return "stdio";
}

function fingerprint(entry: McpServerEntry): string {
  return JSON.stringify(entry);
}

function globalConfigPath(): string {
  return path.join(os.homedir(), ".g-spot", "mcp.json");
}

function projectConfigPath(projectPath: string): string {
  return path.join(projectPath, ".mcp.json");
}

async function readConfigFile(filePath: string): Promise<McpConfig> {
  if (!existsSync(filePath)) {
    return { mcpServers: {} };
  }

  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    console.warn("[mcp] failed to read config", { filePath, error });
    return { mcpServers: {} };
  }

  if (raw.trim().length === 0) {
    return { mcpServers: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn("[mcp] invalid JSON in config", { filePath, error });
    return { mcpServers: {} };
  }

  // Tolerate either `{mcpServers: {...}}` or a bare `{...}` map of servers,
  // matching how some clients (e.g. Cursor) accept both.
  const candidate =
    parsed && typeof parsed === "object" && "mcpServers" in parsed
      ? parsed
      : { mcpServers: parsed };

  const result = mcpConfigSchema.safeParse(candidate);
  if (!result.success) {
    console.warn("[mcp] config failed schema validation", {
      filePath,
      issues: result.error.issues,
    });
    return { mcpServers: {} };
  }
  return result.data;
}

async function spawnServer(args: {
  scope: Scope;
  name: string;
  entry: McpServerEntry;
}): Promise<void> {
  const { scope, name, entry } = args;
  const id = handleId(scope, name);
  const transport = detectTransport(entry);

  const placeholder: ServerHandle = {
    scope,
    name,
    fingerprint: fingerprint(entry),
    transport,
    status: { kind: "starting" },
    client: null,
    tools: [],
    dispose: async () => {},
  };
  handles.set(id, placeholder);

  try {
    const client = new Client(CLIENT_INFO, {});
    let transportInstance:
      | StdioClientTransport
      | StreamableHTTPClientTransport
      | SSEClientTransport;

    if ("url" in entry) {
      const url = new URL(entry.url);
      const requestInit = entry.headers
        ? { headers: entry.headers }
        : undefined;
      transportInstance =
        entry.type === "sse"
          ? new SSEClientTransport(url, { requestInit })
          : new StreamableHTTPClientTransport(url, { requestInit });
    } else {
      transportInstance = new StdioClientTransport({
        command: entry.command,
        args: entry.args,
        env: entry.env,
        cwd: entry.cwd,
        stderr: "pipe",
      });
    }

    await client.connect(transportInstance);
    const listing = await client.listTools();
    const tools = listing.tools.map((remoteTool) =>
      buildMcpToolDefinition({
        client,
        serverName: name,
        remoteTool,
      }),
    );

    const handle: ServerHandle = {
      scope,
      name,
      fingerprint: fingerprint(entry),
      transport,
      status: { kind: "ready", toolCount: tools.length },
      client,
      tools,
      dispose: async () => {
        try {
          await client.close();
        } catch (error) {
          console.warn("[mcp] dispose failed", { id, error });
        }
      },
    };
    handles.set(id, handle);
    console.log("[mcp] ready", { id, transport, toolCount: tools.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[mcp] failed to spawn", { id, error });
    handles.set(id, {
      ...placeholder,
      status: { kind: "error", message },
    });
  }
}

async function reconcile(args: {
  scope: Scope;
  config: McpConfig;
}): Promise<void> {
  const { scope, config } = args;
  const scopeKey =
    scope === "global" ? "global" : `project:${scope.projectId}`;

  const desired = new Map(Object.entries(config.mcpServers));

  // Stop & remove handles in this scope that are no longer in the config.
  for (const [id, handle] of handles) {
    const handleScopeKey =
      handle.scope === "global"
        ? "global"
        : `project:${handle.scope.projectId}`;
    if (handleScopeKey !== scopeKey) continue;
    if (!desired.has(handle.name)) {
      await handle.dispose();
      handles.delete(id);
    }
  }

  // Start or restart entries.
  for (const [name, entry] of desired) {
    const id = handleId(scope, name);
    const existing = handles.get(id);

    if (entry.disabled === true) {
      if (existing) {
        await existing.dispose();
      }
      handles.set(id, {
        scope,
        name,
        fingerprint: fingerprint(entry),
        transport: detectTransport(entry),
        status: { kind: "disabled" },
        client: null,
        tools: [],
        dispose: async () => {},
      });
      continue;
    }

    if (
      existing &&
      existing.fingerprint === fingerprint(entry) &&
      existing.status.kind !== "error" &&
      existing.status.kind !== "disabled"
    ) {
      continue;
    }

    if (existing) {
      await existing.dispose();
    }
    await spawnServer({ scope, name, entry });
  }
}

export async function loadGlobalMcps(): Promise<void> {
  const config = await readConfigFile(globalConfigPath());
  await reconcile({ scope: "global", config });
}

export async function loadProjectMcps(args: {
  projectId: string;
  projectPath: string;
  force?: boolean;
}): Promise<void> {
  const { projectId, projectPath, force } = args;
  if (!force && projectsLoaded.has(projectId)) {
    return;
  }
  projectsLoaded.add(projectId);
  const config = await readConfigFile(projectConfigPath(projectPath));
  await reconcile({
    scope: { kind: "project", projectId },
    config,
  });
}

export async function reloadProjectMcps(args: {
  projectId: string;
  projectPath: string;
}): Promise<void> {
  return loadProjectMcps({ ...args, force: true });
}

/**
 * Snapshot of all known MCP servers (global + every project that has been
 * touched this process). Used by the tRPC `mcp.list` query.
 */
export function snapshotMcpServers(): McpServerSnapshot[] {
  const result: McpServerSnapshot[] = [];
  for (const handle of handles.values()) {
    result.push({
      scope: handle.scope === "global" ? "global" : "project",
      projectId: handle.scope === "global" ? null : handle.scope.projectId,
      name: handle.name,
      transport: handle.transport,
      status: handle.status,
    });
  }
  return result;
}

/**
 * Returns the union of every ready tool definition for the given project:
 * global tools + that project's tools. The chat-stream layer hands this list
 * to `createPiAgentSession` as `customTools`.
 */
export function getMcpToolsForProject(projectId: string): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  for (const handle of handles.values()) {
    if (handle.status.kind !== "ready") continue;
    if (handle.scope === "global") {
      tools.push(...handle.tools);
      continue;
    }
    if (handle.scope.projectId === projectId) {
      tools.push(...handle.tools);
    }
  }
  return tools;
}

export async function shutdownAllMcps(): Promise<void> {
  const all = [...handles.values()];
  handles.clear();
  projectsLoaded.clear();
  await Promise.allSettled(all.map((handle) => handle.dispose()));
}
