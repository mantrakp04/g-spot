import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Search,
} from "lucide-react";
import {
  FileIcon,
  FolderIcon,
  OpenFolderIcon,
} from "react-files-icons";
import type { OAuthConnection } from "@hexclave/react";

import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import {
  getSingularPatch,
  processPatch,
  type CodeView as CodeViewInstance,
  type CodeViewItem,
  type CodeViewOptions,
  type DiffLineAnnotation,
  type LineAnnotation,
} from "@pierre/diffs";

import { Button } from "@g-spot/ui/components/button";
import { Input } from "@g-spot/ui/components/input";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@g-spot/ui/components/toggle-group";
import { cn } from "@g-spot/ui/lib/utils";

import type { ReviewComment, ReviewTarget } from "@/hooks/use-github-detail";
import {
  type ActiveCompose,
} from "@/hooks/use-pending-comments";

import { useDiffCustomization } from "./diff-customizer";
import { useCollapsedFiles } from "./diff-collapse-state";
import { InlineComposer } from "./inline-composer";
import { InlineThread } from "./inline-thread";
import {
  buildReviewAnnotations,
  getReviewCommentRange,
  reviewAnnotationKey,
  type ReviewAnnotationPayload,
} from "./review-annotations";

export type PRFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  sha: string;
};

export type DiffMode = "unified" | "split";
type AnnotationPlacement = "inline" | "side";

const EMPTY_FILE_COMMENTS: ReviewComment[] = [];
const REVIEW_DIFF_LINE_HEIGHT_PX = 18.6;

// Map the app's design tokens into pierre's diff shadow DOM via its real
// custom property surface (see node_modules/@pierre/diffs/dist/**.css). CSS
// custom properties inherit across shadow boundaries, so setting them on the
// host is enough.
const DIFF_HOST_STYLE = {
  "--diffs-font-family":
    "ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, monospace",
  "--diffs-font-size": "12px",
  "--diffs-line-height": "1.55",
  "--review-diff-line-height": "18.6px",
  "--diffs-bg": "var(--card)",
  "--diffs-fg": "var(--foreground)",
} as CSSProperties;

const SIDE_ANNOTATION_UNSAFE_CSS = `
  [data-line-annotation] {
    position: relative;
    min-height: 0 !important;
    height: 0 !important;
    margin-block: 0 !important;
    padding-block: 0 !important;
    overflow: visible;
    background: transparent;
    pointer-events: none;
  }

  [data-line-annotation] > [data-annotation-content] {
    position: absolute;
    inset-block-start: calc(var(--review-diff-line-height, 19px) * -1);
    inset-inline: 0;
    min-height: 0 !important;
    height: var(--review-diff-line-height, 19px) !important;
    margin-block: 0 !important;
    padding-block: 0 !important;
    border: 0 !important;
    overflow: visible;
    border-radius: 4px;
    pointer-events: none;
    z-index: 3;
  }
`;

const SIDE_ANNOTATION_ANCHOR_STYLE: CSSProperties = {
  display: "block",
  position: "relative",
  width: "100%",
  height: 0,
  overflow: "visible",
  pointerEvents: "none",
};

const SIDE_ANNOTATION_ACTIVE_MARK_STYLE: CSSProperties = {
  position: "absolute",
  insetInline: 0,
  top: 0,
  height: "var(--review-diff-line-height, 19px)",
  borderRadius: 4,
  background: "color-mix(in srgb, var(--primary) 13%, transparent)",
  boxShadow:
    "inset 0 0 0 1px color-mix(in srgb, var(--primary) 72%, transparent)",
};

function sideToGithub(side: "deletions" | "additions"): "LEFT" | "RIGHT" {
  return side === "deletions" ? "LEFT" : "RIGHT";
}

function buildUnifiedPatch(file: PRFile): string {
  const name = file.filename;
  const isAdded = file.status === "added";
  const isDeleted = file.status === "removed" || file.status === "deleted";
  const oldPath = isAdded ? "/dev/null" : `a/${name}`;
  const newPath = isDeleted ? "/dev/null" : `b/${name}`;
  const header = [
    `diff --git a/${name} b/${name}`,
    `--- ${oldPath}`,
    `+++ ${newPath}`,
  ].join("\n");
  return `${header}\n${file.patch ?? ""}`;
}

