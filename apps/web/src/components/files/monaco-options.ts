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
  // --- Per-scroll paint reduction ---------------------------------------
  // Monaco is VSCode's editor core, so the render loop is identical. The FPS
  // gap vs desktop VSCode comes from the host: Electrobun runs on the system
  // WebView (WKWebView), which is far more sensitive to per-frame repaints and
  // composited layers than Chromium/Electron. These trim work on every scroll
  // frame without changing the file editor's appearance.
  //
  // Shadows are redrawn on every scroll frame to fake the scroll-edge fade —
  // pure overdraw on a webview. Off = one fewer repaint per frame.
  scrollbar: { useShadows: false },
  // Wheel animation adds latency and an extra rAF render per scroll; VSCode
  // ships this off by default too. Explicit so it can't drift on.
  smoothScrolling: false,
  // Sticky scroll recomputes the pinned header and overlays a widget on every
  // scroll tick. We don't surface it, so keep it fully off.
  stickyScroll: { enabled: false },
  // SVG whitespace glyphs composite cheaper than the font-based path.
  experimentalWhitespaceRendering: "svg",
  // Active-indent highlighting re-walks indentation on every cursor move for a
  // guide most users never look at. Drop the recompute, keep the static guides.
  guides: { highlightActiveIndentation: false },
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
