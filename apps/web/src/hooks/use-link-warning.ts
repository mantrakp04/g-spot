import { useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";

const linkWarningDismissedAtom = atomWithStorage(
  "gspot:settings:link-warning-dismissed",
  false,
  undefined,
  { getOnInit: true },
);

export function useLinkWarningDismissed() {
  const dismissed = useAtomValue(linkWarningDismissedAtom);
  const setDismissed = useSetAtom(linkWarningDismissedAtom);

  const dismiss = () => {
    setDismissed(true);
  };

  const reset = () => {
    setDismissed(false);
  };

  return { dismissed, dismiss, reset } as const;
}
