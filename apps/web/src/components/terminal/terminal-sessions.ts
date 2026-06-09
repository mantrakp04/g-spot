import { serverWebSocketPath } from "@/utils/server-url";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

/**
 * Persistent terminal sessions keyed by tab id. The xterm instance, fit addon,
 * WebSocket, and DOM host all live in this module so the PTY survives when
 * `TerminalView` unmounts (e.g. user navigates away from /agent/$id and
 * back). The component just appends/removes the session's container element
 * from its wrapper; nothing is disposed until the tab itself is closed.
 */

type ServerMessage =
  | { t: "out"; d: string }
  | { t: "exit"; code: number; signal: string | null };

export type TerminalSession = {
  tabId: string;
  projectId: string;
  container: HTMLDivElement;
  term: Terminal;
  fit: FitAddon;
  socket: WebSocket;
  pendingInput: string[];
  resizeObserver: ResizeObserver;
  disposed: boolean;
  /** Signature of the theme last applied — lets us skip no-op reapplies. */
  themeSignature: string;
};

const sessions = new Map<string, TerminalSession>();
const MAX_TERMINAL_HISTORY_CHARS = 500_000;

function historyKey(tabId: string) {
  return `gspot.terminal.history.${tabId}`;
}

function readTerminalHistory(tabId: string) {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(historyKey(tabId)) ?? "";
  } catch {
    return "";
  }
}

function appendTerminalHistory(tabId: string, chunk: string) {
  if (typeof window === "undefined" || chunk.length === 0) return;
  try {
    const next = (readTerminalHistory(tabId) + chunk).slice(-MAX_TERMINAL_HISTORY_CHARS);
    window.localStorage.setItem(historyKey(tabId), next);
  } catch {
    // Storage may be disabled — terminal still works without durable scrollback.
  }
}

function clearTerminalHistory(tabId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(historyKey(tabId));
  } catch {
    // ignore
  }
}

function buildSocketUrl(
  sessionId: string,
  projectId: string,
  cols: number,
  rows: number,
  historyLength: number,
) {
  const url = new URL(serverWebSocketPath("/api/terminal/socket"));
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("cols", String(cols));
  url.searchParams.set("rows", String(rows));
  url.searchParams.set("sessionId", sessionId);
  url.searchParams.set("historyOffset", String(historyLength));
  return url.toString();
}

function readCssVar(root: HTMLElement, name: string, fallback: string) {
  const v = getComputedStyle(root).getPropertyValue(name).trim();
  return v || fallback;
}

function buildTheme(host: HTMLElement) {
  const fg = readCssVar(host, "--foreground", "#cdd6f4");
  const bg = readCssVar(host, "--background", "#1e1e2e");
  const muted = readCssVar(host, "--muted-foreground", "#a6adc8");
  const accent = readCssVar(host, "--primary", "#89b4fa");
  return {
    foreground: fg,
    background: bg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: accent,
    selectionForeground: bg,
    selectionInactiveBackground: muted,
  };
}

function themeSignature(theme: ReturnType<typeof buildTheme>) {
  return `${theme.foreground}|${theme.background}|${theme.cursor}|${theme.selectionBackground}|${theme.selectionInactiveBackground}`;
}

/**
 * The app drives theming by mutating CSS custom properties on
 * `document.documentElement` (class/data-theme/inline style). xterm caches its
 * palette as a concrete `theme` object at creation, so it never sees those
 * changes — switching themes used to leave live terminals on the old palette.
 * We watch the root for attribute changes and re-read + reapply the theme to
 * every live session, diffing a signature so unchanged themes are a no-op.
 */
let themeObserver: MutationObserver | null = null;

function reapplyThemeToAllSessions() {
  if (typeof document === "undefined") return;
  const theme = buildTheme(document.documentElement);
  const signature = themeSignature(theme);
  for (const session of sessions.values()) {
    if (session.disposed || session.themeSignature === signature) continue;
    session.term.options.theme = theme;
    session.themeSignature = signature;
  }
}

function ensureThemeObserver() {
  if (themeObserver || typeof document === "undefined") return;
  let scheduled = false;
  themeObserver = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    // Coalesce bursts of attribute writes into a single reapply next frame.
    requestAnimationFrame(() => {
      scheduled = false;
      reapplyThemeToAllSessions();
    });
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style", "data-theme"],
  });
}

