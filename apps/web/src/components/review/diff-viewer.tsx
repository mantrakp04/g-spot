import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
  MessageSquare,
  Plus,
  Search,
  ChevronsUpDown,
} from "lucide-react";
import type { BundledLanguage, ThemedToken } from "shiki";
import { createHighlighter, type HighlighterGeneric } from "shiki";
import type { OAuthConnection } from "@stackframe/react";

import { Skeleton } from "@g-spot/ui/components/skeleton";

import type { ReviewComment, ReviewTarget } from "@/hooks/use-github-detail";
import {
  useGitHubFileContents,
  useMarkFileViewed,
} from "@/hooks/use-github-detail";
import {
  useActiveCompose,
  usePendingComments,
  type PendingCommentsKey,
} from "@/hooks/use-pending-comments";
import { mergeRefs } from "@/lib/merge-refs";

import { InlineComposer } from "./inline-composer";
import { InlineThread } from "./inline-thread";
import { useDiffSettings } from "./diff-settings";

export type PRFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  sha: string;
  viewed_state?: "viewed" | "unviewed" | "dismissed";
};

export type DiffMode = "unified" | "split";

type HunkLine = {
  kind: "hunk";
  text: string;
  /** Starting line in the new (head) file. */
  newStart: number;
  /** Starting line in the old (base) file. */
  oldStart: number;
};
type CodeLine = {
  kind: "context" | "added" | "removed";
  oldNum: number | null;
  newNum: number | null;
  text: string;
};
type ParsedLine = HunkLine | CodeLine;

type SplitRow =
  | { kind: "hunk"; text: string }
  | {
      kind: "pair";
      left: CodeLine | null;
      right: CodeLine | null;
    };

function parsePatch(patch: string): ParsedLine[] {
  const lines: ParsedLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (m) {
        oldLine = Number(m[1]);
        newLine = Number(m[2]);
      }
      lines.push({
        kind: "hunk",
        text: raw,
        oldStart: oldLine,
        newStart: newLine,
      });
      continue;
    }
    const c = raw[0];
    const text = raw.slice(1);
    if (c === "+") {
      lines.push({ kind: "added", oldNum: null, newNum: newLine++, text });
    } else if (c === "-") {
      lines.push({ kind: "removed", oldNum: oldLine++, newNum: null, text });
    } else {
      lines.push({ kind: "context", oldNum: oldLine++, newNum: newLine++, text });
    }
  }
  return lines;
}

/** Remove pure-whitespace-only add/remove pairs (noisy formatting changes). */
function filterWhitespaceOnly(lines: ParsedLine[]): ParsedLine[] {
  const out: ParsedLine[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    if (l.kind !== "removed") {
      out.push(l);
      i++;
      continue;
    }
    const removed: CodeLine[] = [];
    const added: CodeLine[] = [];
    while (i < lines.length && lines[i]!.kind === "removed") {
      removed.push(lines[i] as CodeLine);
      i++;
    }
    while (i < lines.length && lines[i]!.kind === "added") {
      added.push(lines[i] as CodeLine);
      i++;
    }
    const norm = (s: string) => s.replace(/\s+/g, "");
    const keep: { rem: CodeLine[]; add: CodeLine[] } = { rem: [], add: [] };
    const max = Math.max(removed.length, added.length);
    for (let k = 0; k < max; k++) {
      const r = removed[k];
      const a = added[k];
      if (r && a && norm(r.text) === norm(a.text)) {
        // Collapse to a single context line.
        out.push({
          kind: "context",
          oldNum: r.oldNum,
          newNum: a.newNum,
          text: a.text,
        });
      } else {
        if (r) keep.rem.push(r);
        if (a) keep.add.push(a);
      }
    }
    out.push(...keep.rem, ...keep.add);
  }
  return out;
}

type Gap = {
  /** Index into parsed of the hunk this gap precedes. */
  hunkIndex: number;
  /** New-file line range [newFrom, newTo) of the hidden window. */
  newFrom: number;
  newTo: number;
  /** Old-file line range. */
  oldFrom: number;
  oldTo: number;
};

function computeGaps(parsed: ParsedLine[]): Gap[] {
  const gaps: Gap[] = [];
  let prevNewEnd = 1; // New file lines seen so far (start of file = 1).
  let prevOldEnd = 1;
  // Track last seen line numbers as we walk through parsed content.
  let trackingNew = 1;
  let trackingOld = 1;
  let sawAnyHunk = false;

  for (let i = 0; i < parsed.length; i++) {
    const l = parsed[i]!;
    if (l.kind === "hunk") {
      if (!sawAnyHunk) {
        if (l.newStart > 1) {
          gaps.push({
            hunkIndex: i,
            newFrom: 1,
            newTo: l.newStart,
            oldFrom: 1,
            oldTo: l.oldStart,
          });
        }
        sawAnyHunk = true;
      } else if (l.newStart > prevNewEnd) {
        gaps.push({
          hunkIndex: i,
          newFrom: prevNewEnd,
          newTo: l.newStart,
          oldFrom: prevOldEnd,
          oldTo: l.oldStart,
        });
      }
      trackingNew = l.newStart;
      trackingOld = l.oldStart;
      continue;
    }
    if (l.newNum != null) trackingNew = l.newNum + 1;
    if (l.oldNum != null) trackingOld = l.oldNum + 1;
    prevNewEnd = trackingNew;
    prevOldEnd = trackingOld;
  }
  return gaps;
}

