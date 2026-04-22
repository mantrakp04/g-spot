import {
  useCallback,
  useMemo,
  useState,
  forwardRef,
  type CSSProperties,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
  Search,
} from "lucide-react";
import type { OAuthConnection } from "@stackframe/react";

import { MultiFileDiff, PatchDiff } from "@pierre/diffs/react";
import type { DiffLineAnnotation, FileContents } from "@pierre/diffs";

import { Button } from "@g-spot/ui/components/button";
import { Input } from "@g-spot/ui/components/input";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@g-spot/ui/components/toggle-group";

import type { ReviewComment, ReviewTarget } from "@/hooks/use-github-detail";
import { useGitHubFileContents } from "@/hooks/use-github-detail";
import {
  useActiveCompose,
  usePendingComments,
  type PendingCommentsKey,
} from "@/hooks/use-pending-comments";
import { mergeRefs } from "@/lib/merge-refs";

import { useDiffCustomization } from "./diff-customizer";
import { useFileCollapse } from "./diff-collapse-state";
import { InlineComposer } from "./inline-composer";
import { InlineThread } from "./inline-thread";

export type PRFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  sha: string;
};

export type DiffMode = "unified" | "split";

type AnnotationPayload =
  | {
      kind: "thread";
      root: ReviewComment;
      replies: ReviewComment[];
    }
  | {
      kind: "compose";
      startLine?: number;
    };

// Map the app's design tokens into pierre's diff shadow DOM via its real
// custom property surface (see node_modules/@pierre/diffs/dist/**.css). CSS
// custom properties inherit across shadow boundaries, so setting them on the
// host is enough.
const DIFF_HOST_STYLE = {
  "--diffs-font-family":
    "ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, monospace",
  "--diffs-font-size": "12px",
  "--diffs-line-height": "1.55",
  "--diffs-bg": "var(--card)",
  "--diffs-fg": "var(--foreground)",
} as CSSProperties;

function sideToGithub(side: "deletions" | "additions"): "LEFT" | "RIGHT" {
  return side === "deletions" ? "LEFT" : "RIGHT";
}

