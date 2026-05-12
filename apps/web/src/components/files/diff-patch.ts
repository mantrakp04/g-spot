import type * as monaco from "monaco-editor";

export type DiffMode = "uncommitted" | "staged" | "unstaged";

export type HunkLineChange = monaco.editor.ILineChange;

export type HunkLine =
  | { kind: "context"; text: string; origLine: number; modLine: number }
  | { kind: "del"; text: string; origLine: number }
  | { kind: "add"; text: string; modLine: number };

type BuildArgs = {
  path: string;
  hunk: HunkLineChange;
  originalLines: string[]; // 1-indexed via [i-1]
  modifiedLines: string[];
};

/**
 * Materialize a hunk into ordered del/add lines. Monaco's ILineChange gives
 * line ranges per side; with no charChanges we treat each side's range as a
 * block of - then + lines (matching `git diff -U0` style).
 */
export function expandHunkLines(args: BuildArgs): HunkLine[] {
  const { hunk, originalLines, modifiedLines } = args;
  const out: HunkLine[] = [];
  // Pure deletion: originalEndLineNumber > 0, modifiedEndLineNumber === 0
  if (hunk.originalEndLineNumber > 0) {
    for (
      let i = hunk.originalStartLineNumber;
      i <= hunk.originalEndLineNumber;
      i++
    ) {
      out.push({
        kind: "del",
        text: originalLines[i - 1] ?? "",
        origLine: i,
      });
    }
  }
  if (hunk.modifiedEndLineNumber > 0) {
    for (
      let i = hunk.modifiedStartLineNumber;
      i <= hunk.modifiedEndLineNumber;
      i++
    ) {
      out.push({
        kind: "add",
        text: modifiedLines[i - 1] ?? "",
        modLine: i,
      });
    }
  }
  return out;
}

function pathHeader(path: string): string {
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n`;
}

function buildHunkPatchFromLines(
  path: string,
  origStart: number,
  modStart: number,
  lines: HunkLine[],
): string {
  const dels = lines.filter((l) => l.kind === "del").length;
  const adds = lines.filter((l) => l.kind === "add").length;
  // git apply --unidiff-zero: header counts must match line counts; when count
  // is zero git expects start to be the line BEFORE the change (0 if file
  // empty). Monaco gives originalStartLineNumber as the line before for pure
  // additions (and equivalent for deletions on the modified side), which is
  // exactly what we want.
  const header = `@@ -${origStart},${dels} +${modStart},${adds} @@\n`;
  const body = lines
    .map((l) => (l.kind === "del" ? `-${l.text}` : `+${l.text}`))
    .join("\n");
  return `${pathHeader(path)}${header}${body}\n`;
}

/** Full-hunk patch (right side is target). */
export function buildHunkPatch(args: BuildArgs): string {
  const lines = expandHunkLines(args);
  const dels = lines.filter((l) => l.kind === "del").length;
  const adds = lines.filter((l) => l.kind === "add").length;
  const origStart = dels === 0
    ? args.hunk.originalStartLineNumber
    : args.hunk.originalStartLineNumber;
  const modStart = adds === 0
    ? args.hunk.modifiedStartLineNumber
    : args.hunk.modifiedStartLineNumber;
  return buildHunkPatchFromLines(args.path, origStart, modStart, lines);
}

export type SelectionPatchArgs = BuildArgs & {
  /** Side the selection lives on: "modified" (right) selects + lines, "original" (left) selects - lines. */
  side: "modified" | "original";
  selectionStartLine: number;
  selectionEndLine: number;
};

/**
 * Filter hunk lines down to those overlapping the selection range on the given
 * side. For unstaging or reverting, the user typically selects on the
 * modified (right) side and we keep matching + lines plus all - lines from the
 * hunk would over-revert; instead we keep ONLY the + lines in range and pair
 * with their corresponding - lines (best-effort: we drop -lines whose row is
 * outside the selection's row equivalents). For the simple, predictable
 * behavior used by VSCode: per-line selections on either side filter that
 * side's lines, leaving the opposite side untouched is invalid for git; so we
 * pair each kept line with its same-position counterpart only if the user's
 * selection covers it.
 *
 * Returns null if the selection contains no +/- lines.
 */
export function buildSelectionPatch(args: SelectionPatchArgs): string | null {
  const all = expandHunkLines(args);
  const inRange = (l: HunkLine): boolean => {
    if (args.side === "modified") {
      if (l.kind === "add") {
        return (
          l.modLine >= args.selectionStartLine &&
          l.modLine <= args.selectionEndLine
        );
      }
      // deletions don't have a modified line — include them only if the
      // selection straddles the hunk boundary on that side.
      return false;
    }
    if (l.kind === "del") {
      return (
        l.origLine >= args.selectionStartLine &&
        l.origLine <= args.selectionEndLine
      );
    }
    return false;
  };

  const kept = all.filter(inRange);
  if (kept.length === 0) return null;

  // For partial selections on the modified side, we keep ONLY selected + lines
  // and ALL - lines from the hunk (so the patch reverts/stages exactly the
  // selected additions while replacing the original block faithfully). This
  // matches VSCode's "Stage Selected Ranges" semantics for split-view diffs.
  let lines: HunkLine[];
  if (args.side === "modified") {
    const dels = all.filter((l) => l.kind === "del");
    lines = [...dels, ...kept];
  } else {
    const adds = all.filter((l) => l.kind === "add");
    lines = [...kept, ...adds];
  }

  return buildHunkPatchFromLines(
    args.path,
    args.hunk.originalStartLineNumber,
    args.hunk.modifiedStartLineNumber,
    lines,
  );
}

export type HunkActionFlags = { cached: boolean; reverse: boolean };

export function flagsForAction(
  mode: DiffMode,
  action: "stage" | "unstage" | "revert",
): HunkActionFlags {
  if (action === "stage") return { cached: true, reverse: false };
  if (action === "unstage") return { cached: true, reverse: true };
  return { cached: false, reverse: true };
}

export function actionsForMode(
  mode: DiffMode,
): Array<"stage" | "unstage" | "revert"> {
  if (mode === "staged") return ["unstage"];
  if (mode === "unstaged") return ["stage", "revert"];
  return ["stage", "revert"];
}