export type RenderRow =
  | { kind: "line"; line: ParsedLine }
  | {
      kind: "gap";
      hunkIndex: number;
      missingCount: number;
    };

function weaveRows(
  parsed: ParsedLine[],
  gaps: Gap[],
  expanded: Set<number>,
  fileContents: string | null,
): { rows: RenderRow[]; indexMap: Map<ParsedLine, number> } {
  const rows: RenderRow[] = [];
  const indexMap = new Map<ParsedLine, number>();
  const gapByHunk = new Map<number, Gap>();
  for (const g of gaps) gapByHunk.set(g.hunkIndex, g);

  const push = (r: RenderRow) => {
    rows.push(r);
    if (r.kind === "line") indexMap.set(r.line, rows.length - 1);
  };

  for (let i = 0; i < parsed.length; i++) {
    const l = parsed[i]!;
    if (l.kind === "hunk") {
      const gap = gapByHunk.get(i);
      if (gap) {
        if (expanded.has(i) && fileContents) {
          const fileLines = fileContents.split("\n");
          for (let n = gap.newFrom; n < gap.newTo; n++) {
            const text = fileLines[n - 1] ?? "";
            const oldNum = gap.oldFrom + (n - gap.newFrom);
            push({
              kind: "line",
              line: {
                kind: "context",
                oldNum,
                newNum: n,
                text,
              },
            });
          }
        } else {
          push({
            kind: "gap",
            hunkIndex: i,
            missingCount: gap.newTo - gap.newFrom,
          });
        }
      }
      push({ kind: "line", line: l });
      continue;
    }
    push({ kind: "line", line: l });
  }
  return { rows, indexMap };
}

/** Pair consecutive removed/added runs into side-by-side rows. */
function pairForSplit(lines: ParsedLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    if (l.kind === "hunk") {
      rows.push({ kind: "hunk", text: l.text });
      i++;
      continue;
    }
    if (l.kind === "context") {
      rows.push({ kind: "pair", left: l, right: l });
      i++;
      continue;
    }
    // Collect a run of removed followed by a run of added
    const removed: CodeLine[] = [];
    const added: CodeLine[] = [];
    while (i < lines.length && lines[i]!.kind === "removed") {
      removed.push(lines[i] as CodeLine);
      i++;
    }
    while (i < lines.length && lines[i]!.kind === "added") {
      added.push(lines[i] as CodeLine);
      i++;
    }
    const max = Math.max(removed.length, added.length);
    for (let k = 0; k < max; k++) {
      rows.push({
        kind: "pair",
        left: removed[k] ?? null,
        right: added[k] ?? null,
      });
    }
  }
  return rows;
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript",
  py: "Python", go: "Go", rs: "Rust", rb: "Ruby", php: "PHP",
  java: "Java", kt: "Kotlin", swift: "Swift", c: "C", h: "C",
  cpp: "C++", cc: "C++", hpp: "C++", cs: "C#", m: "Objective-C",
  mm: "Objective-C++", css: "CSS", scss: "Sass", sass: "Sass",
  html: "HTML", md: "Markdown", mdx: "MDX", json: "JSON", yaml: "YAML",
  yml: "YAML", toml: "TOML", xml: "XML", sql: "SQL", sh: "Shell",
  zsh: "Shell", bash: "Shell", dockerfile: "Docker", graphql: "GraphQL",
  gql: "GraphQL", prisma: "Prisma",
};

const SHIKI_LANG_BY_EXT: Record<string, BundledLanguage> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  py: "python", go: "go", rs: "rust", rb: "ruby", php: "php",
  java: "java", kt: "kotlin", swift: "swift", c: "c", h: "c",
  cpp: "cpp", cc: "cpp", hpp: "cpp", cs: "csharp",
  css: "css", scss: "scss", sass: "sass",
  html: "html", md: "markdown", mdx: "mdx", json: "json",
  yaml: "yaml", yml: "yaml", toml: "toml", xml: "xml", sql: "sql",
  sh: "shellscript", zsh: "shellscript", bash: "shellscript",
  dockerfile: "docker", graphql: "graphql", gql: "graphql",
};

function languageFor(filename: string): string | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  return LANGUAGE_BY_EXT[ext] ?? null;
}

function shikiLangFor(filename: string): BundledLanguage | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  return SHIKI_LANG_BY_EXT[ext] ?? null;
}

const THEME = "github-dark-dimmed" as const;

type ShikiHighlighter = HighlighterGeneric<BundledLanguage, typeof THEME>;

const highlighterPromiseByLang = new Map<BundledLanguage, Promise<ShikiHighlighter>>();

function getHighlighter(language: BundledLanguage): Promise<ShikiHighlighter> {
  const cached = highlighterPromiseByLang.get(language);
  if (cached) return cached;
  const p = createHighlighter({
    langs: [language],
    themes: [THEME],
  }) as Promise<ShikiHighlighter>;
  highlighterPromiseByLang.set(language, p);
  return p;
}

type LineTokens = ThemedToken[];

