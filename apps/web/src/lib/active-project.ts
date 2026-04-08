/**
 * Lightweight cache for the user's "last opened" project so the sidebar can
 * stay project-scoped when the user navigates somewhere outside the
 * `/projects/$projectId/*` subtree (e.g. settings, inbox, sections).
 *
 * The URL is always the source of truth — this is just a fallback.
 */
const STORAGE_KEY = "gspot.lastProjectId";

export function getLastProjectId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setLastProjectId(projectId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (projectId) {
      window.localStorage.setItem(STORAGE_KEY, projectId);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage may be disabled (private mode, quota, etc.) — fall back silently.
  }
}
