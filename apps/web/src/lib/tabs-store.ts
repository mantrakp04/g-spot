import { atom, useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useCallback } from "react";

/**
 * Tab strip state. Each tab is either a chat (mapped to a persisted chat
 * record) or a terminal (transient). The active tab drives what's painted
 * in the chat-route content area; inactive tabs stay mounted but hidden so
 * scroll position, draft input, and PTY state survive switches.
 *
 * URL is the source of truth only on entry — visiting a chat URL "opens"
 * the corresponding tab. After that, tab state is independent of routing.
 */

export type ChatTab = {
  id: string;
  kind: "chat";
  projectId: string;
  chatId: string;
  title: string;
  /** Deep-link hints from the URL — read once by ChatView, then cleared. */
  focusMessageId?: string;
  searchText?: string;
};

export type TerminalTab = {
  id: string;
  kind: "terminal";
  projectId: string;
  title: string;
};

export type FileTab = {
  id: string;
  kind: "file";
  projectId: string;
  /** Project-relative posix path. */
  path: string;
  title: string;
};

export type DiffMode = "uncommitted" | "staged" | "unstaged";

export type DiffTab = {
  id: string;
  kind: "diff";
  projectId: string;
  path: string;
  title: string;
  mode: DiffMode;
};

export type Tab = ChatTab | TerminalTab | FileTab | DiffTab;

const TABS_STORAGE_KEY = "gspot.tabs.v1";
const ACTIVE_TAB_STORAGE_KEY = "gspot.tabs.active.v1";

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
        // Storage may be disabled — degrade silently.
      }
    },
    removeItem(_key: string) {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // Storage may be disabled — degrade silently.
      }
    },
  };
}

export const tabsAtom = atomWithStorage<Tab[]>(
  TABS_STORAGE_KEY,
  [],
  jsonStorage<Tab[]>(TABS_STORAGE_KEY),
  { getOnInit: true },
);

export const activeTabIdAtom = atomWithStorage<string | null>(
  ACTIVE_TAB_STORAGE_KEY,
  null,
  jsonStorage<string | null>(ACTIVE_TAB_STORAGE_KEY),
  { getOnInit: true },
);

export const activeTabAtom = atom<Tab | null>((get) => {
  const tabs = get(tabsAtom);
  const activeId = get(activeTabIdAtom);
  if (!activeId) return tabs[0] ?? null;
  return tabs.find((t) => t.id === activeId) ?? tabs[0] ?? null;
});

function chatTabId(projectId: string, chatId: string) {
  return `chat:${projectId}:${chatId}`;
}