function SideAnnotationAnchor({
  id,
  active,
  lineCount,
}: {
  id: string;
  active: boolean;
  lineCount: number;
}) {
  const activeMarkStyle = active
    ? {
        ...SIDE_ANNOTATION_ACTIVE_MARK_STYLE,
        top: -Math.max(0, lineCount - 1) * REVIEW_DIFF_LINE_HEIGHT_PX,
        height: Math.max(1, lineCount) * REVIEW_DIFF_LINE_HEIGHT_PX,
      }
    : undefined;

  return (
    <span
      data-review-side-anchor={id}
      data-review-side-anchor-active={active ? "true" : undefined}
      aria-hidden="true"
      style={SIDE_ANNOTATION_ANCHOR_STYLE}
    >
      {active ? (
        <span
          data-review-side-anchor-highlight="true"
          style={activeMarkStyle}
        />
      ) : null}
    </span>
  );
}

export type ReviewAnnotationContentProps = {
  annotation: DiffLineAnnotation<ReviewAnnotationPayload>;
  placement: AnnotationPlacement;
  hasExistingDraft: boolean;
  onSubmit: (body: string) => void;
  onCancel: () => void;
  target: ReviewTarget;
  account: OAuthConnection | null;
  headRef?: string;
  baseRepoFull: string;
};

export function ReviewAnnotationContent({
  annotation,
  placement,
  hasExistingDraft,
  onSubmit,
  onCancel,
  target,
  account,
  headRef,
  baseRepoFull,
}: ReviewAnnotationContentProps) {
  const payload = annotation.metadata;
  if (payload.kind === "compose") {
    return (
      <InlineComposer
        hasExistingDraft={hasExistingDraft}
        onSubmit={onSubmit}
        onCancel={onCancel}
        placement={placement}
      />
    );
  }

  return (
    <InlineThread
      root={payload.root}
      replies={payload.replies}
      target={target}
      account={account}
      prHeadRef={headRef}
      baseRepoFull={baseRepoFull}
      placement={placement}
    />
  );
}

type ReviewCodeViewOptions = CodeViewOptions<ReviewAnnotationPayload>;
type ReviewCodeViewItem = CodeViewItem<ReviewAnnotationPayload>;
type ReviewSelectionRange = {
  start: number;
  end: number;
  side?: "deletions" | "additions";
  endSide?: "deletions" | "additions";
} | null;
type ReviewSelectionContext = {
  item: ReviewCodeViewItem;
};
type ReviewRenderableAnnotation =
  | DiffLineAnnotation<ReviewAnnotationPayload>
  | LineAnnotation<ReviewAnnotationPayload>;

function patchCacheKey(cachePrefix: string, file: PRFile) {
  return `${cachePrefix}:${file.filename}:patch:${file.sha}:${file.patch?.length ?? 0}`;
}

function noPatchCacheKey(cachePrefix: string, file: PRFile) {
  return `${cachePrefix}:${file.filename}:nopatch:${file.status}:${file.sha}`;
}