function useHighlightedLines(
  texts: string[],
  language: BundledLanguage | null,
  enabled: boolean,
): LineTokens[] | null {
  const [result, setResult] = useState<LineTokens[] | null>(null);
  const key = useMemo(() => texts.join("\u0000"), [texts]);
  const textsRef = useRef(texts);
  textsRef.current = texts;

  useEffect(() => {
    if (!enabled || !language) {
      setResult(null);
      return;
    }
    let cancelled = false;
    getHighlighter(language)
      .then((hi) => {
        if (cancelled) return;
        const joined = textsRef.current.join("\n");
        const { tokens } = hi.codeToTokens(joined, {
          lang: language,
          theme: THEME,
        });
        setResult(tokens);
      })
      .catch(() => {
        if (!cancelled) setResult(null);
      });
    return () => {
      cancelled = true;
    };
  }, [key, language, enabled]);

  return result;
}

function TokenSpans({ tokens }: { tokens: LineTokens }) {
  return (
    <>
      {tokens.map((t, i) => (
        <span
          key={i}
          style={
            {
              color: t.color,
              backgroundColor: t.bgColor,
            } as CSSProperties
          }
        >
          {t.content}
        </span>
      ))}
    </>
  );
}

function PathCrumbs({ filename }: { filename: string }) {
  const idx = filename.lastIndexOf("/");
  const dir = idx >= 0 ? filename.slice(0, idx + 1) : "";
  const base = idx >= 0 ? filename.slice(idx + 1) : filename;
  return (
    <span className="flex min-w-0 items-baseline justify-start font-mono text-[12px]">
      {dir ? (
        <span
          dir="rtl"
          className="min-w-0 truncate text-muted-foreground/70"
        >
          <bdi>{dir}</bdi>
        </span>
      ) : null}
      <span className="shrink-0 text-foreground">{base}</span>
    </span>
  );
}

/** Build a map: "side:line" -> root comments for that anchor. */
function indexCommentsByAnchor(comments: ReviewComment[]) {
  const roots = comments.filter((c) => c.inReplyToId == null);
  const repliesByRoot = new Map<number, ReviewComment[]>();
  for (const c of comments) {
    if (c.inReplyToId != null) {
      const arr = repliesByRoot.get(c.inReplyToId) ?? [];
      arr.push(c);
      repliesByRoot.set(c.inReplyToId, arr);
    }
  }
  for (const arr of repliesByRoot.values()) {
    arr.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  const byAnchor = new Map<string, ReviewComment[]>();
  for (const root of roots) {
    const line = root.line ?? root.originalLine;
    if (line == null) continue;
    const key = `${root.side}:${line}`;
    const arr = byAnchor.get(key) ?? [];
    arr.push(root);
    byAnchor.set(key, arr);
  }
  return { byAnchor, repliesByRoot };
}

function useViewedToggle(
  file: PRFile,
  target: ReviewTarget,
  account: OAuthConnection | null,
) {
  const [viewed, setViewed] = useState(() => file.viewed_state === "viewed");
  useEffect(() => {
    setViewed(file.viewed_state === "viewed");
  }, [file.viewed_state]);
  const markViewed = useMarkFileViewed(target, account);
  const toggle = useCallback(
    (next: boolean) => {
      setViewed(next);
      if (file.sha) markViewed.mutate({ fileSha: file.sha, viewed: next });
    },
    [file.sha, markViewed],
  );
  return { viewed, toggle, isPending: markViewed.isPending };
}

function useVisibility(rootMarginPx: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: `${rootMarginPx}px 0px` },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [inView, rootMarginPx]);
  return { ref, inView };
}

function useParsedDiff(
  patch: string | undefined,
  ignoreWhitespace: boolean,
  expandedGaps: Set<number>,
  fileContents: string | null,
) {
  const parsedRaw = useMemo(() => (patch ? parsePatch(patch) : []), [patch]);
  const parsed = useMemo(
    () => (ignoreWhitespace ? filterWhitespaceOnly(parsedRaw) : parsedRaw),
    [parsedRaw, ignoreWhitespace],
  );
  const gaps = useMemo(() => computeGaps(parsed), [parsed]);
  const { rows, indexMap } = useMemo(
    () => weaveRows(parsed, gaps, expandedGaps, fileContents),
    [parsed, gaps, expandedGaps, fileContents],
  );
  return { parsed, rows, indexMap };
}

const DIFF_VISIBILITY_ROOT_MARGIN_PX = 200;

export const FileDiffCard = forwardRef<
  HTMLDivElement,
  {
    file: PRFile;
    isActive?: boolean;
    mode?: DiffMode;
    comments?: ReviewComment[];
    defaultExpanded?: boolean;
    target: ReviewTarget;
    account: OAuthConnection | null;
    headSha: string;
    headRef?: string;
    pendingKey: PendingCommentsKey;
  }
