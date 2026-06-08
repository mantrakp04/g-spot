import { getProject } from "@g-spot/db/projects";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

/**
 * Pseudo-terminal WebSocket bridge.
 *
 * Each connection spawns the user's shell under a Bun PTY scoped to the
 * requested project's working directory. Bun.Terminal handles ConPTY/PTY
 * details — no native deps required.
 *
 * Protocol (text JSON frames both directions):
 *   client → server:
 *     { t: "in",  d: string }              user input bytes (UTF-8)
 *     { t: "r",   cols: number, rows: number }   resize
 *   server → client:
 *     { t: "out", d: string }              shell output bytes (UTF-8)
 *     { t: "exit", code: number, signal: string | null }
 */

type TerminalSocket = {
  id: string;
  raw: {
    send: (data: string) => unknown;
    close?: () => void;
  };
  data: {
    query: {
      projectId?: string;
      sessionId?: string;
      historyOffset?: string;
      skipReplay?: string;
      resumeAgent?: string;
      cols?: string;
      rows?: string;
    };
  };
};

type TerminalSession = {
  id: string;
  terminal: Bun.Terminal;
  proc: Bun.Subprocess;
  clients: Set<TerminalSocket>;
  output: string;
  cwd: string;
  inputLine: string;
  backend:
    | { kind: "shell" }
    | {
        kind: "tmux";
        name: string;
        tmuxPath: string;
      }
    | {
        kind: "screen";
        name: string;
        screenPath: string;
      };
};

const utf8Decoder = new TextDecoder();

const C1_TO_ESCAPE: Record<number, string> = {
  0x90: "\x1bP",
  0x9b: "\x1b[",
  0x9c: "\x1b\\",
  0x9d: "\x1b]",
  0x9e: "\x1b^",
  0x9f: "\x1b_",
};

class TerminalOutputDecoder {
  private pending = new Uint8Array(0);

  decode(chunk: Uint8Array) {
    const bytes = this.pending.length > 0 ? concatBytes(this.pending, chunk) : chunk;
    let out = "";
    let i = 0;

    while (i < bytes.length) {
      const byte = bytes[i]!;
      if (byte < 0x80) {
        out += String.fromCharCode(byte);
        i += 1;
        continue;
      }

      const width = utf8SequenceWidth(byte);
      if (width === 0) {
        out += C1_TO_ESCAPE[byte] ?? String.fromCharCode(byte);
        i += 1;
        continue;
      }

      if (i + width > bytes.length) break;
      const sequence = bytes.subarray(i, i + width);
      if (hasOnlyContinuationBytes(sequence.subarray(1))) {
        out += utf8Decoder.decode(sequence);
        i += width;
        continue;
      }

      out += "\ufffd";
      i += 1;
    }

    this.pending = i < bytes.length ? bytes.slice(i) : new Uint8Array(0);
    return out;
  }
}

