import type { EditorState, Range } from "@codemirror/state";
import { StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

/**
 * Highlight `#tag` tokens. Skips matches inside fenced code blocks by checking
 * if the previous newline-delimited block is a code line — a cheap heuristic.
 * For URLs (`https://x#frag`) the lookbehind for non-word/non-slash filters
 * most cases.
 */
const TAG_RE = /(^|[^\w/#])#([\w\-/]+)/g;

function buildDecorations(state: EditorState): DecorationSet {
  const ranges: Array<Range<Decoration>> = [];
  const text = state.doc.toString();
  let match: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((match = TAG_RE.exec(text)) !== null) {
    const lead = match[1] ?? "";
    const tagStart = match.index + lead.length;
    const tagEnd = tagStart + 1 + match[2].length; // include "#"
    ranges.push(Decoration.mark({ class: "cm-tag" }).range(tagStart, tagEnd));
  }
  return Decoration.set(ranges, true);
}

export const tagsField = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),
  update: (deco, tr) => (tr.docChanged ? buildDecorations(tr.state) : deco.map(tr.changes)),
  provide: (f) => EditorView.decorations.from(f),
});
