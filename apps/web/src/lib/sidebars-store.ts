import { atomWithStorage } from "jotai/utils";

export type RightSidebarTab = "files" | "changes";

const SECONDARY_COLLAPSED_KEY = "gspot.secondarysidebar.collapsed.v1";
const RIGHT_COLLAPSED_KEY = "gspot.rightsidebar.collapsed.v1";
const RIGHT_TAB_KEY = "gspot.rightsidebar.tab.v1";
const SWAPPED_KEY = "gspot.sidebars.swapped.v1";

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

/**
 * Whether the left/secondary sidebar (AiSidebar, SectionsSidebar, etc.) is
 * collapsed. When swapped, this still tracks the AiSidebar regardless of
 * which physical side it sits on.
 */
export const secondarySidebarCollapsedAtom = atomWithStorage<boolean>(
  SECONDARY_COLLAPSED_KEY,
  false,
  jsonStorage<boolean>(SECONDARY_COLLAPSED_KEY),
  { getOnInit: true },
);

export const rightSidebarCollapsedAtom = atomWithStorage<boolean>(
  RIGHT_COLLAPSED_KEY,
  false,
  jsonStorage<boolean>(RIGHT_COLLAPSED_KEY),
  { getOnInit: true },
);

export const rightSidebarTabAtom = atomWithStorage<RightSidebarTab>(
  RIGHT_TAB_KEY,
  "files",
  {
    ...jsonStorage<RightSidebarTab>(RIGHT_TAB_KEY),
    getItem(_key, initialValue) {
      if (typeof window === "undefined") return initialValue;
      try {
        const raw = window.localStorage.getItem(RIGHT_TAB_KEY);
        if (!raw) return initialValue;
        const parsed: unknown = JSON.parse(raw);
        return parsed === "files" || parsed === "changes" ? parsed : initialValue;
      } catch {
        return initialValue;
      }
    },
  },
  { getOnInit: true },
);

/**
 * When true, the AiSidebar physically sits on the right and the file/changes
 * panel sits on the left. Collapse state is per-sidebar (not per position), so
 * toggles still operate on the same logical panel after a swap.
 */
export const sidebarsSwappedAtom = atomWithStorage<boolean>(
  SWAPPED_KEY,
  false,
  jsonStorage<boolean>(SWAPPED_KEY),
  { getOnInit: true },
);