function newTerminalTabId() {
  return `terminal:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function fileTabId(projectId: string, path: string) {
  return `file:${projectId}:${path}`;
}

function diffTabId(projectId: string, path: string) {
  // Mode is mutable on a single diff tab — not part of identity.
  return `diff:${projectId}:${path}`;
}

function basename(p: string) {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? p : p.slice(idx + 1);
}

export function useTabs() {
  return useAtomValue(tabsAtom);
}

export function useActiveTabId() {
  return useAtomValue(activeTabIdAtom);
}

export function useActiveTab() {
  return useAtomValue(activeTabAtom);
}

type OpenChatOptions = {
  focusMessageId?: string;
  searchText?: string;
};

export function useOpenChatTab() {
  const setTabs = useSetAtom(tabsAtom);
  const setActive = useSetAtom(activeTabIdAtom);
  return useCallback(
    (projectId: string, chatId: string, title: string, options?: OpenChatOptions) => {
      const id = chatTabId(projectId, chatId);
      setTabs((prev) => {
        const existing = prev.find((t) => t.id === id);
        if (existing && existing.kind === "chat") {
          const merged: ChatTab = {
            ...existing,
            title,
            focusMessageId: options?.focusMessageId ?? existing.focusMessageId,
            searchText: options?.searchText ?? existing.searchText,
          };
          return prev.map((t) => (t.id === id ? merged : t));
        }
        const next: ChatTab = {
          id,
          kind: "chat",
          projectId,
          chatId,
          title,
          focusMessageId: options?.focusMessageId,
          searchText: options?.searchText,
        };
        return [...prev, next];
      });
      setActive(id);
    },
    [setTabs, setActive],
  );
}

export function useClearChatTabHints() {
  const setTabs = useSetAtom(tabsAtom);
  return useCallback(
    (id: string) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === id && t.kind === "chat"
            ? { ...t, focusMessageId: undefined, searchText: undefined }
            : t,
        ),
      );
    },
    [setTabs],
  );
}

export function useOpenTerminalTab() {
  const setTabs = useSetAtom(tabsAtom);
  const setActive = useSetAtom(activeTabIdAtom);
  return useCallback(
    (projectId: string, title = "Terminal") => {
      const id = newTerminalTabId();
      const next: TerminalTab = { id, kind: "terminal", projectId, title };
      setTabs((prev) => [...prev, next]);
      setActive(id);
      return id;
    },
    [setTabs, setActive],
  );
}

export function useOpenFileTab() {
  const setTabs = useSetAtom(tabsAtom);
  const setActive = useSetAtom(activeTabIdAtom);
  return useCallback(
    (projectId: string, filePath: string) => {
      const id = fileTabId(projectId, filePath);
      const title = basename(filePath);
      setTabs((prev) => {
        if (prev.some((t) => t.id === id)) return prev;
        const next: FileTab = { id, kind: "file", projectId, path: filePath, title };
        return [...prev, next];
      });
      setActive(id);
      return id;
    },
    [setTabs, setActive],
  );
}

export function useOpenDiffTab() {
  const setTabs = useSetAtom(tabsAtom);
  const setActive = useSetAtom(activeTabIdAtom);
  return useCallback(
    (projectId: string, filePath: string, mode: DiffMode = "uncommitted") => {
      const id = diffTabId(projectId, filePath);
      const title = basename(filePath);
      setTabs((prev) => {
        const existing = prev.find((t) => t.id === id);
        if (existing && existing.kind === "diff") {
          if (existing.mode === mode) return prev;
          return prev.map((t) =>
            t.id === id && t.kind === "diff" ? { ...t, mode } : t,
          );
        }
        const next: DiffTab = {
          id,
          kind: "diff",
          projectId,
          path: filePath,
          title,
          mode,
        };
        return [...prev, next];
      });
      setActive(id);
      return id;
    },
    [setTabs, setActive],
  );
}

export function useUpdateDiffMode() {
  const setTabs = useSetAtom(tabsAtom);
  return useCallback(
    (id: string, mode: DiffMode) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === id && t.kind === "diff" ? { ...t, mode } : t,
        ),
      );
    },
    [setTabs],
  );
}

export function useCloseTab() {
  const setTabs = useSetAtom(tabsAtom);
  const setActive = useSetAtom(activeTabIdAtom);
  return useCallback(
    (id: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx === -1) return prev;
        const next = prev.filter((t) => t.id !== id);
        // Reassign active if the closed tab was active. Prefer the neighbor
        // to the right, else left, else null.
        setActive((current) => {
          if (current !== id) return current;
          const fallback = next[idx] ?? next[idx - 1] ?? null;
          return fallback?.id ?? null;
        });
        return next;
      });
    },
    [setTabs, setActive],
  );
}

export function useFocusTab() {
  const setActive = useSetAtom(activeTabIdAtom);
  return useCallback((id: string) => setActive(id), [setActive]);
}

export function useUpdateTabTitle() {
  const setTabs = useSetAtom(tabsAtom);
  return useCallback(
    (id: string, title: string) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === id ? ({ ...t, title } as Tab) : t)),
      );
    },
    [setTabs],
  );
}

export function findChatTabId(projectId: string, chatId: string) {
  return chatTabId(projectId, chatId);
}