function createSession(tabId: string, projectId: string): TerminalSession {
  const container = document.createElement("div");
  container.className = "min-h-0 min-w-0 flex-1";

  // CSS vars resolve against the documentElement when the container is still
  // detached at theme-read time — close enough for the initial render and the
  // ResizeObserver will refit once attached.
  const themeHost = document.documentElement;
  const theme = buildTheme(themeHost);

  const term = new Terminal({
    fontFamily:
      'Menlo, "SF Mono", ui-monospace, SFMono-Regular, "Fira Code", "DejaVu Sans Mono", monospace',
    fontSize: 13,
    lineHeight: 1.2,
    letterSpacing: 0,
    cursorBlink: true,
    allowProposedApi: true,
    theme,
    scrollback: 5000,
    macOptionIsMeta: true,
  });

  // Keep this session's palette in sync with later theme switches.
  ensureThemeObserver();

  const unicode11 = new Unicode11Addon();
  term.loadAddon(unicode11);
  term.unicode.activeVersion = "11";

  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(container);
  // Always replay locally-persisted scrollback. Agent resume is decided
  // server-side from stored session bindings, so the client never needs to
  // guess (and never drops scrollback on a bad guess); a resumed session keeps
  // its prior history visible above it.
  const restoredHistory = readTerminalHistory(tabId);
  if (restoredHistory) {
    term.write(restoredHistory);
  }

  const cols = term.cols;
  const rows = term.rows;

  const pendingInput: string[] = [];
  const socket = new WebSocket(buildSocketUrl(tabId, projectId, cols, rows, restoredHistory.length));

  const session: TerminalSession = {
    tabId,
    projectId,
    container,
    term,
    fit,
    socket,
    pendingInput,
    // Real observer assigned below — placeholder satisfies the type.
    resizeObserver: new ResizeObserver(() => {}),
    disposed: false,
    themeSignature: themeSignature(theme),
  };

  const sendInput = (data: string) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ t: "in", d: data }));
    } else {
      pendingInput.push(data);
    }
  };

  const flush = () => {
    while (pendingInput.length > 0 && socket.readyState === WebSocket.OPEN) {
      sendInput(pendingInput.shift()!);
    }
  };
  socket.addEventListener("open", () => {
    flush();
    try {
      socket.send(JSON.stringify({ t: "r", cols: term.cols, rows: term.rows }));
    } catch {
      // ignore
    }
  });
  socket.addEventListener("message", (event) => {
    let msg: ServerMessage | null = null;
    try {
      msg = JSON.parse(typeof event.data === "string" ? event.data : "") as ServerMessage;
    } catch {
      return;
    }
    if (!msg) return;
    if (msg.t === "out") {
      appendTerminalHistory(tabId, msg.d);
      term.write(msg.d);
      return;
    }
    if (msg.t === "exit") {
      term.writeln("");
      term.writeln(`\x1b[2m[process exited: ${msg.code}]\x1b[0m`);
    }
  });
  socket.addEventListener("error", () => {
    term.writeln("\x1b[31m[terminal: connection error]\x1b[0m");
  });
  socket.addEventListener("close", () => {
    if (!session.disposed) {
      term.writeln("\x1b[2m[terminal: disconnected]\x1b[0m");
    }
  });

  term.onData(sendInput);
  term.onResize(({ cols: c, rows: r }) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ t: "r", cols: c, rows: r }));
    }
  });

  const observer = new ResizeObserver(() => {
    try {
      fit.fit();
    } catch {
      // Detached host — ignore.
    }
  });
  observer.observe(container);
  session.resizeObserver = observer;

  return session;
}

export function acquireTerminalSession(tabId: string, projectId: string): TerminalSession {
  const existing = sessions.get(tabId);
  if (existing && !existing.disposed) {
    // projectId is fixed at tab creation; mismatch means a stale session — replace.
    if (existing.projectId === projectId) return existing;
    disposeTerminalSession(tabId);
  }
  const session = createSession(tabId, projectId);
  sessions.set(tabId, session);
  return session;
}

export function disposeTerminalSession(tabId: string): void {
  const session = sessions.get(tabId);
  if (!session) return;
  session.disposed = true;
  try {
    if (session.socket.readyState === WebSocket.OPEN) {
      session.socket.send(JSON.stringify({ t: "close" }));
    }
  } catch {
    // ignore
  }
  try {
    session.resizeObserver.disconnect();
  } catch {
    // ignore
  }
  try {
    session.socket.close();
  } catch {
    // ignore
  }
  try {
    session.term.dispose();
  } catch {
    // ignore
  }
  session.container.remove();
  sessions.delete(tabId);
  clearTerminalHistory(tabId);
}

export function reapTerminalSessions(liveTabIds: ReadonlySet<string>): void {
  for (const tabId of [...sessions.keys()]) {
    if (!liveTabIds.has(tabId)) disposeTerminalSession(tabId);
  }
}
