import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";

import type { DiffMode } from "@/components/review/diff-viewer";

const diffModeStorage = {
  getItem(key: string, initialValue: DiffMode) {
    if (typeof window === "undefined") return initialValue;
    const raw = window.localStorage.getItem(key);
    return raw === "unified" ? "unified" : "split";
  },
  setItem(key: string, value: DiffMode) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
  },
  removeItem(key: string) {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
  },
};

const diffModeAtom = atomWithStorage<DiffMode>(
  "gspot:review:diff-mode",
  "split",
  diffModeStorage,
  { getOnInit: true },
);

const treeOpenAtom = atomWithStorage(
  "gspot:review:tree-open",
  true,
  undefined,
  { getOnInit: true },
);

export function useReviewDiffMode() {
  return useAtom(diffModeAtom);
}

export function useReviewTreeOpen() {
  return useAtom(treeOpenAtom);
}
