/**
 * Lightweight render/event counters for the chat UI. Prefix `[chat-perf]`
 * so these can be filtered in DevTools. Toggle via `localStorage.chatPerf=1`.
 */

const PREFIX = "[chat-perf]";

function enabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("chatPerf") === "1";
  } catch {
    return false;
  }
}

const counters = new Map<string, number>();
const lastTickAt = new Map<string, number>();

export function perfCount(tag: string, extra?: Record<string, unknown>) {
  if (!enabled()) return;
  const n = (counters.get(tag) ?? 0) + 1;
  counters.set(tag, n);
  const now = performance.now();
  const prev = lastTickAt.get(tag) ?? now;
  lastTickAt.set(tag, now);
  console.log(PREFIX, tag, "#" + n, "+" + (now - prev).toFixed(1) + "ms", extra ?? "");
}

export function perfMark(tag: string, extra?: Record<string, unknown>) {
  if (!enabled()) return;
  console.log(PREFIX, tag, extra ?? "");
}

export function perfResetCounters() {
  counters.clear();
  lastTickAt.clear();
}
