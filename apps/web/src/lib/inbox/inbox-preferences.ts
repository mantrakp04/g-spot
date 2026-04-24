import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";

const emailDrawerWidthAtom = atomWithStorage(
  "email-drawer-width",
  45,
  undefined,
  { getOnInit: true },
);

export function useEmailDrawerWidth() {
  return useAtom(emailDrawerWidthAtom);
}
