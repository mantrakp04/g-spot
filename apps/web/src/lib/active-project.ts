import { getDefaultStore, useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";

/**
 * Lightweight cache for the user's "last opened" project so the sidebar can
 * stay project-scoped when the user navigates somewhere outside the
 * `/projects/$projectId/*` subtree (e.g. settings, inbox, sections).
 *
 * The URL is always the source of truth — this is just a fallback.
 */
const STORAGE_KEY = "gspot.lastProjectId";

const stringStorage = {
  getItem(_key: string, initialValue: string | null) {
    if (typeof window === "undefined") return initialValue;
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return initialValue;
    }
  },
  setItem(_key: string, value: string | null) {
    if (typeof window === "undefined") return;
    try {
      if (value) {
        window.localStorage.setItem(STORAGE_KEY, value);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Storage may be disabled (private mode, quota, etc.) — fall back silently.
    }
  },
  removeItem() {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage may be disabled (private mode, quota, etc.) — fall back silently.
    }
  },
};

export const lastProjectIdAtom = atomWithStorage<string | null>(
  STORAGE_KEY,
  null,
  stringStorage,
  { getOnInit: true },
);

export function useLastProjectId() {
  return useAtomValue(lastProjectIdAtom);
}

export function useSetLastProjectId() {
  return useSetAtom(lastProjectIdAtom);
}

export function getLastProjectId(): string | null {
  return getDefaultStore().get(lastProjectIdAtom);
}

export function setLastProjectId(projectId: string | null): void {
  getDefaultStore().set(lastProjectIdAtom, projectId);
}