>(function FileDiffCard(
  {
    file,
    isActive,
    mode = "split",
    comments = [],
    defaultExpanded = true,
    target,
    account,
    headSha,
    headRef,
    pendingKey,
  },
  ref,
) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { viewed, toggle: onToggleViewed, isPending: markViewedPending } =
    useViewedToggle(file, target, account);
  const { ref: innerRef, inView } = useVisibility(
    DIFF_VISIBILITY_ROOT_MARGIN_PX,
  );
  const [settings] = useDiffSettings();

  // Which gaps (hunk index) have been expanded.
  const [expandedGaps, setExpandedGaps] = useState<Set<number>>(
    () => new Set(),
  );
  const needsFileContents = expandedGaps.size > 0;
  const fileContents = useGitHubFileContents(
    { owner: target.owner, repo: target.repo },
    account,
    file.filename,
    headSha,
    needsFileContents,
  );

  const pendingForPR = usePendingComments(pendingKey);
  const hasExistingDraft = useMemo(
    () => pendingForPR.some((p) => p.path === file.filename),
    [pendingForPR, file.filename],
  );

  const { active, start: rawStartCompose, cancel: cancelCompose, submit: submitCompose } =
    useActiveCompose(pendingKey);

  const startCompose = useCallback(
    (args: {
      path: string;
      side: "LEFT" | "RIGHT";
      line: number;
      extend?: boolean;
    }) => {
      // Extend the range when there's already an active composer on the same
      // file+side. Shift-click behaves the same; this makes the interaction
      // discoverable (first click anchors, next click extends).
      if (
        active &&
        active.path === args.path &&
        active.side === args.side &&
        active.line !== args.line
      ) {
        const anchor = active.startLine ?? active.line;
        rawStartCompose({
          path: args.path,
          side: args.side,
          startLine: Math.min(anchor, args.line),
          line: Math.max(anchor, args.line),
        });
        return;
      }
      rawStartCompose({ path: args.path, side: args.side, line: args.line });
    },
    [active, rawStartCompose],
  );

  const { parsed, rows, indexMap } = useParsedDiff(
    file.patch,
    settings.ignoreWhitespace,
    expandedGaps,
    fileContents.data ?? null,
  );

  const language = languageFor(file.filename);
  const shikiLang = shikiLangFor(file.filename);

  const allTexts = useMemo(
    () =>
      rows.map((r) =>
        r.kind === "line" && r.line.kind !== "hunk" ? r.line.text : "",
      ),
    [rows],
  );
  const highlightEnabled = inView && !viewed && expanded && !!shikiLang;
  const highlighted = useHighlightedLines(allTexts, shikiLang, highlightEnabled);

  const { byAnchor, repliesByRoot } = useMemo(
    () => indexCommentsByAnchor(comments),
    [comments],
  );

  const threadsForLine = (side: "LEFT" | "RIGHT", line: number | null) => {
    if (line == null) return [];
    return byAnchor.get(`${side}:${line}`) ?? [];
  };

  const renderCode = (line: ParsedLine) => {
    if (line.kind === "hunk") return null;
    const idx = indexMap.get(line) ?? -1;
    const tokens = idx >= 0 ? highlighted?.[idx] : null;
    if (tokens && tokens.length > 0) return <TokenSpans tokens={tokens} />;
    return line.text;
  };

  const onExpandGap = useCallback(
    (hunkIdx: number) => {
      setExpandedGaps((prev) => {
        const next = new Set(prev);
        next.add(hunkIdx);
        return next;
      });
    },
    [],
  );

  const composeActive =
    active && active.path === file.filename ? active : null;

  const codeStyle: CSSProperties = {
    fontSize: settings.fontSize,
    tabSize: settings.tabWidth,
    whiteSpace: settings.softWrap ? "pre-wrap" : "pre",
    wordBreak: settings.softWrap ? "break-word" : "normal",
  };

  return (
    <div
      ref={mergeRefs(innerRef, ref)}
      data-active={isActive ? "true" : "false"}
      className="rounded-lg border border-border/50 bg-card data-[active=true]:border-primary/50"
    >
      <div
        className={`sticky top-[44px] z-[2] flex w-full min-w-0 items-center gap-2 border-b border-border/50 bg-muted px-3 py-2 ${
          expanded && !viewed ? "rounded-t-lg" : "rounded-lg"
        }`}
      >
        <button
          type="button"
          onClick={() => setExpanded((s) => !s)}
          className="flex shrink-0 items-center gap-1 text-muted-foreground/70 hover:text-foreground"
          aria-label={expanded ? "Collapse file" : "Expand file"}
        >
          {expanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </button>
        <div className="min-w-0 flex-1 overflow-hidden">
          <PathCrumbs filename={file.filename} />
        </div>
        <div className="flex shrink-0 items-center gap-1.5 font-mono text-[11px]">
          <span className="text-emerald-500">+{file.additions}</span>
          <span className="text-rose-500">−{file.deletions}</span>
        </div>
        {language ? (
          <span className="hidden shrink-0 rounded-sm bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground/70 lg:inline-block">
            {language}
          </span>
        ) : null}
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={viewed}
            onChange={(e) => onToggleViewed(e.target.checked)}
            disabled={markViewedPending}
            className="size-3.5 accent-primary"
          />
          <span className="hidden md:inline">Viewed</span>
        </label>
      </div>
      {expanded && !viewed ? (
        <div className="overflow-hidden rounded-b-lg">
          {file.patch ? (
            inView ? (
              mode === "split" ? (
                <SplitDiff
                  rows={rows}
                  renderCode={renderCode}
                  threadsForLine={threadsForLine}
                  repliesByRoot={repliesByRoot}
                  onExpandGap={onExpandGap}
                  gapLoading={fileContents.isLoading}
                  gapUnavailable={
                    fileContents.isFetched && fileContents.data == null
                  }
                  codeStyle={codeStyle}
                  compose={composeActive}
                  onStartCompose={(args) =>
                    startCompose({ ...args, path: file.filename })
                  }
                  onCancelCompose={cancelCompose}
                  onSubmitCompose={submitCompose}
                  hasExistingDraft={hasExistingDraft}
                  filename={file.filename}
                  target={target}
                  account={account}
                  headRef={headRef}
                />
              ) : (
                <UnifiedDiff
                  rows={rows}
                  renderCode={renderCode}
                  threadsForLine={threadsForLine}
                  repliesByRoot={repliesByRoot}
                  onExpandGap={onExpandGap}
                  gapLoading={fileContents.isLoading}
                  gapUnavailable={
                    fileContents.isFetched && fileContents.data == null
                  }
                  codeStyle={codeStyle}
                  compose={composeActive}
                  onStartCompose={(args) =>
                    startCompose({ ...args, path: file.filename })
                  }
                  onCancelCompose={cancelCompose}
                  onSubmitCompose={submitCompose}
                  hasExistingDraft={hasExistingDraft}
                  filename={file.filename}
                  target={target}
                  account={account}
                  headRef={headRef}
                />
              )
            ) : (
              // Offscreen placeholder. Height approximates the diff so the
              // scrollbar doesn't jump when the real content mounts.
              <div
                style={{ minHeight: Math.max(80, parsed.length * 20) }}
                aria-hidden
              />
            )
          ) : (
            <div className="px-4 py-6 text-center text-[12px] text-muted-foreground/70">
              Binary file or no patch available.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
});

function AddCommentHover({
  onClick,
}: {
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      tabIndex={-1}
      aria-label="Add comment"
      className="pointer-events-none absolute left-1 top-1/2 hidden -translate-y-1/2 group-hover:flex"
    >
      <span className="pointer-events-auto flex size-4 items-center justify-center rounded-sm bg-primary text-primary-foreground shadow-sm">
        <Plus className="size-3" />
      </span>
    </button>
  );
}

function GapExpander({
  missingCount,
  loading,
  unavailable,
  onExpand,
}: {
  missingCount: number;
  loading: boolean;
  unavailable: boolean;
  onExpand: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onExpand}
      disabled={loading || unavailable}
      className="flex w-full items-center gap-2 border-b border-border/30 bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground/70 hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
    >
      <ChevronsUpDown className="size-3 shrink-0" />
      <span>
        {unavailable
          ? "Context unavailable"
          : loading
            ? "Loading\u2026"
            : `Expand ${missingCount} lines`}
      </span>
    </button>
  );
}

type DiffBodyProps = {
  rows: RenderRow[];
  renderCode: (line: ParsedLine) => React.ReactNode;
  threadsForLine: (side: "LEFT" | "RIGHT", line: number | null) => ReviewComment[];
  repliesByRoot: Map<number, ReviewComment[]>;
  onExpandGap: (hunkIdx: number) => void;
  gapLoading: boolean;
  gapUnavailable: boolean;
  codeStyle: CSSProperties;
  compose: {
    path: string;
    side: "LEFT" | "RIGHT";
    line: number;
    startLine?: number;
  } | null;
  onStartCompose: (args: {
    side: "LEFT" | "RIGHT";
    line: number;
    extend?: boolean;
  }) => void;
  onCancelCompose: () => void;
  onSubmitCompose: (body: string) => void;
  hasExistingDraft: boolean;
  filename: string;
  target: ReviewTarget;
  account: OAuthConnection | null;
  headRef?: string;
};

function UnifiedDiff({
  rows,
  renderCode,
  threadsForLine,
  repliesByRoot,
  onExpandGap,
  gapLoading,
  gapUnavailable,
  codeStyle,
  compose,
  onStartCompose,
  onCancelCompose,
  onSubmitCompose,
  hasExistingDraft,
  filename,
  target,
  account,
  headRef,
}: DiffBodyProps) {
  const baseRepoFull = `${target.owner}/${target.repo}`;
  return (
    <div className="overflow-x-auto">
      {rows.map((r, i) => {
        if (r.kind === "gap") {
          return (
            <GapExpander
              key={`gap-${i}`}
              missingCount={r.missingCount}
              loading={gapLoading}
              unavailable={gapUnavailable}
              onExpand={() => onExpandGap(r.hunkIndex)}
            />
          );
        }
        const l = r.line;
        if (l.kind === "hunk") {
          return (
            <div key={i} className="graphite-diff-line" data-kind="hunk">
              <div className="num" />
              <div className="code" style={codeStyle}>{l.text}</div>
            </div>
          );
        }
        const side: "LEFT" | "RIGHT" = l.kind === "removed" ? "LEFT" : "RIGHT";
        const anchorLine = l.kind === "removed" ? l.oldNum : l.newNum;
        const threads = threadsForLine(side, anchorLine);
        const inRange =
          compose?.path === filename &&
          compose.side === side &&
          anchorLine != null &&
          anchorLine >= (compose.startLine ?? compose.line) &&
          anchorLine <= compose.line;
        const isComposerAnchor =
          compose?.path === filename &&
          compose.side === side &&
          anchorLine != null &&
          compose.line === anchorLine;
        return (
          <div key={i}>
            <div className="group relative">
              <div
                className="graphite-diff-line"
                data-kind={l.kind}
                data-range={inRange ? "true" : undefined}
              >
                <div className="num">{l.newNum ?? l.oldNum ?? ""}</div>
                <div className="code" style={codeStyle}>
                  {l.kind === "added" ? "+" : l.kind === "removed" ? "\u2212" : " "}
                  {renderCode(l)}
                </div>
              </div>
              {anchorLine != null ? (
                <AddCommentHover
                  onClick={(e) =>
                    onStartCompose({ side, line: anchorLine, extend: e.shiftKey })
                  }
                />
              ) : null}
            </div>
            {isComposerAnchor ? (
              <InlineComposer
                hasExistingDraft={hasExistingDraft}
                onSubmit={onSubmitCompose}
                onCancel={onCancelCompose}
              />
            ) : null}
            {threads.map((root) => (
              <InlineThread
                key={root.id}
                root={root}
                replies={repliesByRoot.get(root.id) ?? []}
                target={target}
                account={account}
                prHeadRef={headRef}
                baseRepoFull={baseRepoFull}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function SplitDiff({
  rows,
  renderCode,
  threadsForLine,
  repliesByRoot,
  onExpandGap,
  gapLoading,
  gapUnavailable,
  codeStyle,
  compose,
  onStartCompose,
  onCancelCompose,
  onSubmitCompose,
  hasExistingDraft,
  filename,
  target,
  account,
  headRef,
}: DiffBodyProps) {
  const baseRepoFull = `${target.owner}/${target.repo}`;
  // Weave gaps inline: flush buffered line runs through pairForSplit each time
  // we hit a gap, so expanders sit between the hunks they precede.
  const segments = useMemo(() => {
    const out: Array<
      | { kind: "pairs"; rows: SplitRow[] }
      | { kind: "gap"; hunkIndex: number; missingCount: number }
    > = [];
    let buf: ParsedLine[] = [];
    const flush = () => {
      if (buf.length > 0) {
        out.push({ kind: "pairs", rows: pairForSplit(buf) });
        buf = [];
      }
    };
    for (const r of rows) {
      if (r.kind === "gap") {
        flush();
        out.push({ kind: "gap", hunkIndex: r.hunkIndex, missingCount: r.missingCount });
      } else {
        buf.push(r.line);
      }
    }
    flush();
    return out;
  }, [rows]);

  const halfCell = "graphite-diff-line grid !grid-cols-[44px_minmax(0,1fr)] min-w-0";

  return (
    <div className="min-w-0">
      {segments.map((seg, segIdx) => {
        if (seg.kind === "gap") {
          return (
            <GapExpander
              key={`gap-${segIdx}`}
              missingCount={seg.missingCount}
              loading={gapLoading}
              unavailable={gapUnavailable}
              onExpand={() => onExpandGap(seg.hunkIndex)}
            />
          );
        }
        return (
          <SplitSegment
            key={`seg-${segIdx}`}
            rows={seg.rows}
            renderCode={renderCode}
            threadsForLine={threadsForLine}
            repliesByRoot={repliesByRoot}
            codeStyle={codeStyle}
            compose={compose}
            onStartCompose={onStartCompose}
            onCancelCompose={onCancelCompose}
            onSubmitCompose={onSubmitCompose}
            hasExistingDraft={hasExistingDraft}
            filename={filename}
            target={target}
            account={account}
            headRef={headRef}
            baseRepoFull={baseRepoFull}
            halfCell={halfCell}
          />
        );
      })}
    </div>
  );
}

type SplitSegmentProps = {
  rows: SplitRow[];
  renderCode: DiffBodyProps["renderCode"];
  threadsForLine: DiffBodyProps["threadsForLine"];
  repliesByRoot: DiffBodyProps["repliesByRoot"];
  codeStyle: DiffBodyProps["codeStyle"];
  compose: DiffBodyProps["compose"];
  onStartCompose: DiffBodyProps["onStartCompose"];
  onCancelCompose: DiffBodyProps["onCancelCompose"];
  onSubmitCompose: DiffBodyProps["onSubmitCompose"];
  hasExistingDraft: DiffBodyProps["hasExistingDraft"];
  filename: string;
  target: DiffBodyProps["target"];
  account: DiffBodyProps["account"];
  headRef: DiffBodyProps["headRef"];
  baseRepoFull: string;
  halfCell: string;
};

function SplitSegment({
  rows: splitRows,
  renderCode,
  threadsForLine,
  repliesByRoot,
  codeStyle,
  compose,
  onStartCompose,
  onCancelCompose,
  onSubmitCompose,
  hasExistingDraft,
  filename,
  target,
  account,
  headRef,
  baseRepoFull,
  halfCell,
}: SplitSegmentProps) {
  return (
    <>
      {splitRows.map((row, i) => {
        if (row.kind === "hunk") {
          return (
            <div key={i} className="graphite-diff-line" data-kind="hunk">
              <div className="num" />
              <div className="code" style={codeStyle}>{row.text}</div>
            </div>
          );
        }
        const { left, right } = row;
        const leftThreads = left
          ? threadsForLine(left.kind === "removed" ? "LEFT" : "RIGHT", left.oldNum ?? left.newNum)
          : [];
        const rightThreads = right
          ? threadsForLine("RIGHT", right.newNum)
          : [];
        const shownOnLeftIds = new Set(leftThreads.map((t) => t.id));
        const rightThreadsDedup =
          left && right && left === right
            ? []
            : rightThreads.filter((t) => !shownOnLeftIds.has(t.id));
        const threads = [...leftThreads, ...rightThreadsDedup];

        const leftSide: "LEFT" | "RIGHT" | null = left
          ? left.kind === "removed"
            ? "LEFT"
            : "RIGHT"
          : null;
        const leftAnchor = left ? (left.oldNum ?? left.newNum) : null;
        const rightAnchor = right ? right.newNum : null;
        const leftComposing =
          left != null &&
          leftSide != null &&
          leftAnchor != null &&
          compose?.path === filename &&
          compose.side === leftSide &&
          compose.line === leftAnchor;
        const rightComposing =
          right != null &&
          rightAnchor != null &&
          compose?.path === filename &&
          compose.side === "RIGHT" &&
          compose.line === rightAnchor &&
          !leftComposing;
        const leftInRange =
          left != null &&
          leftSide != null &&
          leftAnchor != null &&
          compose?.path === filename &&
          compose.side === leftSide &&
          leftAnchor >= (compose.startLine ?? compose.line) &&
          leftAnchor <= compose.line;
        const rightInRange =
          right != null &&
          rightAnchor != null &&
          compose?.path === filename &&
          compose.side === "RIGHT" &&
          rightAnchor >= (compose.startLine ?? compose.line) &&
          rightAnchor <= compose.line;

        return (
          <div key={i}>
            <div className="grid grid-cols-2 min-w-0">
              <div className="group relative border-r border-border/50">
                {left ? (
                  <div
                    className={halfCell}
                    data-kind={left.kind}
                    data-range={leftInRange ? "true" : undefined}
                  >
                    <div className="num">{left.oldNum ?? ""}</div>
                    <div className="code" style={codeStyle}>
                      {left.kind === "removed" ? "\u2212" : " "}
                      {renderCode(left)}
                    </div>
                  </div>
                ) : (
                  <div className={halfCell} data-kind="empty">
                    <div className="num" />
                    <div className="code" />
                  </div>
                )}
                {left && leftSide && leftAnchor != null ? (
                  <AddCommentHover
                    onClick={(e) =>
                      onStartCompose({
                        side: leftSide,
                        line: leftAnchor,
                        extend: e.shiftKey,
                      })
                    }
                  />
                ) : null}
              </div>
              <div className="group relative">
                {right ? (
                  <div
                    className={halfCell}
                    data-kind={right.kind}
                    data-range={rightInRange ? "true" : undefined}
                  >
                    <div className="num">{right.newNum ?? ""}</div>
                    <div className="code" style={codeStyle}>
                      {right.kind === "added" ? "+" : " "}
                      {renderCode(right)}
                    </div>
                  </div>
                ) : (
                  <div className={halfCell} data-kind="empty">
                    <div className="num" />
                    <div className="code" />
                  </div>
                )}
                {right && rightAnchor != null ? (
                  <AddCommentHover
                    onClick={(e) =>
                      onStartCompose({
                        side: "RIGHT",
                        line: rightAnchor,
                        extend: e.shiftKey,
                      })
                    }
                  />
                ) : null}
              </div>
            </div>
            {leftComposing || rightComposing ? (
              <InlineComposer
                hasExistingDraft={hasExistingDraft}
                onSubmit={onSubmitCompose}
                onCancel={onCancelCompose}
              />
            ) : null}
            {threads.map((root) => (
              <InlineThread
                key={root.id}
                root={root}
                replies={repliesByRoot.get(root.id) ?? []}
                target={target}
                account={account}
                prHeadRef={headRef}
                baseRepoFull={baseRepoFull}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}

export function FileTreePanel({
  files,
  activeFile,
  onSelect,
}: {
  files: PRFile[];
  activeFile: string | null;
  onSelect: (filename: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.filename.toLowerCase().includes(q));
  }, [files, query]);
  const tree = useMemo(() => buildTree(filtered), [filtered]);
  const allFolderPaths = useMemo(() => collectFolderPaths(tree), [tree]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggleFolder = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);
  const allCollapsed =
    allFolderPaths.length > 0 && collapsed.size >= allFolderPaths.length;
  const toggleAll = useCallback(() => {
    setCollapsed((prev) =>
      prev.size > 0 ? new Set() : new Set(allFolderPaths),
    );
  }, [allFolderPaths]);

  return (
    <div>
      <div className="sticky top-0 z-[1] space-y-2 border-b border-border/50 p-2">
        <div className="flex items-center gap-2 rounded-md border border-border/50 bg-background px-2 py-1.5">
          <Search className="size-3.5 text-muted-foreground/70" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files"
            className="w-full bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/70"
          />
        </div>
        <div className="flex items-center justify-between px-0.5 text-[11px] text-muted-foreground/70">
          <span>
            {filtered.length} of {files.length}
          </span>
          {allFolderPaths.length > 0 ? (
            <button
              type="button"
              onClick={toggleAll}
              className="hover:text-foreground"
              title={allCollapsed ? "Expand all" : "Collapse all"}
            >
              {allCollapsed ? "Expand all" : "Collapse all"}
            </button>
          ) : null}
        </div>
      </div>
      <div className="p-2">
        <TreeNode
          node={tree}
          path=""
          activeFile={activeFile}
          onSelect={onSelect}
          depth={0}
          collapsed={collapsed}
          onToggle={toggleFolder}
        />
      </div>
    </div>
  );
}

type Node = {
  name: string;
  children: Map<string, Node>;
  file: PRFile | null;
};

function collectFolderPaths(node: Node, prefix = ""): string[] {
  const out: string[] = [];
  for (const [, child] of node.children) {
    const path = prefix ? `${prefix}/${child.name}` : child.name;
    if (child.file == null) out.push(path);
    out.push(...collectFolderPaths(child, path));
  }
  return out;
}

function buildTree(files: PRFile[]): Node {
  const root: Node = { name: "", children: new Map(), file: null };
  for (const f of files) {
    const parts = f.filename.split("/");
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      let next = cur.children.get(part);
      if (!next) {
        next = { name: part, children: new Map(), file: null };
        cur.children.set(part, next);
      }
      if (i === parts.length - 1) next.file = f;
      cur = next;
    }
  }
  collapseSingleChildFolders(root);
  return root;
}

/** Collapse "a > b > c.ts" into "a/b/c.ts" when each level has one child. */
function collapseSingleChildFolders(node: Node) {
  for (const [, child] of node.children) {
    while (
      child.file == null &&
      child.children.size === 1
    ) {
      const [onlyChild] = child.children.values() as IterableIterator<Node>;
      if (!onlyChild || onlyChild.file != null) break;
      child.name = `${child.name}/${onlyChild.name}`;
      child.children = onlyChild.children;
    }
    collapseSingleChildFolders(child);
  }
}

function TreeNode({
  node,
  path,
  activeFile,
  onSelect,
  depth,
  collapsed,
  onToggle,
}: {
  node: Node;
  path: string;
  activeFile: string | null;
  onSelect: (filename: string) => void;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
}) {
  // VS Code indent is ~8px/level. Chevron takes 14px so file rows get extra
  // left padding to line their names up with folder names.
  const INDENT = 8;
  const indent = depth * INDENT;

  return (
    <ul>
      {Array.from(node.children.values()).map((child) => {
        const nextPath = path ? `${path}/${child.name}` : child.name;
        if (child.file) {
          const active = activeFile === child.file.filename;
          return (
            <li key={nextPath}>
              <button
                type="button"
                onClick={() => onSelect(child.file!.filename)}
                className={`flex w-full items-center gap-1.5 rounded-sm py-[3px] pr-1.5 text-left text-[12px] hover:bg-muted ${
                  active
                    ? "bg-muted text-foreground"
                    : ""
                }`}
                style={{ paddingLeft: 6 + indent + 14 }}
              >
                <FileIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
                <span className="flex-1 truncate font-mono">{child.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-emerald-500">
                  +{child.file.additions}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-rose-500">
                  −{child.file.deletions}
                </span>
              </button>
            </li>
          );
        }
        const isCollapsed = collapsed.has(nextPath);
        return (
          <li key={nextPath}>
            <button
              type="button"
              onClick={() => onToggle(nextPath)}
              className="flex w-full items-center gap-1 rounded-sm py-[3px] pr-1.5 text-left text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
              style={{ paddingLeft: 4 + indent }}
              aria-expanded={!isCollapsed}
            >
              <ChevronRight
                className="size-3 shrink-0 text-muted-foreground/70 transition-transform"
                style={{ transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)" }}
              />
              {isCollapsed ? (
                <Folder className="size-3.5 shrink-0 text-muted-foreground/70" />
              ) : (
                <FolderOpen className="size-3.5 shrink-0 text-muted-foreground/70" />
              )}
              <span className="flex-1 truncate font-mono">{child.name}</span>
            </button>
            {!isCollapsed ? (
              <TreeNode
                node={child}
                path={nextPath}
                activeFile={activeFile}
                onSelect={onSelect}
                depth={depth + 1}
                collapsed={collapsed}
                onToggle={onToggle}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function DiffModeToggle({
  mode,
  onChange,
}: {
  mode: DiffMode;
  onChange: (m: DiffMode) => void;
}) {
  const btn = (m: DiffMode, label: string) => (
    <button
      type="button"
      onClick={() => onChange(m)}
      data-active={mode === m ? "true" : "false"}
      className="px-2 py-1 text-[11px] text-muted-foreground/70 data-[active=true]:bg-muted data-[active=true]:text-foreground"
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex overflow-hidden rounded-sm border border-border/50 bg-card">
      {btn("split", "Split")}
      <div className="w-px bg-border/50" />
      {btn("unified", "Unified")}
    </div>
  );
}

export function DiffSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="overflow-hidden rounded-lg border border-border/50"
        >
          <Skeleton className="h-9 w-full rounded-none" />
          <div className="space-y-1 p-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-[92%]" />
            <Skeleton className="h-4 w-[88%]" />
            <Skeleton className="h-4 w-[70%]" />
          </div>
        </div>
      ))}
    </div>
  );
}