function githubSideToPierre(
  side: "LEFT" | "RIGHT",
): "deletions" | "additions" {
  return side === "LEFT" ? "deletions" : "additions";
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

function buildAnnotations(
  comments: ReviewComment[],
  compose:
    | { side: "LEFT" | "RIGHT"; line: number; startLine?: number }
    | null,
): DiffLineAnnotation<AnnotationPayload>[] {
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

  const out: DiffLineAnnotation<AnnotationPayload>[] = [];
  for (const root of roots) {
    const line = root.line ?? root.originalLine;
    if (line == null) continue;
    out.push({
      side: githubSideToPierre(root.side),
      lineNumber: line,
      metadata: {
        kind: "thread",
        root,
        replies: repliesByRoot.get(root.id) ?? [],
      },
    });
  }

  if (compose) {
    out.push({
      side: githubSideToPierre(compose.side),
      lineNumber: compose.line,
      metadata: { kind: "compose", startLine: compose.startLine },
    });
  }
  return out;
}

export const FileDiffCard = forwardRef<
  HTMLDivElement,
  {
    file: PRFile;
    isActive?: boolean;
    mode?: DiffMode;
    comments?: ReviewComment[];
    target: ReviewTarget;
    account: OAuthConnection | null;
    baseSha?: string;
    headSha?: string;
    headRef?: string;
    pendingKey: PendingCommentsKey;
  }
>(function FileDiffCard(
  {
    file,
    isActive,
    mode = "split",
    comments = [],
    target,
    account,
    baseSha,
    headSha,
    headRef,
    pendingKey,
  },
  ref,
) {
  const { collapsed, toggle: toggleCollapsed } = useFileCollapse(file.filename);
  const customization = useDiffCustomization();

  const pendingForPR = usePendingComments(pendingKey);
  const hasExistingDraft = useMemo(
    () => pendingForPR.some((p) => p.path === file.filename),
    [pendingForPR, file.filename],
  );

  const {
    active,
    start: rawStartCompose,
    cancel: cancelCompose,
    submit: submitCompose,
  } = useActiveCompose(pendingKey);

  const composeForFile =
    active && active.path === file.filename ? active : null;

  const onLineSelectionEnd = useCallback(
    (range: {
      start: number;
      end: number;
      side?: "deletions" | "additions";
      endSide?: "deletions" | "additions";
    } | null) => {
      if (!range) return;
      const side = sideToGithub(range.endSide ?? range.side ?? "additions");
      const line = range.end;
      const startLine = range.start !== range.end ? range.start : undefined;
      rawStartCompose({
        path: file.filename,
        side,
        line,
        startLine,
      });
    },
    [rawStartCompose, file.filename],
  );

  const lineAnnotations = useMemo(
    () => buildAnnotations(comments, composeForFile),
    [comments, composeForFile],
  );

  const baseRepoFull = `${target.owner}/${target.repo}`;

  const renderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<AnnotationPayload>) => {
      const payload = annotation.metadata;
      if (payload.kind === "compose") {
        return (
          <InlineComposer
            hasExistingDraft={hasExistingDraft}
            onSubmit={submitCompose}
            onCancel={cancelCompose}
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
        />
      );
    },
    [
      hasExistingDraft,
      submitCompose,
      cancelCompose,
      target,
      account,
      headRef,
      baseRepoFull,
    ],
  );

  const renderHeaderPrefix = useCallback(
    () => (
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
          toggleCollapsed(e.altKey);
        }}
        className="-ml-1"
      >
        <ChevronDown
          className="transition-transform"
          style={{ transform: collapsed ? "rotate(-90deg)" : undefined }}
        />
      </Button>
    ),
    [collapsed, toggleCollapsed],
  );

  // Pierre's context-expansion controls need full file contents — the
  // patch-only path produces a "partial" FileDiff which pierre marks
  // non-expandable. Lazy-load both sides (skipped entirely for added/deleted
  // files since one side has no prior/next state) and switch to MultiFileDiff
  // once they resolve. While loading, render PatchDiff so the diff shows
  // immediately.
  const isAdded = file.status === "added";
  const isDeleted = file.status === "removed" || file.status === "deleted";

  const oldContents = useGitHubFileContents(
    target,
    account,
    file.filename,
    baseSha ?? null,
    !collapsed && !!baseSha && !isAdded,
  );
  const newContents = useGitHubFileContents(
    target,
    account,
    file.filename,
    headSha ?? null,
    !collapsed && !!headSha && !isDeleted,
  );

  const oldFile = useMemo<FileContents | null>(() => {
    if (isAdded) return { name: file.filename, contents: "" };
    if (oldContents.data == null) return null;
    return { name: file.filename, contents: oldContents.data };
  }, [isAdded, oldContents.data, file.filename]);

  const newFile = useMemo<FileContents | null>(() => {
    if (isDeleted) return { name: file.filename, contents: "" };
    if (newContents.data == null) return null;
    return { name: file.filename, contents: newContents.data };
  }, [isDeleted, newContents.data, file.filename]);

  const canUseMultiFile = oldFile != null && newFile != null;

  if (!file.patch) {
    return (
      <div
        ref={mergeRefs(ref)}
        data-active={isActive ? "true" : "false"}
        className="rounded-md border border-border/50 bg-card px-4 py-6 text-center text-[12px] text-muted-foreground/70 data-[active=true]:border-primary/50"
      >
        Binary file or no patch available · {file.filename}
      </div>
    );
  }

  const sharedOptions = {
    diffStyle: mode,
    enableLineSelection: true,
    onLineSelectionEnd,
    collapsed,
    hunkSeparators: "line-info" as const,
    expansionLineCount: 20,
    lineDiffType: customization.lineDiffType,
    disableBackground: !customization.backgrounds,
    overflow: (customization.wrapping ? "wrap" : "scroll") as "wrap" | "scroll",
    disableLineNumbers: !customization.lineNumbers,
  };

  return (
    <div
      ref={mergeRefs(ref)}
      data-active={isActive ? "true" : "false"}
      className="overflow-hidden rounded-md border border-border/50 bg-card data-[active=true]:border-primary/50"
    >
      {canUseMultiFile ? (
        <MultiFileDiff<AnnotationPayload>
          oldFile={oldFile}
          newFile={newFile}
          options={sharedOptions}
          style={DIFF_HOST_STYLE}
          lineAnnotations={lineAnnotations}
          renderAnnotation={renderAnnotation}
          renderHeaderPrefix={renderHeaderPrefix}
        />
      ) : (
        <PatchDiff<AnnotationPayload>
          patch={buildUnifiedPatch(file)}
          options={sharedOptions}
          style={DIFF_HOST_STYLE}
          lineAnnotations={lineAnnotations}
          renderAnnotation={renderAnnotation}
          renderHeaderPrefix={renderHeaderPrefix}
        />
      )}
    </div>
  );
});

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
  onSelect,
  depth,
  collapsed,
  onToggle,
}: {
  node: TreeFolderNode;
  path: string;
  activeFile: string | null;
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
          return (
            <li key={nextPath}>
              <button
                type="button"
                onClick={() => onSelect(child.file!.filename)}
                className={`flex w-full items-center gap-1.5 rounded-md py-[3px] pr-1.5 text-left text-[12px] hover:bg-muted ${
                  active ? "bg-muted text-foreground" : ""
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

