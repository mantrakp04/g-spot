/**
 * In-memory MCP server registry.
 *
 *  - Global config (`~/.g-spot/mcp.json`) is loaded on server boot and watched
 *    for edits. Reconciliation re-runs whenever the file changes.
 *  - Per-project configs (`<project.path>/.mcp.json`) are loaded lazily the
 *    first time a chat in that project sends a message. Once loaded, the file
 *    is also watched, so edits while the server is running are picked up
 *    without an explicit reload.
 *  - Failed spawns retry with exponential backoff (1s, 2s, 4s, 8s, 16s, then
 *    stop). Editing the config or hitting `mcp.reloadGlobal/reloadProject`
 *    resets the retry counter.
 *  - String values inside an entry support `${VAR}` and `${VAR:-default}`
 *    interpolation against `process.env`, matching the FastMCP / Claude Code
 *    convention.
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
import { existsSync, promises as fs, watch, type FSWatcher } from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildMcpToolDefinition } from "./tool-adapter";

const CLIENT_INFO = { name: "g-spot", version: "0.1.0" } as const;
const RETRY_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;
const WATCH_DEBOUNCE_MS = 250;

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
  /** Pending setTimeout for the next retry attempt, if any. */
  retryTimer: ReturnType<typeof setTimeout> | null;
};

const handles = new Map<string, ServerHandle>();
const projectsLoaded = new Map<string, string>(); // projectId -> projectPath

type WatcherEntry = {
  watcher: FSWatcher;
  debounce: ReturnType<typeof setTimeout> | null;
};
const watchers = new Map<string, WatcherEntry>();

function handleId(scope: Scope, name: string): string {
  if (scope === "global") return `global:${name}`;
  return `project:${scope.projectId}:${name}`;
}

function scopeKey(scope: Scope): string {
  return scope === "global" ? "global" : `project:${scope.projectId}`;
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

// ---------------------------------------------------------------------------
// ${VAR} / ${VAR:-default} interpolation
// ---------------------------------------------------------------------------

const VAR_PATTERN = /\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/gi;

function interpolateString(value: string): string {
  return value.replace(VAR_PATTERN, (_match, name: string, fallback?: string) => {
    const resolved = process.env[name];
    if (typeof resolved === "string" && resolved.length > 0) {
      return resolved;
    }
    return fallback ?? "";
  });
}

function interpolateRecord(
  record: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!record) return record;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = interpolateString(value);
  }
  return out;
}

function interpolateEntry(entry: McpServerEntry): McpServerEntry {
  if ("url" in entry) {
    return {
      ...entry,
      url: interpolateString(entry.url),
      headers: interpolateRecord(entry.headers),
    };
  }
  return {
    ...entry,
    command: interpolateString(entry.command),
    args: entry.args?.map(interpolateString),
    env: interpolateRecord(entry.env),
    cwd: entry.cwd ? interpolateString(entry.cwd) : entry.cwd,
  };
}

// ---------------------------------------------------------------------------
// Config IO
// ---------------------------------------------------------------------------

async function writeConfigFile(filePath: string, config: McpConfig): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  // The watcher will fire and re-reconcile; that's the source of truth path
  // for spawning. Writes are intentionally async-fire-and-watch rather than
  // calling reconcile inline, so manual file edits and UI edits go through
  // exactly the same code path.
  const payload = `${JSON.stringify(config, null, 2)}\n`;
  await fs.writeFile(filePath, payload, "utf8");
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

// ---------------------------------------------------------------------------
// Spawn + retry
// ---------------------------------------------------------------------------

function clearRetryTimer(handle: ServerHandle | undefined): void {
  if (handle?.retryTimer) {
    clearTimeout(handle.retryTimer);
    handle.retryTimer = null;
  }
}

