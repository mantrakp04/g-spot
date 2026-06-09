/**
 * Pure, unit-testable fuzzy matcher shared by the file search and command
 * palette. A single term is scored against a target with descending tiers —
 * exact > whole-prefix > word-boundary prefix > contains > initialism >
 * subsequence — and returns the matched character indices so callers can
 * highlight them. Higher-level helpers combine terms (multi-token AND) and
 * weight title matches over secondary fields (e.g. a file's path).
 */

export type FuzzyMatch = {
  score: number;
  /** Sorted, de-duplicated indices into the target that matched. */
  indices: number[];
};

const TIER = {
  exact: 1000,
  prefix: 800,
  wordPrefix: 600,
  contains: 400,
  initialism: 300,
  subsequence: 150,
} as const;

const WORD_BOUNDARY = new Set(["/", "\\", "-", "_", ".", " ", ":"]);

function range(start: number, length: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < length; i++) out.push(start + i);
  return out;
}

function isWordStart(target: string, index: number): boolean {
  if (index === 0) return true;
  return WORD_BOUNDARY.has(target[index - 1] ?? "");
}

function matchInitialism(target: string, term: string): number[] | null {
  const indices: number[] = [];
  let ti = 0;
  for (let i = 0; i < target.length && ti < term.length; i++) {
    if (isWordStart(target, i) && target[i] === term[ti]) {
      indices.push(i);
      ti++;
    }
  }
  return ti === term.length ? indices : null;
}

function matchSubsequence(
  target: string,
  term: string,
): { indices: number[]; gaps: number } | null {
  const indices: number[] = [];
  let ti = 0;
  let gaps = 0;
  let last = -1;
  for (let i = 0; i < target.length && ti < term.length; i++) {
    if (target[i] === term[ti]) {
      if (last >= 0 && i - last > 1) gaps++;
      indices.push(i);
      last = i;
      ti++;
    }
  }
  return ti === term.length ? { indices, gaps } : null;
}

/**
 * Score one already-lowercased `term` against an already-lowercased `target`.
 * Returns null when there's no match at all.
 */
export function matchTerm(target: string, term: string): FuzzyMatch | null {
  if (!term) return { score: 0, indices: [] };
  if (!target) return null;

  if (target === term) return { score: TIER.exact, indices: range(0, term.length) };
  if (target.startsWith(term)) {
    return { score: TIER.prefix, indices: range(0, term.length) };
  }

  for (let i = 1; i < target.length; i++) {
    if (isWordStart(target, i) && target.startsWith(term, i)) {
      return { score: TIER.wordPrefix, indices: range(i, term.length) };
    }
  }

  const contains = target.indexOf(term);
  if (contains >= 0) {
    return { score: TIER.contains, indices: range(contains, term.length) };
  }

  const initial = matchInitialism(target, term);
  if (initial) return { score: TIER.initialism, indices: initial };

  const sub = matchSubsequence(target, term);
  if (sub) return { score: TIER.subsequence - sub.gaps, indices: sub.indices };

  return null;
}

function dedupeSorted(indices: number[]): number[] {
  if (indices.length <= 1) return indices;
  const sorted = [...indices].sort((a, b) => a - b);
  const out: number[] = [];
  for (const i of sorted) {
    if (out[out.length - 1] !== i) out.push(i);
  }
  return out;
}

/** Split a raw query into lowercased, non-empty terms (multi-token AND). */
export function splitQueryTerms(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Score a primary `title` plus optional secondary `keywords` against every
 * term. Every term must match somewhere (AND); title matches dominate, keyword
 * matches are discounted. Returns the matched indices into `title` for
 * highlighting, or null if any term fails to match anywhere.
 */
export function matchEntry(
  title: string,
  keywords: string,
  terms: readonly string[],
): { score: number; titleIndices: number[] } | null {
  if (terms.length === 0) return { score: 0, titleIndices: [] };
  const lowerTitle = title.toLowerCase();
  const lowerKeywords = keywords.toLowerCase();
  let score = 0;
  const titleIndices: number[] = [];

  for (const term of terms) {
    const titleMatch = matchTerm(lowerTitle, term);
    if (titleMatch) {
      score += titleMatch.score;
      titleIndices.push(...titleMatch.indices);
      continue;
    }
    const keywordMatch = lowerKeywords ? matchTerm(lowerKeywords, term) : null;
    if (!keywordMatch) return null;
    score += keywordMatch.score * 0.25;
  }

  // Shorter titles win ties.
  score -= title.length / 1000;
  return { score, titleIndices: dedupeSorted(titleIndices) };
}

export type HighlightSegment = { text: string; match: boolean };

/** Split `text` into matched / unmatched segments for rendering highlights. */
export function toHighlightSegments(
  text: string,
  indices: readonly number[],
): HighlightSegment[] {
  if (indices.length === 0) return [{ text, match: false }];
  const flags = new Set(indices);
  const segments: HighlightSegment[] = [];
  let current = "";
  let currentMatch = flags.has(0);
  for (let i = 0; i < text.length; i++) {
    const isMatch = flags.has(i);
    if (isMatch === currentMatch) {
      current += text[i];
    } else {
      if (current) segments.push({ text: current, match: currentMatch });
      current = text[i] ?? "";
      currentMatch = isMatch;
    }
  }
  if (current) segments.push({ text: current, match: currentMatch });
  return segments;
}
