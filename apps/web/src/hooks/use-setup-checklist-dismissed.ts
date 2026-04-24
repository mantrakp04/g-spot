import { useCallback } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";

const setupChecklistDismissedAtom = atomWithStorage(
  "gspot.sidebar.setup-checklist-dismissed",
  false,
  undefined,
  { getOnInit: true },
);

export function useSetupChecklistDismissed() {
  const dismissed = useAtomValue(setupChecklistDismissedAtom);
  const setDismissed = useSetAtom(setupChecklistDismissedAtom);

  const dismiss = useCallback(() => {
    setDismissed(true);
  }, [setDismissed]);

  return { dismissed, dismiss } as const;
}
