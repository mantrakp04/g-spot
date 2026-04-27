import { EditorView } from "@codemirror/view";

/**
 * Theme-aware visual layer for the note editor. Everything color-related
 * resolves through the app's CSS custom properties (`--foreground`,
 * `--primary`, `--muted`, etc.) so light/dark/tweakcn themes apply without
 * an extra hook. Callout and tag accents use `color-mix()` over the design
 * tokens (`--destructive`, `--primary`) so they match the active theme
 * instead of locked-in hex values.
 */
export const noteEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "15px",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif',
    background: "transparent",
    color: "var(--foreground)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "inherit",
    lineHeight: "1.7",
    padding: "2rem 3rem 6rem",
  },
  ".cm-content": {
    maxWidth: "780px",
    margin: "0 auto",
    caretColor: "var(--foreground)",
  },
  ".cm-line": { padding: "0 2px" },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--foreground)",
  },
  // CodeMirror's drawSelection paints `.cm-selectionBackground` behind text;
  // the native `::selection` is the fallback. Use a clearly-visible accent
  // (color-mix against --primary at high opacity) so the highlight reads on
  // both light and dark themes without washing the text.
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    background: "color-mix(in srgb, var(--primary) 45%, transparent) !important",
  },
  ".cm-content ::selection, ::selection": {
    background: "color-mix(in srgb, var(--primary) 45%, transparent)",
    color: "var(--foreground)",
  },
  ".cm-gutters": {
    background: "transparent",
    border: "none",
    color: "var(--muted-foreground)",
  },
  // Headings — sizing only; color inherits from theme.
  ".cm-line.cm-heading-1": {
    fontSize: "2.1em",
    fontWeight: "700",
    lineHeight: "1.25",
    margin: "0.5em 0 0.2em",
  },
  ".cm-line.cm-heading-2": {
    fontSize: "1.65em",
    fontWeight: "700",
    lineHeight: "1.3",
    margin: "0.5em 0 0.15em",
  },
  ".cm-line.cm-heading-3": {
    fontSize: "1.35em",
    fontWeight: "600",
    margin: "0.4em 0 0.1em",
  },
  ".cm-line.cm-heading-4": { fontSize: "1.2em", fontWeight: "600" },
  ".cm-line.cm-heading-5": { fontSize: "1.1em", fontWeight: "600" },
  ".cm-line.cm-heading-6": { fontSize: "1em", fontWeight: "600", opacity: "0.85" },
  // Inline marks
  ".cm-strong": { fontWeight: "700" },
  ".cm-emphasis": { fontStyle: "italic" },
  ".cm-strikethrough": { textDecoration: "line-through", opacity: "0.7" },
  ".cm-inline-code": {
    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    fontSize: "0.9em",
    background: "var(--muted)",
    color: "var(--foreground)",
    padding: "0.1em 0.35em",
    borderRadius: "4px",
  },
  // Syntax marks: muted on the active editing line, collapsed elsewhere.
  ".cm-syntax-mark": {
    color: "var(--muted-foreground)",
    opacity: "0.45",
    fontWeight: "normal",
  },
  ".cm-syntax-mark-hidden": { fontSize: "0", letterSpacing: "0" },
  // Block quote / callouts.
  ".cm-line.cm-blockquote": {
    borderLeft: "3px solid var(--border)",
    paddingLeft: "0.75em",
    color: "var(--muted-foreground)",
  },
  ".cm-line.cm-callout-note": {
    borderLeft: "3px solid var(--primary)",
    background: "color-mix(in srgb, var(--primary) 8%, transparent)",
    paddingLeft: "0.75em",
  },
  ".cm-line.cm-callout-warning": {
    borderLeft: "3px solid #f59e0b",
    background: "color-mix(in srgb, #f59e0b 10%, transparent)",
    paddingLeft: "0.75em",
  },
  ".cm-line.cm-callout-danger": {
    borderLeft: "3px solid var(--destructive)",
    background: "color-mix(in srgb, var(--destructive) 10%, transparent)",
    paddingLeft: "0.75em",
  },
  ".cm-line.cm-callout-tip": {
    borderLeft: "3px solid #10b981",
    background: "color-mix(in srgb, #10b981 10%, transparent)",
    paddingLeft: "0.75em",
  },
  // Code block.
  ".cm-line.cm-codeblock": {
    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    fontSize: "0.9em",
    background: "var(--muted)",
  },
  // Wikilinks + tags. No underline by default — Obsidian uses a colored
  // weight cue, not a heavy underline.
  ".cm-wikilink": {
    color: "var(--primary)",
    cursor: "pointer",
  },
  ".cm-wikilink:hover": { textDecoration: "underline" },
  ".cm-wikilink-unresolved": {
    color: "var(--muted-foreground)",
    textDecoration: "underline dashed",
    textUnderlineOffset: "3px",
    cursor: "pointer",
  },
  ".cm-tag": {
    color: "var(--primary)",
    background: "color-mix(in srgb, var(--primary) 12%, transparent)",
    padding: "0 0.3em",
    borderRadius: "4px",
  },
  // Hidden mark utility.
  ".cm-hidden": { display: "none" },
  // Math / mermaid / image widgets.
  ".cm-math-widget": { display: "inline-block", padding: "0 0.15em" },
  ".cm-math-block-widget": {
    display: "block",
    padding: "0.5em 0",
    textAlign: "center",
  },
  ".cm-mermaid-widget": {
    display: "block",
    padding: "0.5em 0",
    textAlign: "center",
  },
  ".cm-image-widget": {
    display: "block",
    padding: "0.5em 0",
    textAlign: "center",
  },
  ".cm-image-widget img": { maxWidth: "100%", borderRadius: "6px" },
  ".cm-hr-widget": {
    display: "block",
    borderTop: "1px solid var(--border)",
    margin: "0.6em 0",
    height: "0",
  },
});
