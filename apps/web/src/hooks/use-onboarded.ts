import { useCallback } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";

const onboardedAtom = atomWithStorage(
  "gspot.onboarded",
  false,
  undefined,
  { getOnInit: true },
);

export function useOnboarded() {
  const onboarded = useAtomValue(onboardedAtom);
  const setOnboarded = useSetAtom(onboardedAtom);

  const markOnboarded = useCallback(() => {
    setOnboarded(true);
  }, [setOnboarded]);

  const replayOnboarding = useCallback(() => {
    setOnboarded(false);
  }, [setOnboarded]);

  return { onboarded, markOnboarded, replayOnboarding } as const;
}
