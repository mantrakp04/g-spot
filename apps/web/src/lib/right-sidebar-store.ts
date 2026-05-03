import { atomWithStorage } from "jotai/utils";

export type RightSidebarTab = "files" | "changes" | "terminal";

const COLLAPSED_KEY = "gspot.rightsidebar.collapsed.v1";
const TAB_KEY = "gspot.rightsidebar.tab.v1";

function jsonStorage<T>(storageKey: string) {
  return {
    getItem(_key: string, initialValue: T): T {
      if (typeof window === "undefined") return initialValue;
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) return initialValue;
        return JSON.parse(raw) as T;
      } catch {
        return initialValue;
      }
    },
    setItem(_key: string, value: T) {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(value));
      } catch {
        // ignore
      }
    },
    removeItem(_key: string) {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // ignore
      }
    },
  };
}

export const rightSidebarCollapsedAtom = atomWithStorage<boolean>(
  COLLAPSED_KEY,
  false,
  jsonStorage<boolean>(COLLAPSED_KEY),
  { getOnInit: true },
);

export const rightSidebarTabAtom = atomWithStorage<RightSidebarTab>(
  TAB_KEY,
  "files",
  jsonStorage<RightSidebarTab>(TAB_KEY),
  { getOnInit: true },
);
