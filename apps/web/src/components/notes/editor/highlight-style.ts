import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * Token-level highlight palette for code embedded in fenced blocks. Scoped
 * to programming-language tags only — markdown-syntax tokens (headings,
 * emphasis, lists) are handled by the live-preview field, so we don't list
 * them here. That avoids surprises like the heading `#` marks getting
 * underlined when `defaultHighlightStyle` was used.
 *
 * Colors flow through CSS custom properties so the same palette adapts to
 * light/dark/tweakcn themes.
 */
export const noteEditorHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "var(--chart-1, #c084fc)" },
  { tag: [t.controlKeyword, t.moduleKeyword, t.definitionKeyword], color: "var(--chart-1, #c084fc)" },
  { tag: [t.string, t.special(t.string)], color: "var(--chart-2, #4ade80)" },
  { tag: [t.number, t.bool, t.null], color: "var(--chart-3, #fbbf24)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--chart-4, #60a5fa)" },
  { tag: [t.className, t.typeName, t.namespace], color: "var(--chart-5, #fb923c)" },
  { tag: [t.propertyName, t.attributeName], color: "var(--chart-4, #60a5fa)" },
  { tag: [t.variableName, t.labelName], color: "var(--foreground)" },
  { tag: [t.operator, t.punctuation, t.bracket, t.paren, t.brace], color: "var(--muted-foreground)" },
  { tag: [t.tagName], color: "var(--chart-1, #c084fc)" },
  { tag: [t.regexp], color: "var(--chart-2, #4ade80)" },
  { tag: [t.escape], color: "var(--chart-3, #fbbf24)" },
  { tag: [t.meta, t.processingInstruction], color: "var(--muted-foreground)" },
  { tag: [t.invalid], color: "var(--destructive)" },
]);
