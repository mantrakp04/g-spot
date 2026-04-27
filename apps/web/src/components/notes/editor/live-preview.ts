import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

/**
 * Obsidian-style live preview: walk the markdown syntax tree and apply
 * decorations that
 *  - hide raw syntax marks (`#`, `*`, `_`, ` ``` `, `> `, etc.) on lines that
 *    aren't actively being edited.
 *  - on the active editing line, render those marks at muted color so they're
 *    visible-but-quiet while you type.
 *  - tag heading / blockquote / code-block lines so the theme can size them.
 *  - apply inline classes for emphasis / strong / strikethrough / inline code.
 *
 * The "active editing line" is *not* simply the line under the caret — it's
 * the line where the user most recently typed. Clicking into a line keeps it
 * in preview mode; only typing reveals the raw markers, and only on that one
 * line. Moving the caret to a different line via arrow keys / mouse without
 * typing collapses the previously-revealed line back to preview.
 */

const HIDDEN_MARK = Decoration.mark({
  class: "cm-syntax-mark cm-syntax-mark-hidden",
});
const SHOWN_MARK = Decoration.mark({ class: "cm-syntax-mark" });

const STRONG = Decoration.mark({ class: "cm-strong" });
const EMPHASIS = Decoration.mark({ class: "cm-emphasis" });
const STRIKE = Decoration.mark({ class: "cm-strikethrough" });
const INLINE_CODE = Decoration.mark({ class: "cm-inline-code" });

const HEADING_LINES = [
  Decoration.line({ class: "cm-heading-1" }),
  Decoration.line({ class: "cm-heading-2" }),
  Decoration.line({ class: "cm-heading-3" }),
  Decoration.line({ class: "cm-heading-4" }),
  Decoration.line({ class: "cm-heading-5" }),
  Decoration.line({ class: "cm-heading-6" }),
];
const BLOCKQUOTE_LINE = Decoration.line({ class: "cm-blockquote" });
const CODEBLOCK_LINE = Decoration.line({ class: "cm-codeblock" });

/**
 * Tracks the line the user is currently *editing* (most recent docChanged).
 * Cleared when the cursor moves to a different line without typing.
 */
export const editingLineField = StateField.define<number | null>({
  create: () => null,
  update(prev, tr) {
    if (tr.docChanged) {
      const head = tr.state.selection.main.head;
      return tr.state.doc.lineAt(head).number;
    }
    if (tr.selection) {
      if (prev === null) return null;
      const head = tr.state.selection.main.head;
      const line = tr.state.doc.lineAt(head).number;
      return line === prev ? prev : null;
    }
    return prev;
  },
});

function buildDecorations(state: EditorState): DecorationSet {
  // Two passes — block (line) decorations first, then inline. CM6 requires
  // line decorations to be added in document order before inline marks.
  const lineDecos: Array<Range<Decoration>> = [];
  const markDecos: Array<Range<Decoration>> = [];
  const tree = syntaxTree(state);
  const editingLine = state.field(editingLineField);
  const doc = state.doc;
  const isEditing = (n: number) => editingLine === n;
  const markFor = (n: number) => (isEditing(n) ? SHOWN_MARK : HIDDEN_MARK);

  tree.iterate({
    enter: (node) => {
      const name = node.name;

      // ATX headings: ATXHeading1..ATXHeading6
      const headingMatch = /^ATXHeading([1-6])$/.exec(name);
      if (headingMatch) {
        const level = Number(headingMatch[1]);
        const line = doc.lineAt(node.from);
        lineDecos.push(HEADING_LINES[level - 1].range(line.from));
        const text = doc.sliceString(line.from, line.from + level + 1);
        if (text.startsWith("#".repeat(level))) {
          const markEnd =
            line.from + level + (text[level] === " " ? 1 : 0);
          if (markEnd > line.from) {
            markDecos.push(markFor(line.number).range(line.from, markEnd));
          }
        }
        return;
      }

      switch (name) {
        case "Blockquote": {
          const startLine = doc.lineAt(node.from).number;
          const endLine = doc.lineAt(node.to).number;
          for (let i = startLine; i <= endLine; i++) {
            const line = doc.line(i);
            // Detect callout via first line — > [!note] / [!warning] / etc.
            if (i === startLine) {
              const m = /^>\s*\[!(\w+)\]/.exec(line.text);
              if (m) {
                const variant = m[1].toLowerCase();
                const cls =
                  variant === "warning" || variant === "warn"
                    ? "cm-callout-warning"
                    : variant === "danger" || variant === "error"
                      ? "cm-callout-danger"
                      : variant === "tip" || variant === "success"
                        ? "cm-callout-tip"
                        : "cm-callout-note";
                lineDecos.push(Decoration.line({ class: cls }).range(line.from));
                continue;
              }
            }
            lineDecos.push(BLOCKQUOTE_LINE.range(line.from));
            if (line.text.startsWith(">")) {
              const m = /^>\s?/.exec(line.text);
              if (m) {
                markDecos.push(
                  markFor(i).range(line.from, line.from + m[0].length),
                );
              }
            }
          }
          return;
        }
        case "FencedCode": {
          const startLine = doc.lineAt(node.from).number;
          const endLine = doc.lineAt(node.to).number;
          for (let i = startLine; i <= endLine; i++) {
            const line = doc.line(i);
            lineDecos.push(CODEBLOCK_LINE.range(line.from));
          }
          return;
        }
        case "InlineCode": {
          markDecos.push(INLINE_CODE.range(node.from, node.to));
          const line = doc.lineAt(node.from);
          const text = doc.sliceString(node.from, node.to);
          const open = /^`+/.exec(text)?.[0] ?? "";
          const close = /`+$/.exec(text)?.[0] ?? "";
          const m = markFor(line.number);
          if (open) markDecos.push(m.range(node.from, node.from + open.length));
          if (close) markDecos.push(m.range(node.to - close.length, node.to));
          return;
        }
        case "StrongEmphasis": {
          markDecos.push(STRONG.range(node.from, node.to));
          const line = doc.lineAt(node.from);
          const m = markFor(line.number);
          markDecos.push(m.range(node.from, node.from + 2));
          markDecos.push(m.range(node.to - 2, node.to));
          return;
        }
        case "Emphasis": {
          markDecos.push(EMPHASIS.range(node.from, node.to));
          const line = doc.lineAt(node.from);
          const m = markFor(line.number);
          markDecos.push(m.range(node.from, node.from + 1));
          markDecos.push(m.range(node.to - 1, node.to));
          return;
        }
        case "Strikethrough": {
          markDecos.push(STRIKE.range(node.from, node.to));
          const line = doc.lineAt(node.from);
          const m = markFor(line.number);
          markDecos.push(m.range(node.from, node.from + 2));
          markDecos.push(m.range(node.to - 2, node.to));
          return;
        }
        case "ListMark": {
          // Bullets are integral to the rendered look — leave alone.
          return;
        }
      }
    },
  });

  return Decoration.set([...lineDecos, ...markDecos], true);
}

export const livePreviewField = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),
  update: (deco, tr) => {
    if (tr.docChanged || tr.selection) return buildDecorations(tr.state);
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});
