import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { atomFamily, atomWithStorage } from "jotai/utils";
import { nanoid } from "nanoid";
import { useCallback } from "react";

export type PendingComment = {
  id: string;
  path: string;
  side: "LEFT" | "RIGHT";
  line: number;
  startLine?: number;
  body: string;
};

export type PendingCommentsKey = {
  owner: string;
  repo: string;
  prNumber: number;
};

function keyString(k: PendingCommentsKey) {
  return `${k.owner}/${k.repo}/${k.prNumber}`;
}

function storageKey(k: string) {
  return `gspot:review:pending-comments:${k}`;
}

function parsePendingComments(raw: string | null): PendingComment[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is PendingComment => {
      if (!item || typeof item !== "object") return false;
      const record = item as Record<string, unknown>;
      return (
        typeof record.id === "string" &&
        typeof record.path === "string" &&
        (record.side === "LEFT" || record.side === "RIGHT") &&
        typeof record.line === "number" &&
        typeof record.body === "string" &&
        (record.startLine == null || typeof record.startLine === "number")
      );
    });
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[review] failed to parse pending comments", error);
    }
    return [];
  }
}

const pendingCommentsStorage = {
  getItem(key: string, initialValue: PendingComment[]) {
    if (typeof window === "undefined") return initialValue;
    return parsePendingComments(window.localStorage.getItem(key));
  },
  setItem(key: string, pending: PendingComment[]) {
    if (typeof window === "undefined") return;
    if (pending.length === 0) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(pending));
  },
  removeItem(key: string) {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
  },
};

const pendingCommentsFamily = atomFamily(
  (k: string) =>
    atomWithStorage<PendingComment[]>(
      storageKey(k),
      [],
      pendingCommentsStorage,
      { getOnInit: true },
    ),
);

export type ActiveCompose = {
  path: string;
  side: "LEFT" | "RIGHT";
  line: number;
  startLine?: number;
};

const activeComposeFamily = atomFamily(
  (_k: string) => atom<ActiveCompose | null>(null),
);

export function usePendingComments(key: PendingCommentsKey) {
  return useAtomValue(pendingCommentsFamily(keyString(key)));
}

export function useAddPendingComment(key: PendingCommentsKey) {
  const k = keyString(key);
  const setPending = useSetAtom(pendingCommentsFamily(k));
  return useCallback(
    (c: Omit<PendingComment, "id">) => {
      const full: PendingComment = { ...c, id: nanoid(8) };
      setPending((prev) => [...prev, full]);
      return full;
    },
    [setPending],
  );
}

export function useRemovePendingComment(key: PendingCommentsKey) {
  const k = keyString(key);
  const setPending = useSetAtom(pendingCommentsFamily(k));
  return useCallback(
    (id: string) => setPending((prev) => prev.filter((p) => p.id !== id)),
    [setPending],
  );
}

export function useClearPendingComments(key: PendingCommentsKey) {
  const k = keyString(key);
  const setPending = useSetAtom(pendingCommentsFamily(k));
  return useCallback(() => {
    setPending([]);
  }, [setPending]);
}

export function useActiveCompose(key: PendingCommentsKey) {
  const [active, setActive] = useAtom(activeComposeFamily(keyString(key)));
  const start = useCallback(
    (args: ActiveCompose) => setActive(args),
    [setActive],
  );
  const cancel = useCallback(() => setActive(null), [setActive]);
  const add = useAddPendingComment(key);
  const submit = useCallback(
    (body: string) => {
      if (!active || !body.trim()) return;
      add({
        path: active.path,
        side: active.side,
        line: active.line,
        startLine: active.startLine,
        body: body.trim(),
      });
      setActive(null);
    },
    [active, add, setActive],
  );
  return { active, start, cancel, submit };
}

export type OnStartInlineComment = (args: ActiveCompose) => void;
