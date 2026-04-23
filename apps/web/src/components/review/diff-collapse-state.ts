import { atom, useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";

/** Filenames currently collapsed. */
const collapsedFilesAtom = atom<Set<string>>(new Set<string>());

/**
 * All filenames currently shown, in render order. Kept in an atom so the
 * "collapse/expand all" shortcut can see the full list without prop drilling.
 */
const allFilesAtom = atom<readonly string[]>([]);

/**
 * Filenames we've already applied default-collapse logic to. Lets us seed
 * "collapsed past index N" once per file without clobbering later user toggles.
 */
const seededFilesAtom = atom<Set<string>>(new Set<string>());

export function useSetAllFiles() {
  const setAll = useSetAtom(allFilesAtom);
  const setCollapsed = useSetAtom(collapsedFilesAtom);
  const setSeeded = useSetAtom(seededFilesAtom);
  return useCallback(
    (filenames: readonly string[], defaultCollapsedAfter?: number) => {
      setAll(filenames);
      if (defaultCollapsedAfter == null) return;
      setSeeded((prevSeeded) => {
        const newlySeen: string[] = [];
        const nextSeeded = new Set(prevSeeded);
        for (const f of filenames) {
          if (!nextSeeded.has(f)) {
            newlySeen.push(f);
            nextSeeded.add(f);
          }
        }
        if (newlySeen.length === 0) return prevSeeded;
        setCollapsed((prevCollapsed) => {
          let changed = false;
          const next = new Set(prevCollapsed);
          for (let i = 0; i < filenames.length; i++) {
            const f = filenames[i]!;
            if (i >= defaultCollapsedAfter && newlySeen.includes(f)) {
              if (!next.has(f)) {
                next.add(f);
                changed = true;
              }
            }
          }
          return changed ? next : prevCollapsed;
        });
        return nextSeeded;
      });
    },
    [setAll, setCollapsed, setSeeded],
  );
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
