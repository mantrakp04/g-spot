import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import mermaid from "mermaid";

/**
 * Render fenced ```mermaid``` code blocks as SVG diagrams when the cursor is
 * outside the block. Mermaid initializes once with `securityLevel: 'loose'`
 * so callers can render without a host page CSP override; diagrams are
 * rendered async — the widget swaps in the SVG when ready.
 */

let mermaidInitializedTheme: "dark" | "default" | null = null;
function ensureMermaidInitialized() {
  const wantDark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark");
  const wantTheme: "dark" | "default" = wantDark ? "dark" : "default";
  if (mermaidInitializedTheme === wantTheme) return;
  mermaidInitializedTheme = wantTheme;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    theme: wantTheme,
  });
}

let counter = 0;

class MermaidWidget extends WidgetType {
  constructor(readonly src: string) {
    super();
  }
  eq(other: MermaidWidget): boolean {
    return other.src === this.src;
  }
  toDOM(): HTMLElement {
    ensureMermaidInitialized();
    const el = document.createElement("div");
    el.className = "cm-mermaid-widget";
    el.textContent = "rendering…";
    const id = `cm-mermaid-${++counter}`;
    mermaid
      .render(id, this.src)
      .then(({ svg }) => {
        el.innerHTML = svg;
      })
      .catch((err) => {
        el.innerHTML = `<pre style="color:#ef4444;text-align:left;font-size:12px">${String(err?.message ?? err)}</pre>`;
      });
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

function buildDecorations(state: EditorState): DecorationSet {
  const ranges: Array<Range<Decoration>> = [];
  const tree = syntaxTree(state);
  const doc = state.doc;
  tree.iterate({
    enter: (node) => {
      if (node.name !== "FencedCode") return;
      const text = doc.sliceString(node.from, node.to);
      const m = /^```(\w+)\s*\n([\s\S]*?)\n?```\s*$/.exec(text);
      if (!m) return;
      const lang = m[1];
      if (lang !== "mermaid") return;
      if (isCursorInside(state, node.from, node.to)) return;
      const src = m[2];
      ranges.push(
        Decoration.replace({ widget: new MermaidWidget(src), block: true }).range(
          node.from,
          node.to,
        ),
      );
    },
  });
  return Decoration.set(ranges, true);
}

export const mermaidField = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),
  update: (deco, tr) => {
    if (tr.docChanged || tr.selection) return buildDecorations(tr.state);
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});
