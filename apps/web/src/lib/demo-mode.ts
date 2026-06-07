export const DEMO_ROTATION_INTERVAL_MS = 10_000;

export function isEmbeddedFrame(): boolean {
  if (typeof window === "undefined") return false;

  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}