function hashParts(parts: readonly (number | string | boolean | null | undefined)[]) {
  let hash = 2166136261;
  for (const part of parts) {
    const value = String(part ?? "");
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return hash >>> 0;
}

function annotationsVersion(
  annotations: readonly DiffLineAnnotation<ReviewAnnotationPayload>[],
) {
  return annotations
    .map((annotation) => {
      const payload = annotation.metadata;
      if (payload.kind === "compose") {
        return `compose:${annotation.side}:${annotation.lineNumber}:${payload.startLine ?? ""}`;
      }
      const replies = payload.replies.map((reply) => reply.id).join(",");
      return `thread:${payload.root.id}:${annotation.side}:${annotation.lineNumber}:${payload.root.isResolved}:${replies}`;
    })
    .join("|");
}

function buildPatchDiffMap(files: PRFile[], cachePrefix: string) {
  const filesWithPatch = files.filter((file) => file.patch);
  const byFilename = new Map<string, ReturnType<typeof getSingularPatch>>();
  if (filesWithPatch.length === 0) return byFilename;

  try {
    const parsed = processPatch(
      filesWithPatch.map(buildUnifiedPatch).join("\n"),
      cachePrefix,
      true,
    );
    if (parsed.files.length === filesWithPatch.length) {
      for (let i = 0; i < filesWithPatch.length; i++) {
        const file = filesWithPatch[i]!;
        const fileDiff = parsed.files[i]!;
        fileDiff.cacheKey = patchCacheKey(cachePrefix, file);
        byFilename.set(file.filename, fileDiff);
      }
      return byFilename;
    }
  } catch {
    // Fall back to per-file parsing below. Some GitHub patches omit metadata
    // that the whole-patch parser expects.
  }

  for (const file of filesWithPatch) {
    const fileDiff = getSingularPatch(buildUnifiedPatch(file));
    fileDiff.cacheKey = patchCacheKey(cachePrefix, file);
    byFilename.set(file.filename, fileDiff);
  }
  return byFilename;
}

function getCodeViewItemFilename(item: ReviewCodeViewItem) {
  return item.type === "diff" ? item.fileDiff.name : item.file.name;
}

function toDiffLineAnnotation(
  annotation: ReviewRenderableAnnotation,
): DiffLineAnnotation<ReviewAnnotationPayload> {
  if ("side" in annotation) return annotation;
  return { ...annotation, side: "additions" };
}

export function ReviewCodeView({
  files,
  mode = "split",
  commentsByFile,
  target,
  account,
  headRef,
  baseRepoFull,
  activeCompose,
  pendingDraftPaths,
  onStartCompose,
  onSubmitCompose,
  onCancelCompose,
  annotationPlacement = "inline",
  focusedCommentId,
  viewerRef,
  containerRef,
  cacheKey,
  onActiveFileChange,
}: {
  files: PRFile[];
  mode?: DiffMode;
  commentsByFile: Record<string, ReviewComment[]>;
  target: ReviewTarget;
  account: OAuthConnection | null;
  headRef?: string;
  baseRepoFull: string;
  activeCompose: ActiveCompose | null;
  pendingDraftPaths: Set<string>;
  onStartCompose: (args: ActiveCompose) => void;
  onSubmitCompose: (body: string) => void;
  onCancelCompose: () => void;
  annotationPlacement?: AnnotationPlacement;
  focusedCommentId?: number | null;
  viewerRef: RefObject<CodeViewHandle<ReviewAnnotationPayload> | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  cacheKey: string;
  onActiveFileChange: (filename: string) => void;
}) {
  const customization = useDiffCustomization();
  const { collapsedSet, toggleFile } = useCollapsedFiles();
  const useSideRail = annotationPlacement === "side";
  const activeUpdateFrameRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (activeUpdateFrameRef.current != null) {
        window.cancelAnimationFrame(activeUpdateFrameRef.current);
        activeUpdateFrameRef.current = null;
      }
    },
    [],
  );

  const filesByName = useMemo(() => {
    const next = new Map<string, PRFile>();
    for (const file of files) next.set(file.filename, file);
    return next;
  }, [files]);

  const patchDiffsByName = useMemo(
    () => buildPatchDiffMap(files, cacheKey),
    [files, cacheKey],
  );

  const items = useMemo<ReviewCodeViewItem[]>(() => {
    return files.map((file) => {
      const collapsed = collapsedSet.has(file.filename);
      const composeForFile =
        activeCompose && activeCompose.path === file.filename
          ? activeCompose
          : null;
      const annotations = buildReviewAnnotations(
        commentsByFile[file.filename] ?? EMPTY_FILE_COMMENTS,
        composeForFile,
      );
      const version = hashParts([
        file.filename,
        file.status,
        file.sha,
        file.additions,
        file.deletions,
        file.patch?.length ?? 0,
        collapsed,
        annotationsVersion(annotations),
      ]);
      const fileDiff = patchDiffsByName.get(file.filename);
      if (fileDiff) {
        return {
          id: file.filename,
          type: "diff",
          fileDiff,
          annotations,
          collapsed,
          version,
        };
      }
      return {
        id: file.filename,
        type: "file",
        file: {
          name: file.filename,
          contents: "Binary file or no patch available\n",
          cacheKey: noPatchCacheKey(cacheKey, file),
        },
        collapsed,
        version,
      };
    });
  }, [
    activeCompose,
    cacheKey,
    collapsedSet,
    commentsByFile,
    files,
    patchDiffsByName,
  ]);

  const onLineSelectionEnd = useCallback(
    (range: ReviewSelectionRange, context: ReviewSelectionContext) => {
      if (!range) return;
      const side = sideToGithub(range.endSide ?? range.side ?? "additions");
      onStartCompose({
        path: getCodeViewItemFilename(context.item),
        side,
        line: range.end,
        startLine: range.start !== range.end ? range.start : undefined,
      });
    },
    [onStartCompose],
  );

  const options = useMemo<ReviewCodeViewOptions>(
    () => ({
      diffStyle: mode,
      enableLineSelection: true,
      onLineSelectionEnd,
      hunkSeparators: "line-info",
      expansionLineCount: 20,
      lineDiffType: customization.lineDiffType,
      disableBackground: !customization.backgrounds,
      overflow: customization.wrapping ? "wrap" : "scroll",
      disableLineNumbers: !customization.lineNumbers,
      unsafeCSS: useSideRail ? SIDE_ANNOTATION_UNSAFE_CSS : undefined,
      stickyHeaders: true,
      itemMetrics: {
        lineHeight: REVIEW_DIFF_LINE_HEIGHT_PX,
        diffHeaderHeight: 44,
        spacing: 8,
      },
      layout: {
        paddingTop: 8,
        paddingBottom: 8,
        gap: 8,
      },
    }),
    [
      customization.backgrounds,
      customization.lineDiffType,
      customization.lineNumbers,
      customization.wrapping,
      mode,
      onLineSelectionEnd,
      useSideRail,
    ],
  );

  const annotationContentProps = useMemo<
    Omit<
      ReviewAnnotationContentProps,
      "annotation" | "placement" | "hasExistingDraft"
    >
  >(
    () => ({
      onSubmit: onSubmitCompose,
      onCancel: onCancelCompose,
      target,
      account,
      headRef,
      baseRepoFull,
    }),
    [
      account,
      baseRepoFull,
      headRef,
      onCancelCompose,
      onSubmitCompose,
      target,
    ],
  );

  const renderAnnotation = useCallback(
    (rawAnnotation: ReviewRenderableAnnotation, item: ReviewCodeViewItem) => {
      const annotation = toDiffLineAnnotation(rawAnnotation);
      const filename = getCodeViewItemFilename(item);
      if (!useSideRail) {
        return (
          <ReviewAnnotationContent
            annotation={annotation}
            placement="inline"
            hasExistingDraft={pendingDraftPaths.has(filename)}
            {...annotationContentProps}
          />
        );
      }
      return (
        <SideAnnotationAnchor
          id={reviewAnnotationKey(filename, annotation)}
          active={
            annotation.metadata.kind === "thread" &&
            annotation.metadata.root.id === focusedCommentId
          }
          lineCount={
            annotation.metadata.kind === "thread"
              ? (getReviewCommentRange(annotation.metadata.root)?.lineCount ??
                1)
              : 1
          }
        />
      );
    },
    [
      annotationContentProps,
      focusedCommentId,
      pendingDraftPaths,
      useSideRail,
    ],
  );

  const renderHeaderPrefix = useCallback(
    (item: ReviewCodeViewItem) => {
      const filename = getCodeViewItemFilename(item);
      const collapsed = collapsedSet.has(filename);
      return (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={collapsed ? "Expand file" : "Collapse file"}
          aria-pressed={collapsed}
          title="Click to toggle · Option/Alt-click to toggle all"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleFile(filename, e.altKey);
          }}
          className="-ml-1"
        >
          <ChevronDown
            className="transition-transform"
            style={{ transform: collapsed ? "rotate(-90deg)" : undefined }}
          />
        </Button>
      );
    },
    [collapsedSet, toggleFile],
  );

  const renderHeaderMetadata = useCallback(
    (item: ReviewCodeViewItem) => {
      const file = filesByName.get(getCodeViewItemFilename(item));
      if (!file) return null;
      return (
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px]">
          {file.patch ? null : (
            <span className="text-muted-foreground/70">No patch</span>
          )}
          <span className="text-emerald-500">+{file.additions}</span>
          <span className="text-rose-500">-{file.deletions}</span>
        </span>
      );
    },
    [filesByName],
  );

  const handleScroll = useCallback(
    (
      _scrollTop: number,
      viewer: CodeViewInstance<ReviewAnnotationPayload>,
    ) => {
      if (
        typeof window === "undefined" ||
        activeUpdateFrameRef.current != null
      ) {
        return;
      }
      activeUpdateFrameRef.current = window.requestAnimationFrame(() => {
        activeUpdateFrameRef.current = null;
        const firstRendered = viewer.getRenderedItems()[0];
        if (!firstRendered) return;
        onActiveFileChange(getCodeViewItemFilename(firstRendered.item));
      });
    },
    [onActiveFileChange],
  );

  const codeViewStyle = useMemo<CSSProperties>(
    () => ({
      ...DIFF_HOST_STYLE,
      height: "calc(100vh - 92px)",
      minHeight: 360,
      overflowY: "auto",
      overflowX: "hidden",
      contain: "layout style size",
      background: "var(--card)",
    }),
    [],
  );

  return (
    <CodeView<ReviewAnnotationPayload>
      ref={viewerRef}
      containerRef={containerRef}
      items={items}
      options={options}
      onScroll={handleScroll}
      renderAnnotation={renderAnnotation}
      renderHeaderPrefix={renderHeaderPrefix}
      renderHeaderMetadata={renderHeaderMetadata}
      className="review-code-view min-w-0 rounded-md border border-border/50 bg-card"
      style={codeViewStyle}
    />
  );
}

