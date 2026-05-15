import { atom } from "jotai";

export type RelayStatus = "open" | "connecting" | "closed" | "unknown";

export const relayStatusAtom = atom<RelayStatus>("unknown");
