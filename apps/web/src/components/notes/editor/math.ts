import type { EditorState, Range } from "@codemirror/state";
import { StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import katex from "katex";
import "katex/dist/katex.min.css";

/**
 * KaTeX rendering for inline `$...$` and block `$$...$$` math. Replaces the
 * raw source with a rendered widget when the cursor isn't inside the span.
 * Falls back to leaving the raw text visible (theme-styled) when active so
 * the user can edit the LaTeX.
 */

class MathWidget extends WidgetType {
  constructor(readonly src: string, readonly block: boolean) {
    super();
  }
  eq(other: MathWidget): boolean {
    return other.src === this.src && other.block === this.block;
  }
  toDOM(): HTMLElement {
    const el = document.createElement(this.block ? "div" : "span");
    el.className = this.block ? "cm-math-block-widget" : "cm-math-widget";
    try {
      katex.render(this.src, el, {
        throwOnError: false,
        displayMode: this.block,
      });
    } catch {
      el.textContent = this.src;
    }
    return el;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

function isCursorInside(state: EditorState, from: number, to: number): boolean {
  for (const range of state.selection.ranges) {
    if (range.from >= from && range.to <= to) return true;
    if (range.from <= from && range.to >= to) return true;
  }
  return false;
}

const BLOCK_RE = /\$\$([^$]+?)\$\$/g;
const INLINE_RE = /(?<!\$)\$([^\n$]+?)\$(?!\$)/g;

function buildDecorations(state: EditorState): DecorationSet {
  const text = state.doc.toString();
  const ranges: Array<Range<Decoration>> = [];

  const occupied: Array<[number, number]> = [];
  const overlaps = (from: number, to: number) =>
    occupied.some(([a, b]) => from < b && to > a);

  let m: RegExpExecArray | null;
  BLOCK_RE.lastIndex = 0;
  while ((m = BLOCK_RE.exec(text)) !== null) {
    const from = m.index;
    const to = from + m[0].length;
    occupied.push([from, to]);
    if (isCursorInside(state, from, to)) continue;
    ranges.push(
      Decoration.replace({ widget: new MathWidget(m[1].trim(), true) }).range(from, to),
    );
  }

  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    const from = m.index;
    const to = from + m[0].length;
    if (overlaps(from, to)) continue;
    if (isCursorInside(state, from, to)) continue;
    ranges.push(
      Decoration.replace({ widget: new MathWidget(m[1].trim(), false) }).range(from, to),
    );
  }

  return Decoration.set(ranges, true);
}

export const mathField = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),
  update: (deco, tr) => {
    if (tr.docChanged || tr.selection) return buildDecorations(tr.state);
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});
