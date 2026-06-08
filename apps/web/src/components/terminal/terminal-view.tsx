import { useEffect, useRef } from "react";

import { acquireTerminalSession } from "./terminal-sessions";
import { registerSurfaceFocus } from "@/lib/surface-focus";

type TerminalViewProps = {
  projectId: string;
  tabId: string;
  active: boolean;
};

/**
 * Thin wrapper around the persistent terminal session keyed by `tabId`. The
 * xterm instance, WebSocket, and PTY all live in `terminal-sessions.ts` so
 * unmounting this component (e.g. navigating away from /agent/$id) does
 * not tear down the shell. We only attach/detach the session's container.
 */
export function TerminalView({ projectId, tabId, active }: TerminalViewProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const session = acquireTerminalSession(tabId, projectId);
    wrapper.appendChild(session.container);
    const handle = requestAnimationFrame(() => {
      try {
        session.fit.fit();
      } catch {
        // ignore
      }
      session.term.focus();
    });
    return () => {
      cancelAnimationFrame(handle);
      if (session.container.parentElement === wrapper) {
        wrapper.removeChild(session.container);
      }
    };
  }, [projectId, tabId]);

  // Refit + refocus whenever this tab becomes active (display:none → block).
  useEffect(() => {
    if (!active) return;
    const session = acquireTerminalSession(tabId, projectId);
    const handle = requestAnimationFrame(() => {
      try {
        session.fit.fit();
      } catch {
        // ignore
      }
      session.term.focus();
    });
    return () => cancelAnimationFrame(handle);
  }, [active, projectId, tabId]);

  useEffect(() => {
    return registerSurfaceFocus(tabId, () => {
      const session = acquireTerminalSession(tabId, projectId);
      try {
        session.fit.fit();
      } catch {
        // ignore
      }
      session.term.focus();
    });
  }, [projectId, tabId]);

  const handleWrapperMouseDown = () => {
    const session = acquireTerminalSession(tabId, projectId);
    session.term.focus();
  };

  return (
    <div
      ref={wrapperRef}
      onMouseDown={handleWrapperMouseDown}
      className="flex min-h-0 min-w-0 flex-1 cursor-text bg-background p-2"
    />
  );
}
