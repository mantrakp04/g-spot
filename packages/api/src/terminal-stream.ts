import { getProject } from "@g-spot/db/projects";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

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
      cols?: string;
      rows?: string;
    };
  };
};

type TerminalSession = {
  terminal: Bun.Terminal;
  proc: Bun.Subprocess;
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

function pickShell(): string[] {
  const shell = process.env.SHELL;
  if (shell && existsSync(shell)) return [shell, "-l"];
  if (existsSync("/bin/zsh")) return ["/bin/zsh", "-l"];
  if (existsSync("/bin/bash")) return ["/bin/bash", "-l"];
  return ["/bin/sh"];
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
  const decoder = new TerminalOutputDecoder();

  const terminal = new Bun.Terminal({
    cols,
    rows,
    name: "xterm-256color",
    data(_term, data) {
      send(ws, { t: "out", d: decoder.decode(data) });
    },
  });

  let proc: Bun.Subprocess;
  try {
    proc = Bun.spawn(pickShell(), {
      cwd,
      terminal,
      detached: process.platform !== "win32",
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      onExit(_subprocess, exitCode, signal) {
        send(ws, { t: "exit", code: exitCode ?? 0, signal: signal ?? null });
        try {
          ws.raw.close?.();
        } catch {
          // ignore
        }
      },
    });
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

  return { terminal, proc };
}

export async function handleTerminalSocketOpen(ws: TerminalSocket) {
  const sessionPromise = createTerminalSession(ws);
  openingSessions.set(ws.id, sessionPromise);

  const session = await sessionPromise;
  openingSessions.delete(ws.id);
  if (session) {
    sessions.set(ws.id, session);
  }
}

type TerminalClientMessage =
  | { t: "in"; d: string }
  | { t: "r"; cols: number; rows: number }
  | { t: "sig"; signal: "SIGINT" | "SIGTERM" | "SIGQUIT" | "SIGTSTP" };

export function handleTerminalSocketMessage(ws: TerminalSocket, rawMessage: unknown) {
  void handleTerminalSocketMessageAsync(ws, rawMessage);
}

async function handleTerminalSocketMessageAsync(ws: TerminalSocket, rawMessage: unknown) {
  const session = sessions.get(ws.id) ?? (await openingSessions.get(ws.id));
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

  if (message.t === "in") {
    if (typeof message.d !== "string") return;
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

function signalTerminalProcessGroup(session: TerminalSession, signal: NodeJS.Signals) {
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
  const session = sessions.get(ws.id);
  openingSessions.delete(ws.id);
  if (!session) return;
  sessions.delete(ws.id);
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