function concatBytes(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function utf8SequenceWidth(byte: number) {
  if (byte >= 0xc2 && byte <= 0xdf) return 2;
  if (byte >= 0xe0 && byte <= 0xef) return 3;
  if (byte >= 0xf0 && byte <= 0xf4) return 4;
  return 0;
}

function hasOnlyContinuationBytes(bytes: Uint8Array) {
  for (const byte of bytes) {
    if (byte < 0x80 || byte > 0xbf) return false;
  }
  return true;
}

const sessions = new Map<string, TerminalSession>();
const openingSessions = new Map<string, Promise<TerminalSession | null>>();
const socketSessionIds = new Map<string, string>();
const MAX_SESSION_OUTPUT_CHARS = 500_000;
const AGENT_BINDING_CAPTURE_DELAYS_MS = [0, 1000, 3000, 7000] as const;

function pickShell(): string[] {
  const shell = process.env.SHELL;
  if (shell && existsSync(shell)) return [shell, "-l"];
  if (existsSync("/bin/zsh")) return ["/bin/zsh", "-l"];
  if (existsSync("/bin/bash")) return ["/bin/bash", "-l"];
  return ["/bin/sh"];
}

function findExecutable(name: string) {
  const path = process.env.PATH ?? "";
  for (const dir of path.split(":")) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function pickScreen() {
  if (process.env.GSPOT_ENABLE_SCREEN_TERMINALS !== "1") return null;
  if (process.platform === "win32") return null;
  if (existsSync("/usr/bin/screen")) return "/usr/bin/screen";
  return findExecutable("screen");
}

function pickTmux() {
  if (process.platform === "win32") return null;
  return findExecutable("tmux");
}

function multiplexerSessionName(sessionId: string) {
  const hash = createHash("sha256").update(sessionId).digest("hex").slice(0, 16);
  return `gspot-${hash}`;
}

function tmuxSessionExists(tmuxPath: string, name: string) {
  try {
    return spawnSync(tmuxPath, ["has-session", "-t", name], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

function screenSessionExists(screenPath: string, name: string) {
  try {
    const result = spawnSync(screenPath, ["-ls"], { encoding: "utf8" });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    return output.includes(`.${name}\t`) || output.includes(`.${name} `);
  } catch {
    return false;
  }
}

type AgentKind = "claude" | "codex";

type AgentResumeBinding = {
  agent: AgentKind;
  sessionId: string;
  updatedAt: number;
};

type AgentResumeSource = "stored" | "cmux" | "inferred";

type ResolvedAgentResumeBinding = {
  binding: AgentResumeBinding;
  source: AgentResumeSource;
};

type StoredAgentBinding = AgentResumeBinding & {
  surfaceId: string;
  cwd: string;
};

type StoredAgentBindingsFile = {
  version: 1;
  sessions: Record<string, StoredAgentBinding>;
};

function readJsonFile(path: string) {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function nestedObjectEntries(value: unknown, out: unknown[] = []): unknown[] {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) nestedObjectEntries(item, out);
    return out;
  }
  const record = value as Record<string, unknown>;
  out.push(record);
  for (const nested of Object.values(record)) {
    nestedObjectEntries(nested, out);
  }
  return out;
}

function readStringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readTimestampField(record: Record<string, unknown>) {
  const value =
    readStringField(record, ["updatedAt", "updated_at", "createdAt", "created_at", "timestamp"]) ??
    record.updatedAt ??
    record.updated_at ??
    record.createdAt ??
    record.created_at ??
    record.timestamp;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function extractAgentResumeBindings(
  agent: AgentKind,
  value: unknown,
  surfaceId: string,
  cwd: string,
): AgentResumeBinding[] {
  const bindings: AgentResumeBinding[] = [];
  for (const entry of nestedObjectEntries(value)) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const recordSurfaceId = readStringField(record, [
      "surfaceId",
      "surface_id",
      "cmuxSurfaceId",
      "cmux_surface_id",
    ]);
    if (recordSurfaceId !== surfaceId) continue;

    const recordCwd = readStringField(record, ["cwd", "workingDirectory", "working_directory"]);
    if (recordCwd && recordCwd !== cwd) continue;

    const sessionId = readStringField(record, [
      "sessionId",
      "session_id",
      "nativeSessionId",
      "native_session_id",
      "agentSessionId",
      "agent_session_id",
    ]);
    if (!sessionId) continue;

    bindings.push({ agent, sessionId, updatedAt: readTimestampField(record) });
  }
  return bindings;
}

function gspotAgentBindingPath() {
  return join(homedir(), ".g-spot", "terminal-agent-sessions.json");
}

function readStoredAgentBindings(): StoredAgentBindingsFile {
  const value = readJsonFile(gspotAgentBindingPath());
  if (!value || typeof value !== "object") return { version: 1, sessions: {} };
  const sessions = (value as { sessions?: unknown }).sessions;
  if (!sessions || typeof sessions !== "object") return { version: 1, sessions: {} };
  return {
    version: 1,
    sessions: sessions as Record<string, StoredAgentBinding>,
  };
}

function writeStoredAgentBinding(binding: StoredAgentBinding) {
  try {
    const path = gspotAgentBindingPath();
    mkdirSync(join(path, ".."), { recursive: true });
    const file = readStoredAgentBindings();
    writeFileSync(
      path,
      JSON.stringify(
        {
          version: 1,
          sessions: {
            ...file.sessions,
            [binding.surfaceId]: binding,
          },
        } satisfies StoredAgentBindingsFile,
        null,
        2,
      ),
    );
  } catch {
    // Resume bindings are best effort; the terminal still works without them.
  }
}

function findStoredAgentResumeBinding(surfaceId: string, cwd: string) {
  const binding = readStoredAgentBindings().sessions[surfaceId];
  if (!binding || binding.cwd !== cwd) return null;
  return binding;
}

function findCmuxAgentResumeBinding(surfaceId: string, cwd: string) {
  const dir = join(homedir(), ".cmuxterm");
  const bindings = [
    ...extractAgentResumeBindings(
      "claude",
      readJsonFile(join(dir, "claude-hook-sessions.json")),
      surfaceId,
      cwd,
    ),
    ...extractAgentResumeBindings(
      "codex",
      readJsonFile(join(dir, "codex-hook-sessions.json")),
      surfaceId,
      cwd,
    ),
  ].sort((a, b) => b.updatedAt - a.updatedAt);
  return bindings[0] ?? null;
}

function encodeClaudeProjectPath(cwd: string) {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

function readFilePrefix(path: string, maxBytes = 16_384) {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

function listJsonlFiles(dir: string, depth = 0): string[] {
  if (depth > 6) return [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...listJsonlFiles(path, depth + 1));
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(path);
      }
    }
    return files;
  } catch {
    return [];
  }
}

function newestJsonl(files: string[]) {
  return files
    .map((path) => {
      try {
        return { path, mtimeMs: statSync(path).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { path: string; mtimeMs: number } => entry !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0] ?? null;
}

function findLatestClaudeSession(cwd: string): AgentResumeBinding | null {
  const dir = join(homedir(), ".claude", "projects", encodeClaudeProjectPath(cwd));
  const newest = newestJsonl(listJsonlFiles(dir));
  if (!newest) return null;
  const sessionId = basename(newest.path, ".jsonl");
  return { agent: "claude", sessionId, updatedAt: newest.mtimeMs };
}

function findLatestCodexSession(cwd: string): AgentResumeBinding | null {
  const files = listJsonlFiles(join(homedir(), ".codex", "sessions"));
  const recent = files
    .map((path) => {
      try {
        return { path, mtimeMs: statSync(path).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { path: string; mtimeMs: number } => entry !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 250);

  for (const entry of recent) {
    const prefix = readFilePrefix(entry.path);
    const line = prefix.split("\n", 1)[0] ?? "";
    const escapedCwd = cwd.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    if (!line.includes('"session_meta"') || !line.includes(`"cwd":"${escapedCwd}"`)) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as {
        payload?: {
          id?: unknown;
        };
      };
      const sessionId = parsed.payload?.id;
      if (typeof sessionId === "string" && sessionId.trim()) {
        return { agent: "codex", sessionId, updatedAt: entry.mtimeMs };
      }
    } catch {
      // ignore this transcript
    }
  }
  return null;
}

function findLatestAgentSession(agent: AgentKind, cwd: string) {
  return agent === "claude" ? findLatestClaudeSession(cwd) : findLatestCodexSession(cwd);
}

function parseResumeAgent(value: string | undefined): AgentKind | null {
  return value === "claude" || value === "codex" ? value : null;
}

function resolveAgentResumeBinding(
  surfaceId: string,
  cwd: string,
  resumeAgent: AgentKind | null,
): ResolvedAgentResumeBinding | null {
  const stored = findStoredAgentResumeBinding(surfaceId, cwd);
  if (stored) return { binding: stored, source: "stored" };

  const cmux = findCmuxAgentResumeBinding(surfaceId, cwd);
  if (cmux) return { binding: cmux, source: "cmux" };

  const inferred = resumeAgent ? findLatestAgentSession(resumeAgent, cwd) : null;
  return inferred ? { binding: inferred, source: "inferred" } : null;
}

function agentResumeCommand(binding: AgentResumeBinding): string[] {
  if (binding.agent === "claude") return ["claude", "--resume", binding.sessionId];
  return ["codex", "resume", binding.sessionId];
}

function shellEscape(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function shellCommand(command: string[]) {
  return command.map(shellEscape).join(" ");
}

function terminalLaunchCommand(id: string, cwd: string, resumeAgent: AgentKind | null) {
  const name = multiplexerSessionName(id);
  const resolvedResumeBinding = resolveAgentResumeBinding(id, cwd, resumeAgent);
  const resumeBinding = resolvedResumeBinding?.binding ?? null;
  const resumeCommand = resumeBinding ? agentResumeCommand(resumeBinding) : null;
  const shouldReplaceStaleMultiplexer = resolvedResumeBinding?.source === "inferred";
  const tmuxPath = pickTmux();
  if (tmuxPath) {
    if (tmuxSessionExists(tmuxPath, name)) {
      if (shouldReplaceStaleMultiplexer) {
        spawnSync(tmuxPath, ["kill-session", "-t", name], { stdio: "ignore" });
      } else {
        return {
          command: [tmuxPath, "attach-session", "-t", name],
          backend: { kind: "tmux", name, tmuxPath } satisfies TerminalSession["backend"],
        };
      }
    }
    if (resumeCommand) {
      return {
        command: [tmuxPath, "new-session", "-A", "-s", name, shellCommand(resumeCommand)],
        backend: { kind: "tmux", name, tmuxPath } satisfies TerminalSession["backend"],
      };
    }
    return {
      command: [tmuxPath, "new-session", "-A", "-s", name],
      backend: { kind: "tmux", name, tmuxPath } satisfies TerminalSession["backend"],
    };
  }

  const screenPath = pickScreen();
  if (screenPath) {
    if (screenSessionExists(screenPath, name)) {
      if (shouldReplaceStaleMultiplexer) {
        spawnSync(screenPath, ["-S", name, "-X", "quit"], { stdio: "ignore" });
      } else {
        return {
          command: [screenPath, "-x", name],
          backend: { kind: "screen", name, screenPath } satisfies TerminalSession["backend"],
        };
      }
    }
    if (resumeCommand) {
      return {
        command: [screenPath, "-T", "xterm-256color", "-S", name, ...resumeCommand],
        backend: { kind: "screen", name, screenPath } satisfies TerminalSession["backend"],
      };
    }
    return {
      command: [screenPath, "-T", "xterm-256color", "-S", name],
      backend: { kind: "screen", name, screenPath } satisfies TerminalSession["backend"],
    };
  }

  return {
    command: resumeCommand ?? pickShell(),
    backend: { kind: "shell" } satisfies TerminalSession["backend"],
  };
}

function stripControlChars(value: string) {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

function applyInputToLine(current: string, input: string) {
  let line = current;
  const completed: string[] = [];
  for (const char of input) {
    if (char === "\r" || char === "\n") {
      const trimmed = stripControlChars(line).trim();
      if (trimmed) completed.push(trimmed);
      line = "";
      continue;
    }
    if (char === "\u0003" || char === "\u001b") {
      line = "";
      continue;
    }
    if (char === "\b" || char === "\x7f") {
      line = line.slice(0, -1);
      continue;
    }
    line += char;
  }
  return { line: line.slice(-4096), completed };
}

function detectAgentLaunch(command: string): AgentKind | null {
  const normalized = command.trim();
  if (!normalized || normalized.startsWith("#")) return null;
  const firstCommand = normalized
    .split(/&&|\|\||;|\|/, 1)[0]!
    .replace(/^env\s+([A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*/, "")
    .replace(/^(bunx|npx|pnpm\s+dlx|yarn\s+dlx|uvx)\s+/, "")
    .trim();
  const binary = firstCommand.split(/\s+/, 1)[0]?.split("/").at(-1);
  if (binary === "claude") return "claude";
  if (binary === "codex") return "codex";
  return null;
}

function captureAgentBinding(session: TerminalSession, agent: AgentKind) {
  const binding = findLatestAgentSession(agent, session.cwd);
  if (!binding) return;
  writeStoredAgentBinding({
    ...binding,
    surfaceId: session.id,
    cwd: session.cwd,
    updatedAt: Date.now(),
  });
}

function scheduleAgentBindingCapture(session: TerminalSession, agent: AgentKind) {
  for (const delay of AGENT_BINDING_CAPTURE_DELAYS_MS) {
    setTimeout(() => captureAgentBinding(session, agent), delay);
  }
}

function clampDim(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

async function resolveCwd(projectId: string | undefined): Promise<string> {
  if (projectId) {
    const project = await getProject(projectId);
    if (project?.path && existsSync(project.path)) return project.path;
  }
  return homedir();
}

function send(ws: TerminalSocket, payload: unknown) {
  try {
    ws.raw.send(JSON.stringify(payload));
  } catch {
    // Connection may already be closing — drop the frame.
  }
}

function getSessionId(ws: TerminalSocket) {
  return ws.data.query.sessionId || ws.id;
}

function parseHistoryOffset(value: string | undefined) {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function shouldSkipReplay(ws: TerminalSocket) {
  return ws.data.query.skipReplay === "1";
}

function broadcast(session: TerminalSession, payload: unknown) {
  for (const client of session.clients) {
    send(client, payload);
  }
}

async function createTerminalSession(ws: TerminalSocket): Promise<TerminalSession | null> {
  if (typeof Bun?.Terminal !== "function") {
    send(ws, {
      t: "out",
      d: "\x1b[31m[terminal: this Bun runtime does not include PTY support — upgrade to Bun >= 1.3.5]\x1b[0m\r\n",
    });
    try {
      ws.raw.close?.();
    } catch {
      // ignore
    }
    return null;
  }

  const cols = clampDim(ws.data.query.cols, 80, 1, 1000);
  const rows = clampDim(ws.data.query.rows, 24, 1, 1000);
  const cwd = await resolveCwd(ws.data.query.projectId);
  const id = getSessionId(ws);
  const decoder = new TerminalOutputDecoder();
  const launch = terminalLaunchCommand(id, cwd, parseResumeAgent(ws.data.query.resumeAgent));
  let session: TerminalSession | null = null;

  const terminal = new Bun.Terminal({
    cols,
    rows,
    name: "xterm-256color",
    data(_term, data) {
      if (!session) return;
      const decoded = decoder.decode(data);
      if (!decoded) return;
      session.output = (session.output + decoded).slice(-MAX_SESSION_OUTPUT_CHARS);
      broadcast(session, { t: "out", d: decoded });
    },
  });
  let proc: Bun.Subprocess;
  try {
    proc = Bun.spawn(launch.command, {
      cwd,
      terminal,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        GSPOT_PROJECT_ID: ws.data.query.projectId ?? "",
        GSPOT_TERMINAL_SESSION_ID: id,
        CMUX_WORKSPACE_ID: ws.data.query.projectId ?? "",
        CMUX_SURFACE_ID: id,
      },
      onExit(_subprocess, exitCode, signal) {
        if (!session) return;
        broadcast(session, { t: "exit", code: exitCode ?? 0, signal: signal ?? null });
        for (const client of session.clients) {
          try {
            client.raw.close?.();
          } catch {
            // ignore
          }
        }
        sessions.delete(session.id);
      },
    });
    session = {
      id,
      terminal,
      proc,
      clients: new Set([ws]),
      output: "",
      cwd,
      inputLine: "",
      backend: launch.backend,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send(ws, {
      t: "out",
      d: `\x1b[31m[terminal: failed to spawn shell — ${message}]\x1b[0m\r\n`,
    });
    try {
      terminal.close();
    } catch {
      // ignore
    }
    try {
      ws.raw.close?.();
    } catch {
      // ignore
    }
    return null;
  }

  return session;
}

export async function handleTerminalSocketOpen(ws: TerminalSocket) {
  const sessionId = getSessionId(ws);
  socketSessionIds.set(ws.id, sessionId);

  const existing = sessions.get(sessionId);
  if (existing) {
    existing.clients.add(ws);
    if (!shouldSkipReplay(ws)) {
      const offset = parseHistoryOffset(ws.data.query.historyOffset);
      const missed = existing.output.slice(offset);
      if (missed) send(ws, { t: "out", d: missed });
    }
    return;
  }

  const opening = openingSessions.get(sessionId);
  if (opening) {
    const session = await opening;
    if (!session) return;
    session.clients.add(ws);
    if (!shouldSkipReplay(ws)) {
      const offset = parseHistoryOffset(ws.data.query.historyOffset);
      const missed = session.output.slice(offset);
      if (missed) send(ws, { t: "out", d: missed });
    }
    return;
  }

  const sessionPromise = createTerminalSession(ws);
  openingSessions.set(sessionId, sessionPromise);

  const session = await sessionPromise;
  openingSessions.delete(sessionId);
  if (session) {
    sessions.set(sessionId, session);
  }
}

type TerminalClientMessage =
  | { t: "in"; d: string }
  | { t: "r"; cols: number; rows: number }
  | { t: "close" }
  | { t: "sig"; signal: "SIGINT" | "SIGTERM" | "SIGQUIT" | "SIGTSTP" };

export function handleTerminalSocketMessage(ws: TerminalSocket, rawMessage: unknown) {
  void handleTerminalSocketMessageAsync(ws, rawMessage);
}

async function handleTerminalSocketMessageAsync(ws: TerminalSocket, rawMessage: unknown) {
  const sessionId = socketSessionIds.get(ws.id) ?? getSessionId(ws);
  const session = sessions.get(sessionId) ?? (await openingSessions.get(sessionId));
  if (!session) return;

  let message: TerminalClientMessage;
  if (typeof rawMessage === "string" || Buffer.isBuffer(rawMessage)) {
    const payload = typeof rawMessage === "string" ? rawMessage : rawMessage.toString();
    try {
      message = JSON.parse(payload) as TerminalClientMessage;
    } catch {
      return;
    }
  } else if (rawMessage && typeof rawMessage === "object") {
    message = rawMessage as TerminalClientMessage;
  } else {
    return;
  }

  if (message.t === "close") {
    closeTerminalSession(session);
    return;
  }

  if (message.t === "in") {
    if (typeof message.d !== "string") return;
    const inputState = applyInputToLine(session.inputLine, message.d);
    session.inputLine = inputState.line;
    for (const command of inputState.completed) {
      const agent = detectAgentLaunch(command);
      if (agent) scheduleAgentBindingCapture(session, agent);
    }
    try {
      // TUIs like Claude Code run in raw mode and expect Ctrl+C as input bytes.
      // Converting \x03 into SIGINT breaks their own interrupt/exit handling.
      session.terminal.write(message.d);
    } catch {
      // ignore
    }
    return;
  }
  if (message.t === "sig") {
    signalTerminalProcessGroup(session, message.signal);
    return;
  }
  if (message.t === "r") {
    if (typeof message.cols !== "number" || typeof message.rows !== "number") return;
    const cols = clampDim(String(message.cols), 80, 1, 1000);
    const rows = clampDim(String(message.rows), 24, 1, 1000);
    try {
      session.terminal.resize(cols, rows);
    } catch {
      // ignore
    }
  }
}

function closeTerminalSession(session: TerminalSession) {
  sessions.delete(session.id);
  openingSessions.delete(session.id);
  for (const client of session.clients) {
    try {
      client.raw.close?.();
    } catch {
      // ignore
    }
  }
  if (session.backend.kind === "screen") {
    try {
      spawnSync(session.backend.screenPath, ["-S", session.backend.name, "-X", "quit"], {
        stdio: "ignore",
      });
    } catch {
      // ignore
    }
  }
  if (session.backend.kind === "tmux") {
    try {
      spawnSync(session.backend.tmuxPath, ["kill-session", "-t", session.backend.name], {
        stdio: "ignore",
      });
    } catch {
      // ignore
    }
  }
  try {
    if (process.platform !== "win32") {
      process.kill(-session.proc.pid, "SIGKILL");
    } else {
      session.proc.kill();
    }
  } catch {
    try {
      session.proc.kill();
    } catch {
      // ignore
    }
  }
  try {
    session.terminal.close();
  } catch {
    // ignore
  }
}

function signalTerminalProcessGroup(session: TerminalSession, signal: NodeJS.Signals) {
  if (session.backend.kind !== "shell") {
    try {
      if (signal === "SIGINT") session.terminal.write("\x03");
      return true;
    } catch {
      return false;
    }
  }

  if (process.platform !== "win32") {
    try {
      process.kill(-session.proc.pid, signal);
      return true;
    } catch {
      // Fall through to Bun.Terminal.write for shells spawned before this fix
      // or runtimes where the PTY child is not a process-group leader.
    }
  }

  try {
    session.terminal.write("\x03");
    return true;
  } catch {
    return false;
  }
}

export function handleTerminalSocketClose(ws: TerminalSocket) {
  const sessionId = socketSessionIds.get(ws.id) ?? getSessionId(ws);
  socketSessionIds.delete(ws.id);
  const session = sessions.get(sessionId);
  if (!session) return;
  session.clients.delete(ws);
}
