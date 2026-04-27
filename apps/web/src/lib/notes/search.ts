import type { Note } from "@g-spot/types";

/**
 * Tiny Obsidian-style search query language.
 *
 * Recognised operators:
 *   path:foo      — filename's path (folder chain) contains "foo"
 *   file:foo      — note title contains "foo"
 *   tag:foo       — note has the inline tag #foo
 *   line:foo      — some line in the body contains "foo"
 *   section:foo   — note has a heading containing "foo"
 *
 * Anything outside of an operator is a free-text term, matched against the
 * note's title or content. Operators stack (AND); multiple free-text terms
 * are also AND'd. Quoted strings ("multi word") are kept as one term.
 */

export interface ParsedQuery {
  path: string[];
  file: string[];
  tag: string[];
  line: string[];
  section: string[];
  terms: string[];
}

const OPERATORS = ["path", "file", "tag", "line", "section"] as const;
type Operator = (typeof OPERATORS)[number];

export function parseQuery(input: string): ParsedQuery {
  const out: ParsedQuery = {
    path: [],
    file: [],
    tag: [],
    line: [],
    section: [],
    terms: [],
  };
  // Tokenize: respect double-quoted strings.
  const tokens: string[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    if (ch === '"') {
      const close = input.indexOf('"', i + 1);
      if (close === -1) {
        tokens.push(input.slice(i + 1));
        break;
      }
      tokens.push(input.slice(i + 1, close));
      i = close + 1;
      continue;
    }
    let j = i;
    while (j < input.length && input[j] !== " " && input[j] !== "\t") j++;
    tokens.push(input.slice(i, j));
    i = j;
  }
  for (const tok of tokens) {
    const colon = tok.indexOf(":");
    if (colon > 0) {
      const op = tok.slice(0, colon).toLowerCase() as Operator;
      const val = tok.slice(colon + 1);
      if (OPERATORS.includes(op) && val) {
        out[op].push(val);
        continue;
      }
    }
    if (tok) out.terms.push(tok);
  }
  return out;
}

function notePath(
  note: Note,
  byId: Map<string, Note>,
): string {
  const parts: string[] = [];
  let cur: Note | undefined = note;
  while (cur) {
    parts.unshift(cur.title);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return parts.join("/");
}

const TAG_INLINE_RE = /(^|[^\w/#])#([\w\-/]+)/g;
const HEADING_RE = /^#{1,6}\s+(.*)$/gm;

function contains(haystack: string, needle: string, caseSensitive: boolean) {
  if (caseSensitive) return haystack.includes(needle);
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function matchNote(
  note: Note,
  query: ParsedQuery,
  byId: Map<string, Note>,
  caseSensitive: boolean,
): boolean {
  if (note.kind !== "note") return false;
  if (query.path.length > 0) {
    const path = notePath(note, byId);
    for (const v of query.path) if (!contains(path, v, caseSensitive)) return false;
  }
  if (query.file.length > 0) {
    for (const v of query.file)
      if (!contains(note.title, v, caseSensitive)) return false;
  }
  if (query.tag.length > 0) {
    const tags = new Set<string>();
    TAG_INLINE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TAG_INLINE_RE.exec(note.content)) !== null) {
      if (m[2]) tags.add(caseSensitive ? m[2] : m[2].toLowerCase());
    }
    for (const v of query.tag)
      if (!tags.has(caseSensitive ? v : v.toLowerCase())) return false;
  }
  if (query.line.length > 0) {
    const lines = note.content.split("\n");
    for (const v of query.line) {
      if (!lines.some((ln) => contains(ln, v, caseSensitive))) return false;
    }
  }
  if (query.section.length > 0) {
    const headings: string[] = [];
    HEADING_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = HEADING_RE.exec(note.content)) !== null) {
      if (m[1]) headings.push(m[1]);
    }
    for (const v of query.section) {
      if (!headings.some((h) => contains(h, v, caseSensitive))) return false;
    }
  }
  if (query.terms.length > 0) {
    const hay = `${note.title}\n${note.content}`;
    for (const v of query.terms)
      if (!contains(hay, v, caseSensitive)) return false;
  }
  return true;
}

export function isEmpty(query: ParsedQuery): boolean {
  return (
    query.path.length === 0 &&
    query.file.length === 0 &&
    query.tag.length === 0 &&
    query.line.length === 0 &&
    query.section.length === 0 &&
    query.terms.length === 0
  );
}
