import { env } from "@g-spot/env/web";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";

type TerminalViewProps = {
  projectId: string;
  tabId: string;
  active: boolean;
};

type ServerMessage =
  | { t: "out"; d: string }
  | { t: "exit"; code: number; signal: string | null };

function buildSocketUrl(projectId: string, cols: number, rows: number) {
  const url = new URL(env.VITE_SERVER_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/terminal/socket";
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("cols", String(cols));
  url.searchParams.set("rows", String(rows));
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

export function TerminalView({ projectId, tabId, active }: TerminalViewProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<{
    term: Terminal;
    fit: FitAddon;
    socket: WebSocket;
    pendingInput: string[];
    disposed: boolean;
  } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (stateRef.current) return;

    const term = new Terminal({
      // Menlo / SFMono first — broader Unicode coverage on macOS for TUIs
      // like Claude Code that use box-drawing, braille spinners, and emoji.
      // Fira Code stays in the chain for ligatures when the glyph exists.
      fontFamily:
        'Menlo, "SF Mono", ui-monospace, SFMono-Regular, "Fira Code", "DejaVu Sans Mono", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorBlink: true,
      allowProposedApi: true,
      theme: buildTheme(host),
      scrollback: 5000,
      // macOS Option key behaves as Alt for emacs-style line editing in
      // TUIs and Claude Code's input box.
      macOptionIsMeta: true,
    });

    // Unicode 11 width tables — needed for emoji + powerline glyphs to take
    // the right cell width. Without this, wide chars get clipped to single
    // width and TUIs render misaligned.
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = "11";

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    // Keep the default renderer. xterm's WebGL addon currently has open atlas
    // corruption reports with Claude Code-style TUIs in WebKit/Tauri-like shells.
    try {
      fit.fit();
    } catch {
      // Host may have 0 size briefly — ResizeObserver will refit.
    }
    const cols = term.cols;
    const rows = term.rows;

    const pendingInput: string[] = [];
    const socket = new WebSocket(buildSocketUrl(projectId, cols, rows));

    const sendInput = (data: string) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ t: "in", d: data }));
      } else {
        // Keep keystrokes typed before the socket finishes opening.
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
      // Sync size in case fit produced a different value than the URL.
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
      // Surface the close so the user knows why typing stops working.
      if (!stateRef.current?.disposed) {
        term.writeln("\x1b[2m[terminal: disconnected]\x1b[0m");
      }
    });

    const onInput = term.onData(sendInput);
    const onResize = term.onResize(({ cols: c, rows: r }) => {
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
    observer.observe(host);

    stateRef.current = { term, fit, socket, pendingInput, disposed: false };

    // Initial focus once the helper textarea exists in the DOM.
    requestAnimationFrame(() => term.focus());

    return () => {
      const state = stateRef.current;
      if (!state) return;
      state.disposed = true;
      observer.disconnect();
      onInput.dispose();
      onResize.dispose();
      try {
        socket.close();
      } catch {
        // ignore
      }
      term.dispose();
      stateRef.current = null;
    };
    // tabId in deps so closing+reopening a terminal tab gets a fresh PTY.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, tabId]);

  // Refit + refocus whenever this tab becomes active (display:none → block).
  useEffect(() => {
    if (!active) return;
    const state = stateRef.current;
    if (!state) return;
    const handle = requestAnimationFrame(() => {
      try {
        state.fit.fit();
      } catch {
        // ignore
      }
      state.term.focus();
    });
    return () => cancelAnimationFrame(handle);
  }, [active]);

  // Click anywhere in the terminal pane → focus the xterm helper textarea.
  // xterm's own click-to-focus only covers the inner viewport, not padding.
  const handleWrapperMouseDown = () => {
    stateRef.current?.term.focus();
  };

  return (
    <div
      ref={wrapperRef}
      onMouseDown={handleWrapperMouseDown}
      className="flex min-h-0 min-w-0 flex-1 cursor-text bg-background p-2"
    >
      <div ref={hostRef} className="min-h-0 min-w-0 flex-1" />
    </div>
  );
}