type TreeFolderNode = {
  name: string;
  children: Map<string, TreeFolderNode>;
  file: PRFile | null;
};

function collectFolderPaths(node: TreeFolderNode, prefix = ""): string[] {
  const out: string[] = [];
  for (const [, child] of node.children) {
    const path = prefix ? `${prefix}/${child.name}` : child.name;
    if (child.file == null) out.push(path);
    out.push(...collectFolderPaths(child, path));
  }
  return out;
}

function buildTree(files: PRFile[]): TreeFolderNode {
  const root: TreeFolderNode = { name: "", children: new Map(), file: null };
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
function collapseSingleChildFolders(node: TreeFolderNode) {
  for (const [, child] of node.children) {
    while (child.file == null && child.children.size === 1) {
      const [onlyChild] = child.children.values() as IterableIterator<TreeFolderNode>;
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
  commentsByFile,
  onSelect,
  depth,
  collapsed,
  onToggle,
}: {
  node: TreeFolderNode;
  path: string;
  activeFile: string | null;
  commentsByFile: Record<string, unknown[]>;
  onSelect: (filename: string) => void;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
}) {
  const INDENT = 8;
  const indent = depth * INDENT;
  return (
    <ul>
      {Array.from(node.children.values()).map((child) => {
        const nextPath = path ? `${path}/${child.name}` : child.name;
        if (child.file) {
          const active = activeFile === child.file.filename;
          const hasComments =
            (commentsByFile[child.file.filename]?.length ?? 0) > 0;
          return (
            <li key={nextPath}>
              <button
                type="button"
                onClick={() => onSelect(child.file!.filename)}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-md py-[3px] pr-1.5 text-left text-[12px] hover:bg-muted",
                  hasComments &&
                    "bg-amber-500/10 text-foreground hover:bg-amber-500/15",
                  active && "bg-muted text-foreground",
                  active && hasComments && "bg-amber-500/15",
                )}
                style={{ paddingLeft: 6 + indent + 14 }}
              >
                <FileIcon name={child.name} className="size-3.5 shrink-0" />
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
              className="flex w-full items-center gap-1 rounded-md py-[3px] pr-1.5 text-left text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
              style={{ paddingLeft: 4 + indent }}
              aria-expanded={!isCollapsed}
            >
              <ChevronRight
                className="size-3 shrink-0 text-muted-foreground/70 transition-transform"
                style={{
                  transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)",
                }}
              />
              {isCollapsed ? (
                <FolderIcon name={child.name} className="size-3.5 shrink-0" />
              ) : (
                <OpenFolderIcon
                  name={child.name}
                  className="size-3.5 shrink-0"
                />
              )}
              <span className="flex-1 truncate font-mono">{child.name}</span>
            </button>
            {!isCollapsed ? (
              <TreeNode
                node={child}
                path={nextPath}
                activeFile={activeFile}
                commentsByFile={commentsByFile}
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

export function FileTreePanel({
  files,
  activeFile,
  commentsByFile,
  onSelect,
}: {
  files: PRFile[];
  activeFile: string | null;
  commentsByFile: Record<string, unknown[]>;
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
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files"
            className="h-7 pl-7 text-[12px]"
          />
        </div>
        <div className="flex items-center justify-between px-0.5 text-[11px] text-muted-foreground/70">
          <span>
            {filtered.length} of {files.length}
          </span>
          {allFolderPaths.length > 0 ? (
            <Button
              type="button"
              variant="link"
              size="xs"
              onClick={toggleAll}
              className="h-auto p-0 text-muted-foreground/70"
              title={allCollapsed ? "Expand all" : "Collapse all"}
            >
              {allCollapsed ? "Expand all" : "Collapse all"}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="p-2">
        <TreeNode
          node={tree}
          path=""
          activeFile={activeFile}
          commentsByFile={commentsByFile}
          onSelect={onSelect}
          depth={0}
          collapsed={collapsed}
          onToggle={toggleFolder}
        />
      </div>
    </div>
  );
}

export function DiffModeToggle({
  mode,
  onChange,
}: {
  mode: DiffMode;
  onChange: (m: DiffMode) => void;
}) {
  return (
    <ToggleGroup
      value={[mode]}
      onValueChange={(v) => {
        const next = v[0];
        if (next === "split" || next === "unified") onChange(next);
      }}
      variant="outline"
      size="default"
    >
      <ToggleGroupItem value="split">Split</ToggleGroupItem>
      <ToggleGroupItem value="unified">Unified</ToggleGroupItem>
    </ToggleGroup>
  );
}

export function DiffSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="overflow-hidden rounded-md border border-border/50"
        >
          <Skeleton className="h-9 w-full rounded-md" />
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
