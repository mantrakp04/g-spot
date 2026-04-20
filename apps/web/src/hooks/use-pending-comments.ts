import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { atomFamily } from "jotai/utils";
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

const pendingCommentsFamily = atomFamily(
  (_k: string) => atom<PendingComment[]>([]),
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
  const setPending = useSetAtom(pendingCommentsFamily(keyString(key)));
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
  const setPending = useSetAtom(pendingCommentsFamily(keyString(key)));
  return useCallback(
    (id: string) => setPending((prev) => prev.filter((p) => p.id !== id)),
    [setPending],
  );
}

export function useClearPendingComments(key: PendingCommentsKey) {
  const setPending = useSetAtom(pendingCommentsFamily(keyString(key)));
  return useCallback(() => setPending([]), [setPending]);
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
