import type * as monaco from "monaco-editor";

import type { MonacoEditorSettings } from "./monaco-settings-store";

export const baseEditorOptions = {
  fontSize: 13,
  tabSize: 2,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  renderWhitespace: "selection",
  automaticLayout: true,
  largeFileOptimizations: true,
  // Heavy per-edit work that Monaco standalone can't do well without a
  // project context (no tsconfig, no node_modules). Cheaper to leave off.
  folding: false,
  bracketPairColorization: { enabled: false },
  occurrencesHighlight: "off",
  renderValidationDecorations: "off",
} satisfies monaco.editor.IStandaloneEditorConstructionOptions;

export function buildEditorOptions(
  settings: MonacoEditorSettings,
): monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    ...baseEditorOptions,
    fontSize: settings.fontSize,
    tabSize: settings.tabSize,
    wordWrap: settings.wordWrap,
    minimap: { enabled: settings.minimap },
    lineNumbers: settings.lineNumbers ? "on" : "off",
    renderWhitespace: settings.renderWhitespace,
  };
}
