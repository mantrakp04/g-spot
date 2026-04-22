import { atom, useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";

/** Filenames currently collapsed. */
const collapsedFilesAtom = atom<Set<string>>(new Set<string>());

/**
 * All filenames currently shown, in render order. Kept in an atom so the
 * "collapse/expand all" shortcut can see the full list without prop drilling.
 */
const allFilesAtom = atom<readonly string[]>([]);

export function useSetAllFiles() {
  return useSetAtom(allFilesAtom);
}

export function useFileCollapse(filename: string) {
  const collapsedSet = useAtomValue(collapsedFilesAtom);
  const setCollapsed = useSetAtom(collapsedFilesAtom);
  const allFiles = useAtomValue(allFilesAtom);
  const collapsed = collapsedSet.has(filename);

  const toggle = useCallback(
    (bulk: boolean) => {
      setCollapsed((prev) => {
        if (bulk) {
          // Any file open → collapse all. Everyone already collapsed → expand all.
          const anyOpen = allFiles.some((f) => !prev.has(f));
          return anyOpen ? new Set(allFiles) : new Set();
        }
        const next = new Set(prev);
        if (next.has(filename)) next.delete(filename);
        else next.add(filename);
        return next;
      });
    },
    [setCollapsed, filename, allFiles],
  );

  return { collapsed, toggle };
}
