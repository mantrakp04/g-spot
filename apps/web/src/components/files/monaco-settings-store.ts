import { atomWithStorage } from "jotai/utils";

export type WordWrap = "on" | "off";
export type RenderWhitespace = "none" | "selection" | "all";

export type MonacoEditorSettings = {
  fontSize: number;
  tabSize: number;
  wordWrap: WordWrap;
  minimap: boolean;
  lineNumbers: boolean;
  renderWhitespace: RenderWhitespace;
};

export const DEFAULT_MONACO_SETTINGS: MonacoEditorSettings = {
  fontSize: 13,
  tabSize: 2,
  wordWrap: "off",
  minimap: false,
  lineNumbers: true,
  renderWhitespace: "selection",
};

const STORAGE_KEY = "gspot.monaco.settings.v1";

function jsonStorage<T>(storageKey: string) {
  return {
    getItem(_key: string, initialValue: T): T {
      if (typeof window === "undefined") return initialValue;
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) return initialValue;
        return { ...initialValue, ...(JSON.parse(raw) as Partial<T>) };
      } catch {
        return initialValue;
      }
    },
    setItem(_key: string, value: T) {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(value));
      } catch {
        // ignore
      }
    },
    removeItem(_key: string) {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // ignore
      }
    },
  };
}

export const monacoSettingsAtom = atomWithStorage<MonacoEditorSettings>(
  STORAGE_KEY,
  DEFAULT_MONACO_SETTINGS,
  jsonStorage<MonacoEditorSettings>(STORAGE_KEY),
  { getOnInit: true },
);

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 24;
export const TAB_SIZE_OPTIONS = [2, 4, 8] as const;