async function spawnServer(args: {
  scope: Scope;
  name: string;
  entry: McpServerEntry;
  attempt?: number;
}): Promise<void> {
  const { scope, name, entry } = args;
  const attempt = args.attempt ?? 1;
  const id = handleId(scope, name);
  const transport = detectTransport(entry);
  const previous = handles.get(id);
  clearRetryTimer(previous);

  const placeholder: ServerHandle = {
    scope,
    name,
    fingerprint: fingerprint(entry),
    transport,
    status: { kind: "starting", attempt },
    client: null,
    tools: [],
    dispose: async () => {},
    retryTimer: null,
  };
  handles.set(id, placeholder);

  const resolved = interpolateEntry(entry);

  try {
    const client = new Client(CLIENT_INFO, {});
    let transportInstance:
      | StdioClientTransport
      | StreamableHTTPClientTransport
      | SSEClientTransport;

    if ("url" in resolved) {
      const url = new URL(resolved.url);
      const requestInit = resolved.headers
        ? { headers: resolved.headers }
        : undefined;
      transportInstance =
        resolved.type === "sse"
          ? new SSEClientTransport(url, { requestInit })
          : new StreamableHTTPClientTransport(url, { requestInit });
    } else {
      transportInstance = new StdioClientTransport({
        command: resolved.command,
        args: resolved.args,
        env: resolved.env,
        cwd: resolved.cwd,
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

    handles.set(id, {
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
      retryTimer: null,
    });
    console.log("[mcp] ready", { id, transport, toolCount: tools.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const backoff = RETRY_BACKOFF_MS[attempt - 1];
    const retryAt = backoff != null ? Date.now() + backoff : null;
    console.warn("[mcp] failed to spawn", {
      id,
      attempt,
      retryInMs: backoff ?? "give-up",
      error,
    });

    const errorHandle: ServerHandle = {
      scope,
      name,
      fingerprint: fingerprint(entry),
      transport,
      status: { kind: "error", message, attempt, retryAt },
      client: null,
      tools: [],
      dispose: async () => {},
      retryTimer: null,
    };

    if (backoff != null) {
      errorHandle.retryTimer = setTimeout(() => {
        // Make sure the entry hasn't been replaced or removed while we waited.
        const current = handles.get(id);
        if (
          !current ||
          current.fingerprint !== fingerprint(entry) ||
          current.status.kind !== "error"
        ) {
          return;
        }
        void spawnServer({ scope, name, entry, attempt: attempt + 1 });
      }, backoff);
    }

    handles.set(id, errorHandle);
  }
}

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------

async function reconcile(args: {
  scope: Scope;
  config: McpConfig;
}): Promise<void> {
  const { scope, config } = args;
  const targetScopeKey = scopeKey(scope);

  const desired = new Map(Object.entries(config.mcpServers));

  // Stop & remove handles in this scope that are no longer in the config.
  for (const [id, handle] of handles) {
    if (scopeKey(handle.scope) !== targetScopeKey) continue;
    if (!desired.has(handle.name)) {
      clearRetryTimer(handle);
      await handle.dispose();
      handles.delete(id);
    }
  }

  // Start, restart, or mark disabled.
  for (const [name, entry] of desired) {
    const id = handleId(scope, name);
    const existing = handles.get(id);

    if (entry.disabled === true) {
      if (existing) {
        clearRetryTimer(existing);
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
        retryTimer: null,
      });
      continue;
    }

    if (
      existing &&
      existing.fingerprint === fingerprint(entry) &&
      existing.status.kind === "ready"
    ) {
      continue;
    }

    if (existing) {
      clearRetryTimer(existing);
      await existing.dispose();
    }
    await spawnServer({ scope, name, entry });
  }
}

// ---------------------------------------------------------------------------
// File watching
// ---------------------------------------------------------------------------

function ensureWatcher(args: {
  filePath: string;
  onChange: () => void;
}): void {
  const { filePath, onChange } = args;
  if (watchers.has(filePath)) return;

  // Watch the parent directory so we still pick up the file being created
  // after boot (fs.watch on a missing path throws). Filter inside the handler.
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath);

  if (!existsSync(dir)) {
    return;
  }

  let watcher: FSWatcher;
  try {
    watcher = watch(dir, { persistent: false }, (_event, name) => {
      if (name == null || name.toString() !== baseName) return;
      const entry = watchers.get(filePath);
      if (!entry) return;
      if (entry.debounce) clearTimeout(entry.debounce);
      entry.debounce = setTimeout(() => {
        entry.debounce = null;
        try {
          onChange();
        } catch (error) {
          console.warn("[mcp] watcher onChange failed", { filePath, error });
        }
      }, WATCH_DEBOUNCE_MS);
    });
  } catch (error) {
    console.warn("[mcp] failed to attach watcher", { filePath, error });
    return;
  }

  watchers.set(filePath, { watcher, debounce: null });
}

function teardownWatchers(): void {
  for (const entry of watchers.values()) {
    if (entry.debounce) clearTimeout(entry.debounce);
    try {
      entry.watcher.close();
    } catch {
      /* ignore */
    }
  }
  watchers.clear();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function loadGlobalMcps(): Promise<void> {
  const filePath = globalConfigPath();
  const config = await readConfigFile(filePath);
  await reconcile({ scope: "global", config });
  ensureWatcher({
    filePath,
    onChange: () => {
      void loadGlobalMcps();
    },
  });
}

export async function loadProjectMcps(args: {
  projectId: string;
  projectPath: string;
  force?: boolean;
}): Promise<void> {
  const { projectId, projectPath, force } = args;
  const alreadyLoaded = projectsLoaded.has(projectId);
  if (!force && alreadyLoaded) {
    return;
  }
  projectsLoaded.set(projectId, projectPath);
  const filePath = projectConfigPath(projectPath);
  const config = await readConfigFile(filePath);
  await reconcile({
    scope: { kind: "project", projectId },
    config,
  });
  ensureWatcher({
    filePath,
    onChange: () => {
      void loadProjectMcps({ projectId, projectPath, force: true });
    },
  });
}

export async function reloadProjectMcps(args: {
  projectId: string;
  projectPath: string;
}): Promise<void> {
  return loadProjectMcps({ ...args, force: true });
}

// ---------------------------------------------------------------------------
// Config edits (UI-driven). The watcher reconciles after each write.
// ---------------------------------------------------------------------------

type ConfigTarget =
  | { scope: "global" }
  | { scope: "project"; projectId: string; projectPath: string };

export async function getMcpConfigForTarget(target: ConfigTarget): Promise<{
  filePath: string;
  raw: string;
  config: McpConfig;
}> {
  const filePath =
    target.scope === "global"
      ? globalConfigPath()
      : projectConfigPath(target.projectPath);

  let raw = "";
  if (existsSync(filePath)) {
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      raw = "";
    }
  }
  const config = await readConfigFile(filePath);
  return { filePath, raw, config };
}

/**
 * Overwrite the on-disk config for `target` with the given parsed `config`.
 * Caller is responsible for validating + parsing the JSON; this function only
 * persists and triggers an immediate reconcile so the UI feels instant
 * (the watcher will also fire, but is debounced).
 */
export async function writeMcpConfig(args: {
  target: ConfigTarget;
  config: McpConfig;
}): Promise<void> {
  const { target, config } = args;
  const filePath =
    target.scope === "global"
      ? globalConfigPath()
      : projectConfigPath(target.projectPath);
  await writeConfigFile(filePath, config);

  if (target.scope === "global") {
    await reconcile({ scope: "global", config });
    ensureWatcher({
      filePath,
      onChange: () => {
        void loadGlobalMcps();
      },
    });
    return;
  }

  projectsLoaded.set(target.projectId, target.projectPath);
  await reconcile({
    scope: { kind: "project", projectId: target.projectId },
    config,
  });
  ensureWatcher({
    filePath,
    onChange: () => {
      void loadProjectMcps({
        projectId: target.projectId,
        projectPath: target.projectPath,
        force: true,
      });
    },
  });
}

export type { ConfigTarget };

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
  teardownWatchers();
  const all = [...handles.values()];
  for (const handle of all) {
    clearRetryTimer(handle);
  }
  handles.clear();
  projectsLoaded.clear();
  await Promise.allSettled(all.map((handle) => handle.dispose()));
}
