import { useCallback, useMemo } from "react";
import { useAtom } from "jotai";
import { atomFamily, atomWithStorage } from "jotai/utils";

const STORAGE_PREFIX = "g-spot:read:";

function parseReadIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

const readIdsStorage = {
  getItem(key: string, initialValue: string[]) {
    if (typeof window === "undefined") return initialValue;
    return parseReadIds(window.localStorage.getItem(key));
  },
  setItem(key: string, ids: string[]) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, JSON.stringify(ids));
  },
  removeItem(key: string) {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
  },
};

const readIdsFamily = atomFamily((key: string) =>
  atomWithStorage<string[]>(
    STORAGE_PREFIX + key,
    [],
    readIdsStorage,
    { getOnInit: true },
  ),
);

/**
 * Client-side read/unread tracking backed by localStorage.
 * Survives API refetches since it's Jotai UI state, not query cache state.
 */
export function useReadState(namespace: string) {
  const [readIds, setReadIds] = useAtom(readIdsFamily(namespace));
  const readIdSet = useMemo(() => new Set(readIds), [readIds]);

  const markAsRead = useCallback(
    (id: string) => {
      setReadIds((prev) => {
        if (prev.includes(id)) return prev;
        return [...prev, id];
      });
    },
    [setReadIds],
  );

  const isUnread = useCallback(
    (id: string) => !readIdSet.has(id),
    [readIdSet],
  );

  return { isUnread, markAsRead };
}
