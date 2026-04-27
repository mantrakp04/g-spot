/**
 * Tiny YAML-frontmatter parser for the Obsidian-style block at the top of
 * a note:
 *
 *     ---
 *     aliases: [Alt Title, Other]
 *     tags:
 *       - one
 *       - two
 *     created: 2024-01-01
 *     ---
 *
 * Only handles the dialect we actually emit/consume — strings, scalar
 * key:value pairs, inline arrays `[a, b]`, and bullet-list arrays. Anything
 * fancier (nested objects, anchors, multi-line scalars) is intentionally
 * out of scope; if a note's frontmatter doesn't parse, we just skip it.
 */

export interface ParsedFrontmatter {
  data: Record<string, string | string[]>;
  body: string;
  /** Length of the frontmatter block including delimiters + trailing newline. */
  bodyOffset: number;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseScalar(value: string): string {
  let v = value.trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  else if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
  return v;
}

function parseInlineArray(value: string): string[] {
  // `[a, b, c]` — split by comma, strip quotes per element. Doesn't
  // handle commas inside quoted strings; live with it.
  const inner = value.trim().slice(1, -1);
  if (!inner.trim()) return [];
  return inner.split(",").map((part) => parseScalar(part)).filter(Boolean);
}

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) return { data: {}, body: content, bodyOffset: 0 };

  const block = match[1];
  const lines = block.split(/\r?\n/);
  const data: Record<string, string | string[]> = {};

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i++;
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) {
      i++;
      continue;
    }
    const key = kv[1];
    const rest = kv[2].trim();
    if (rest.startsWith("[") && rest.endsWith("]")) {
      data[key] = parseInlineArray(rest);
      i++;
      continue;
    }
    if (rest === "") {
      // Bullet-list value on subsequent lines.
      const items: string[] = [];
      i++;
      while (i < lines.length) {
        const next = lines[i] ?? "";
        const bullet = /^\s*-\s+(.*)$/.exec(next);
        if (!bullet) break;
        items.push(parseScalar(bullet[1]));
        i++;
      }
      data[key] = items;
      continue;
    }
    data[key] = parseScalar(rest);
    i++;
  }

  return {
    data,
    body: content.slice(match[0].length),
    bodyOffset: match[0].length,
  };
}

export function extractAliases(content: string): string[] {
  const { data } = parseFrontmatter(content);
  const value = data.aliases;
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return [String(value)];
}

export function extractFrontmatterTags(content: string): string[] {
  const { data } = parseFrontmatter(content);
  const value = data.tags;
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value)
    .split(/[,\s]+/)
    .filter(Boolean);
}
