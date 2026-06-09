import {
  type ComponentProps,
  type RefObject,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { OAuthConnection } from "@hexclave/react";
import { Button } from "@g-spot/ui/components/button";
import { Kbd } from "@g-spot/ui/components/kbd";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@g-spot/ui/components/hover-card";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  FileText,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@g-spot/ui/lib/utils";
import { useVirtualizer } from "@tanstack/react-virtual";

import type {
  ReviewComment,
  ReviewTarget,
  StackNode,
  TimelineEvent,
} from "@/hooks/use-github-detail";
import {
  useGitHubPRChecks,
  useGitHubPRCommits,
  useGitHubPRDetail,
  useGitHubPRFiles,
  useGitHubPRReviewComments,
  useGitHubPRStack,
  useGitHubPRTimeline,
} from "@/hooks/use-github-detail";
import { useKeybinds } from "@/lib/keybinds";
import { CommitSelector, type CommitRange } from "./commit-selector";
import { useExpandFile, useSetAllFiles } from "./diff-collapse-state";
import { DiffCustomizerMenu } from "./diff-customizer";

import {
  useActiveCompose,
  usePendingComments,
} from "@/hooks/use-pending-comments";
import {
  getPendingCommentsKey,
  getPRReviewState,
} from "@/lib/review/pr-review-state";
import {
  useReviewDiffMode,
  useReviewTreeOpen,
} from "@/lib/review/review-preferences";

// Sticky top strip (48px) + files toolbar (48px). Crossing this means the
// Files section is pinned; switch the floating pill from "skip to code" to
// "back to top".
const STICKY_HEADER_OFFSET_PX = 96;

import { PRActionBar } from "./action-bar";
import { CommentsDrawer } from "./comments-drawer";
import {
  ActivitySection,
  DescriptionCard,
  SectionHeading,
} from "./overview-region";
import {
  DiffModeToggle,
  DiffSkeleton,
  FileDiffCard,
  FileTreePanel,
  ReviewAnnotationContent,
  type ReviewAnnotationContentProps,
  type PRFile,
} from "./diff-viewer";
import { PRCondensedHeader, PRFullHeader } from "./pr-header";
import { PRSidebar } from "./pr-sidebar";
import {
  buildReviewAnnotations,
  getReviewCommentLine,
  reviewAnnotationKey,
} from "./review-annotations";
import { ReviewShell } from "./shell";
import { Timeline, TimelineSkeleton } from "./timeline";

const FILE_EXPAND_LIMIT = 50;
const EMPTY_COMMENTS: never[] = [];
const SIDE_COMMENT_RAIL_MEDIA_QUERY = "(min-width: 1024px)";
const SIDE_COMMENT_RAIL_ANCHOR_OFFSET = 18;
const SIDE_COMMENT_RAIL_CARD_GAP = 8;

type SideCommentRailItem = {
  key: string;
  annotation: ReturnType<typeof buildReviewAnnotations>[number];
  hasExistingDraft: boolean;
};

function sameRailLayout(a: Record<string, number>, b: Record<string, number>) {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

function getSideAnchor(root: HTMLElement | null, key: string) {
  if (!root) return null;
  const anchors =
    root.querySelectorAll<HTMLElement>("[data-review-side-anchor]");
  for (const anchor of anchors) {
    if (anchor.dataset.reviewSideAnchor === key) return anchor;
  }
  return null;
}

function isSideAnchorInsideFileRow(anchor: HTMLElement) {
  const row = anchor.closest<HTMLElement>("[data-filename]");
  if (!row) return true;

  const anchorRect = anchor.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  return (
    anchorRect.top >= rowRect.top - 1 &&
    anchorRect.top <= rowRect.bottom + 1
  );
}

function SideCommentRail({
  items,
  contentProps,
  layoutVersion,
  anchorRootRef,
  focusedCommentId,
  onFocusComment,
}: {
  items: SideCommentRailItem[];
  contentProps: Omit<
    ReviewAnnotationContentProps,
    "annotation" | "placement" | "hasExistingDraft"
  >;
  layoutVersion: string;
  anchorRootRef: RefObject<HTMLElement | null>;
  focusedCommentId: number | null;
  onFocusComment: (commentId: number) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cardNodesRef = useRef<Map<string, HTMLElement> | null>(null);
  if (cardNodesRef.current === null) {
    cardNodesRef.current = new Map();
  }
  const cardNodes = cardNodesRef.current;
  const measureTimerRef = useRef<number | null>(null);
  const requestMeasureRef = useRef<() => void>(() => {});
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [measuredHeight, setMeasuredHeight] = useState(0);

  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root || items.length === 0) {
      setPositions((current) =>
        Object.keys(current).length === 0 ? current : {},
      );
      setMeasuredHeight((current) => (current === 0 ? current : 0));
      return;
    }

    const rootTop = root.getBoundingClientRect().top;
    const measurements: Array<{
      key: string;
      anchorTop: number;
      cardHeight: number;
    }> = [];
    const next: Record<string, number> = {};
    let nextHeight = 0;

    for (const item of items) {
      const anchor = getSideAnchor(anchorRootRef.current, item.key);
      if (!anchor) continue;
      if (!isSideAnchorInsideFileRow(anchor)) continue;

      const cardHeight =
        cardNodes.get(item.key)?.getBoundingClientRect().height ?? 72;
      const anchorTop =
        anchor.getBoundingClientRect().top -
        rootTop -
        SIDE_COMMENT_RAIL_ANCHOR_OFFSET;
      measurements.push({
        key: item.key,
        anchorTop: Math.max(0, Math.round(anchorTop)),
        cardHeight,
      });
    }

    measurements.sort((a, b) => a.anchorTop - b.anchorTop);
    let previousBottom = 0;
    for (const measurement of measurements) {
      const top = Math.max(measurement.anchorTop, previousBottom);
      next[measurement.key] = top;
      previousBottom = top + measurement.cardHeight + SIDE_COMMENT_RAIL_CARD_GAP;
      nextHeight = Math.max(nextHeight, top + measurement.cardHeight);
    }

    setPositions((current) =>
      sameRailLayout(current, next) ? current : next,
    );
    setMeasuredHeight((current) =>
      current === nextHeight ? current : nextHeight,
    );
  }, [anchorRootRef, cardNodes, items]);

  const requestMeasure = useCallback(() => {
    if (typeof window === "undefined" || measureTimerRef.current != null) {
      return;
    }
    measureTimerRef.current = window.setTimeout(() => {
      measureTimerRef.current = null;
      measure();
    }, 0);
  }, [measure]);

  useLayoutEffect(() => {
    requestMeasureRef.current = requestMeasure;
  }, [requestMeasure]);

  const setCardNode = useCallback(
    (key: string, node: HTMLElement | null) => {
      if (node) {
        cardNodes.set(key, node);
      } else {
        cardNodes.delete(key);
      }
      requestMeasure();
    },
    [cardNodes, requestMeasure],
  );

  useLayoutEffect(() => {
    requestMeasure();

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(requestMeasure);
    if (rootRef.current) observer?.observe(rootRef.current);
    for (const card of cardNodes.values()) {
      observer?.observe(card);
    }

    return () => observer?.disconnect();
  }, [cardNodes, items, layoutVersion, requestMeasure]);

  useLayoutEffect(() => {
    requestMeasure();

    const root = anchorRootRef.current;
    if (!root || typeof MutationObserver === "undefined") return;

    const observer = new MutationObserver(requestMeasure);
    observer.observe(root, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [anchorRootRef, items, layoutVersion, requestMeasure]);

  useLayoutEffect(() => {
    const handleResize = () => requestMeasureRef.current();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useLayoutEffect(
    () => () => {
      if (measureTimerRef.current != null) {
        window.clearTimeout(measureTimerRef.current);
        measureTimerRef.current = null;
      }
    },
    [],
  );

  return (
    <div
      ref={rootRef}
      data-review-comment-rail="true"
      data-review-comment-rail-items={items.length}
      data-review-comment-rail-positions={Object.keys(positions).length}
      className="relative min-w-0 overflow-visible"
      style={{ height: measuredHeight }}
    >
      {items.map((item) => {
        const top = positions[item.key];
        if (top == null) return null;
        const commentId =
          item.annotation.metadata.kind === "thread"
            ? item.annotation.metadata.root.id
            : null;

        return (
          <div
            key={item.key}
            ref={(node) => setCardNode(item.key, node)}
            data-review-side-rail-card-active={
              commentId != null && commentId === focusedCommentId
                ? "true"
                : undefined
            }
            onClickCapture={() => {
              if (commentId != null) onFocusComment(commentId);
            }}
            className="pointer-events-auto absolute left-0 right-0 top-0 z-10"
            style={{ transform: `translateY(${top}px)` }}
          >
            <ReviewAnnotationContent
              annotation={item.annotation}
              placement="side"
              hasExistingDraft={item.hasExistingDraft}
              {...contentProps}
            />
          </div>
        );
      })}
    </div>
  );
}

function commentAnchorSelector(commentId: number) {
  return `[data-review-comment-id="${commentId}"]`;
}

function scrollAnchorVerticallyInto(
  anchor: HTMLElement,
  scrollRoot: HTMLElement,
) {
  const anchorRect = anchor.getBoundingClientRect();
  const rootRect = scrollRoot.getBoundingClientRect();
  const verticalOffset =
    anchorRect.height > rootRect.height
      ? 56
      : Math.max(0, (rootRect.height - anchorRect.height) / 2);
  const top =
    scrollRoot.scrollTop +
    anchorRect.top -
    rootRect.top -
    verticalOffset;

  scrollRoot.scrollTo({
    top: Math.max(0, top),
    behavior: "auto",
  });
}

// Rough px guess: header (~36) + per-line (~18) capped so an enormous file
// doesn't reserve a screen-and-a-half of empty space.
function estimateDiffHeight(file: PRFile): number {
  const lines = (file.additions ?? 0) + (file.deletions ?? 0);
  return 36 + Math.min(lines, 40) * 18;
}

function FileRailHandle({
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
  return (
    <HoverCard>
      <HoverCardTrigger
        render={
          <div className="sticky top-0 flex h-[calc(100vh-48px)] flex-col items-center justify-center gap-[2px] overflow-hidden py-4">
            {files.map((f) => {
              const active = f.filename === activeFile;
              const attention = (commentsByFile[f.filename]?.length ?? 0) > 0;
              return (
                <button
                  key={f.filename}
                  type="button"
                  aria-label={f.filename}
                  onClick={() => onSelect(f.filename)}
                  data-active={active}
                  data-attention={attention}
                  title={f.filename}
                  className={cn(
                    "h-[3px] w-[5px] shrink-0 rounded-md transition-colors",
                    active
                      ? "bg-primary"
                      : attention
                        ? "bg-amber-500"
                        : "bg-muted-foreground/25 hover:bg-muted-foreground/60",
                  )}
                />
              );
            })}
          </div>
        }
      />
      <HoverCardContent
        side="right"
        align="start"
        className="w-[280px] overflow-hidden p-0"
      >
        <div className="max-h-[calc(100vh-96px)] overflow-y-auto">
          <FileTreePanel
            files={files}
            activeFile={activeFile}
            commentsByFile={commentsByFile}
            onSelect={onSelect}
          />
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function FloatingPill({
  visible,
  absolute,
  children,
}: {
  visible: boolean;
  absolute?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      // `inert` on the wrapper blocks focus without aria-hiding focused
      // descendants, which was triggering the browser focus/aria warning.
      inert={!visible || undefined}
      className={cn(
        "transition-all duration-300 ease-out",
        absolute && "absolute inset-0 flex justify-center",
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-4 opacity-0",
      )}
    >
      {children}
    </div>
  );
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function PRReviewView({
  target,
  account,
}: {
  target: ReviewTarget;
  account: OAuthConnection | null;
}) {
  const detail = useGitHubPRDetail(target, account);
  const [commitRange, setCommitRange] = useState<CommitRange>(null);
  const files = useGitHubPRFiles(target, account, commitRange);
  const commits = useGitHubPRCommits(target, account);
  const timeline = useGitHubPRTimeline(target, account);
  const checks = useGitHubPRChecks(target, account, detail.data?.head.sha);
  const stack = useGitHubPRStack(target, account, detail.data);
  const reviewComments = useGitHubPRReviewComments(target, account);

  const pendingKey = useMemo(
    () => getPendingCommentsKey(target),
    [target.owner, target.repo, target.number],
  );
  const pendingInlineComments = usePendingComments(pendingKey);
  const {
    active: activeCompose,
    cancel: cancelSideCompose,
    submit: submitSideCompose,
  } = useActiveCompose(pendingKey);
  const pendingDraftPaths = useMemo(
    () => new Set(pendingInlineComments.map((pending) => pending.path)),
    [pendingInlineComments],
  );

  const [diffMode, setDiffMode] = useReviewDiffMode();
  const [treeOpen, setTreeOpen] = useReviewTreeOpen();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
  const [focusedCommentId, setFocusedCommentId] = useState<number | null>(null);

  const pr = detail.data;
  const baseRepoFull = `${target.owner}/${target.repo}`;
  const sideRailContentProps = useMemo<
    Omit<
      ReviewAnnotationContentProps,
      "annotation" | "placement" | "hasExistingDraft"
    >
  >(
    () => ({
      onSubmit: submitSideCompose,
      onCancel: cancelSideCompose,
      target,
      account,
      headRef: pr?.head.ref,
      baseRepoFull,
    }),
    [
      submitSideCompose,
      cancelSideCompose,
      target,
      account,
      pr?.head.ref,
      baseRepoFull,
    ],
  );

  const fileList = useMemo(() => {
    return (files.data ?? []) as unknown as PRFile[];
  }, [files.data]);
  // The persisted query-options spread collapses these hooks' `TData` to `{}`
  // / `unknown` at the call site (see use-github-detail's OctokitData note).
  // Re-pin them to the concrete shapes their `queryFn`s actually return.
  const reviewCommentsByPath = reviewComments.data as
    | Record<string, ReviewComment[]>
    | undefined;
  const timelineEvents = timeline.data as TimelineEvent[] | undefined;
  const stackNodes = stack.data as StackNode[] | undefined;
  const prCommits = commits.data as
    | ComponentProps<typeof CommitSelector>["commits"];

  const reviewState = getPRReviewState({
    detailLoading: detail.isLoading,
    filesLoading: files.isLoading,
    timelineLoading: timeline.isLoading,
    reviewComments: reviewCommentsByPath,
  });
  const virtualListRef = useRef<HTMLDivElement | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const [virtualScrollMargin, setVirtualScrollMargin] = useState(0);
  const [sideRailAvailable, setSideRailAvailable] = useState(false);
  const useSideCommentRail = rightSidebarOpen && sideRailAvailable;
  const sideCommentRailItems = useMemo<SideCommentRailItem[]>(() => {
    if (!useSideCommentRail) return [];

    return fileList.flatMap((file) => {
      const composeForFile =
        activeCompose && activeCompose.path === file.filename
          ? activeCompose
          : null;
      return buildReviewAnnotations(
        reviewCommentsByPath?.[file.filename] ?? EMPTY_COMMENTS,
        composeForFile,
      ).map((annotation) => ({
        key: reviewAnnotationKey(file.filename, annotation),
        annotation,
        hasExistingDraft: pendingDraftPaths.has(file.filename),
      }));
    });
  }, [
    activeCompose,
    fileList,
    pendingDraftPaths,
    reviewCommentsByPath,
    useSideCommentRail,
  ]);

  useLayoutEffect(() => {
    const update = () => {
      setSideRailAvailable(
        window.matchMedia(SIDE_COMMENT_RAIL_MEDIA_QUERY).matches,
      );
    };

    const media = window.matchMedia(SIDE_COMMENT_RAIL_MEDIA_QUERY);
    update();
    media.addEventListener("change", update);

    return () => {
      media.removeEventListener("change", update);
    };
  }, []);

  const setAllFiles = useSetAllFiles();
  const expandFile = useExpandFile();
  useEffect(() => {
    setAllFiles(
      fileList.map((f) => f.filename),
      FILE_EXPAND_LIMIT,
    );
  }, [fileList, setAllFiles]);
  const filesSectionRef = useRef<HTMLDivElement | null>(null);
  const pendingCommentScrollRef = useRef<number | null>(null);
  const [floatingState, setFloatingState] = useState<"skip" | "top">("skip");

  const cancelPendingCommentScroll = useCallback(() => {
    if (
      typeof window !== "undefined" &&
      pendingCommentScrollRef.current != null
    ) {
      window.clearTimeout(pendingCommentScrollRef.current);
      pendingCommentScrollRef.current = null;
    }
  }, []);

  useEffect(() => cancelPendingCommentScroll, [cancelPendingCommentScroll]);

  useEffect(() => {
    const nextScrollElement = filesSectionRef.current?.closest(
      ".overflow-y-auto",
    ) as HTMLElement | null;
    setScrollElement(nextScrollElement);
  }, [fileList.length]);

  useEffect(() => {
    if (!scrollElement) return;

    const updateScrollMargin = () => {
      const list = virtualListRef.current;
      if (!list) return;

      const listRect = list.getBoundingClientRect();
      const scrollRect = scrollElement.getBoundingClientRect();
      setVirtualScrollMargin(
        listRect.top - scrollRect.top + scrollElement.scrollTop,
      );
    };

    updateScrollMargin();
    window.addEventListener("resize", updateScrollMargin);

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateScrollMargin);
    if (filesSectionRef.current) observer?.observe(filesSectionRef.current);

    return () => {
      window.removeEventListener("resize", updateScrollMargin);
      observer?.disconnect();
    };
  }, [scrollElement, fileList.length]);

  const fileVirtualizer = useVirtualizer({
    count: fileList.length,
    getItemKey: (index) => fileList[index]?.filename ?? index,
    getScrollElement: () => scrollElement,
    estimateSize: (index) => estimateDiffHeight(fileList[index]!) + 12,
    onChange: (instance) => {
      const virtualFiles = instance.getVirtualItems();
      const visibleTop = (scrollElement?.scrollTop ?? 0) + 56;
      const firstVisible =
        virtualFiles.find((item) => item.end > visibleTop) ?? virtualFiles[0];
      const filename = firstVisible
        ? fileList[firstVisible.index]?.filename
        : null;
      if (!filename) return;
      setActiveFile((prev) => (prev === filename ? prev : filename));
    },
    overscan: 4,
    scrollMargin: virtualScrollMargin,
  });

  useEffect(() => {
    const el = filesSectionRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setFloatingState(
        rect.top <= STICKY_HEADER_OFFSET_PX ? "top" : "skip",
      );
    };
    update();
    const scrollParent = el.closest(".overflow-y-auto") as HTMLElement | null;
    const target = scrollParent ?? window;
    target.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      target.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [fileList.length]);

  const scrollToFiles = useCallback(() => {
    filesSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);
  const scrollToTop = useCallback(() => {
    const el = filesSectionRef.current?.closest(
      ".overflow-y-auto",
    ) as HTMLElement | null;
    if (el) el.scrollTo({ top: 0, behavior: "smooth" });
    else window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (activeFile == null && fileList.length > 0) {
      setActiveFile(fileList[0]!.filename);
    }
  }, [fileList, activeFile]);

  const scrollToFile = useCallback(
    (filename: string) => {
      cancelPendingCommentScroll();
      const index = fileList.findIndex((f) => f.filename === filename);
      if (index === -1) return;

      setActiveFile(filename);
      fileVirtualizer.scrollToIndex(index, {
        align: "start",
        behavior: "auto",
      });
    },
    [cancelPendingCommentScroll, fileList, fileVirtualizer],
  );

  const scrollToComment = useCallback(
    ({ path, commentId }: { path: string; commentId: number }) => {
      cancelPendingCommentScroll();
      const comment = reviewCommentsByPath?.[path]?.find(
        (item) => item.id === commentId,
      );
      if (comment && getReviewCommentLine(comment) == null) {
        setFocusedCommentId(null);
        scrollToFile(path);
        return;
      }

      expandFile(path);
      scrollToFile(path);
      setFocusedCommentId(null);

      let attempts = 0;
      const selector = commentAnchorSelector(commentId);
      const tryScroll = () => {
        pendingCommentScrollRef.current = null;
        const anchor = document.querySelector<HTMLElement>(selector);
        if (anchor) {
          setFocusedCommentId(commentId);
          const scrollRoot =
            scrollElement ??
            (filesSectionRef.current?.closest(
              ".overflow-y-auto",
            ) as HTMLElement | null);
          if (scrollRoot) {
            scrollAnchorVerticallyInto(anchor, scrollRoot);
          }
          return;
        }

        attempts += 1;
        if (attempts < 20) {
          pendingCommentScrollRef.current = window.setTimeout(tryScroll, 50);
        }
      };

      pendingCommentScrollRef.current = window.setTimeout(tryScroll, 0);
    },
    [
      cancelPendingCommentScroll,
      expandFile,
      reviewCommentsByPath,
      scrollElement,
      scrollToFile,
    ],
  );

  const jumpFile = (direction: -1 | 1) => {
    if (fileList.length === 0) return;
    const idx = fileList.findIndex((f) => f.filename === activeFile);
    const nextIdx =
      direction === 1
        ? Math.min(fileList.length - 1, idx + 1)
        : Math.max(0, idx - 1);
    const next = fileList[nextIdx];
    if (next) scrollToFile(next.filename);
  };

  useKeybinds([
    { id: "review.nextFile", callback: () => jumpFile(1) },
    { id: "review.prevFile", callback: () => jumpFile(-1) },
  ]);

  const repoLabel = `${target.owner}/${target.repo}`;

  const fullHeader = pr ? (
    <PRFullHeader
      repoLabel={repoLabel}
      number={pr.number}
      title={pr.title}
      url={pr.html_url}
      author={
        pr.user
          ? { login: pr.user.login, avatarUrl: pr.user.avatar_url }
          : null
      }
      headBranch={pr.head.ref}
      baseBranch={pr.base.ref}
      filesChanged={pr.changed_files ?? 0}
      additions={pr.additions ?? 0}
      deletions={pr.deletions ?? 0}
      updatedAgo={relativeTime(pr.updated_at)}
      stack={stackNodes ?? []}
      target={target}
      account={account}
      canChangeBase={pr.state === "open" && !pr.merged}
    />
  ) : (
    <HeaderSkeleton />
  );

  const condensedHeader = pr ? (
    <PRCondensedHeader number={pr.number} title={pr.title} />
  ) : (
    <div className="h-10" />
  );

  const metadataSidebar = pr ? (
    <PRSidebar
      pr={pr}
      target={target}
      account={account}
      checks={checks.data ?? []}
      checksLoading={checks.isLoading}
    />
  ) : (
    <SidebarSkeleton />
  );
  const virtualFiles = fileVirtualizer.getVirtualItems();
  const virtualTotalSize = fileVirtualizer.getTotalSize();
  const sideRailLayoutVersion = useMemo(
    () =>
      virtualFiles
        .map((item) => `${item.key}:${item.start}:${item.size}`)
        .join("|"),
    [virtualFiles],
  );
  const sidebar = useSideCommentRail ? (
    <div className="space-y-4">
      <div data-review-metadata-sidebar="true">{metadataSidebar}</div>
      <SideCommentRail
        items={sideCommentRailItems}
        contentProps={sideRailContentProps}
        layoutVersion={sideRailLayoutVersion}
        anchorRootRef={virtualListRef}
        focusedCommentId={focusedCommentId}
        onFocusComment={setFocusedCommentId}
      />
    </div>
  ) : (
    metadataSidebar
  );

  const main = (
    <div className="space-y-8">
      <section>
        <SectionHeading>Description</SectionHeading>
        {detail.isLoading || !pr ? (
          <Skeleton className="h-32 w-full rounded-md" />
        ) : (
          <DescriptionCard markdown={pr.body} />
        )}
      </section>

      <ActivitySection>
        {timeline.isLoading ? (
          <TimelineSkeleton />
        ) : (
          <Timeline
            events={timelineEvents ?? []}
            target={target}
            account={account}
          />
        )}
      </ActivitySection>

      <section ref={filesSectionRef} data-review-files-section="true">
        <div className="sticky top-0 z-10 -mx-4 flex items-center justify-between border-b border-border/50 bg-background px-4 py-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setTreeOpen((s) => !s)}
              aria-label={treeOpen ? "Hide file tree" : "Show file tree"}
              title={treeOpen ? "Hide file tree" : "Show file tree"}
            >
              {treeOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
            </Button>
            <h2 className="flex items-center gap-2 text-[13px] font-medium text-foreground">
              Files
              <span className="text-[13px] font-normal text-muted-foreground/70">
                {fileList.length}
              </span>
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {pr ? (
              <CommitSelector
                commits={prCommits}
                baseSha={pr.base.sha}
                headSha={pr.head.sha}
                range={commitRange}
                onChange={setCommitRange}
              />
            ) : null}
            <DiffModeToggle mode={diffMode} onChange={setDiffMode} />
            <DiffCustomizerMenu />
            <Button
              type="button"
              variant="outline"
              size="default"
              onClick={() => setCommentsOpen(true)}
              title="View comments"
            >
              <MessageSquare />
              {reviewState.inlineCommentCount}
            </Button>
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70">
              Press <Kbd>j</Kbd>/<Kbd>k</Kbd>
            </span>
          </div>
        </div>

        {files.isLoading ? (
          <DiffSkeleton />
        ) : fileList.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border/50 p-4 text-[13px] text-muted-foreground/70">
            <FileText className="size-4" />
            No file changes.
          </div>
        ) : (
          <div
            className={cn(
              "grid",
              treeOpen
                ? "grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)]"
                : "grid-cols-[16px_minmax(0,1fr)] gap-0",
            )}
          >
            {treeOpen ? (
              <div className="sticky top-[44px] h-[calc(100vh-92px)] self-start overflow-y-auto">
                <FileTreePanel
                  files={fileList}
                  activeFile={activeFile}
                  commentsByFile={reviewCommentsByPath ?? {}}
                  onSelect={scrollToFile}
                />
              </div>
            ) : (
              <FileRailHandle
                files={fileList}
                activeFile={activeFile}
                commentsByFile={reviewCommentsByPath ?? {}}
                onSelect={scrollToFile}
              />
            )}
            <div data-review-file-pane="true" className="min-w-0 py-3 pl-3">
              {fileList.length > FILE_EXPAND_LIMIT ? (
                <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-muted-foreground">
                  <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
                  This PR has {fileList.length} files. To improve performance,
                  only the first {FILE_EXPAND_LIMIT} files are expanded by
                  default; the rest are collapsed.
                </div>
              ) : null}
              <div className="relative">
                <div
                  ref={virtualListRef}
                  className="relative min-w-0"
                  style={{ height: virtualTotalSize }}
                >
                  {virtualFiles.map((virtualFile) => {
                    const f = fileList[virtualFile.index]!;
                    return (
                      <div
                        key={virtualFile.key}
                        data-index={virtualFile.index}
                        data-filename={f.filename}
                        ref={(el) => {
                          if (el) {
                            fileVirtualizer.measureElement(el);
                          }
                        }}
                        className="absolute left-0 top-0 w-full pb-3"
                        style={{
                          transform: `translateY(${
                            virtualFile.start - virtualScrollMargin
                          }px)`,
                        }}
                      >
                        <FileDiffCard
                          file={f}
                          isActive={activeFile === f.filename}
                          mode={diffMode}
                          comments={
                            reviewCommentsByPath?.[f.filename] ??
                            EMPTY_COMMENTS
                          }
                          target={target}
                          account={account}
                          baseSha={pr?.base.sha}
                          headSha={pr?.head.sha}
                          headRef={pr?.head.ref}
                          pendingKey={pendingKey}
                          annotationPlacement={
                            useSideCommentRail ? "side" : "inline"
                          }
                          focusedCommentId={focusedCommentId}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      <CommentsDrawer
        open={commentsOpen}
        onOpenChange={setCommentsOpen}
        commentsByFile={reviewCommentsByPath ?? {}}
        onJumpTo={(target) => {
          setCommentsOpen(false);
          scrollToComment(target);
        }}
      />

      <div className="fixed bottom-6 left-1/2 z-20 -translate-x-1/2">
        <FloatingPill visible={floatingState === "skip"}>
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={scrollToFiles}
            className="bg-card/95 shadow-lg backdrop-blur"
          >
            Skip to code
            <ArrowDown />
          </Button>
        </FloatingPill>
        <FloatingPill visible={floatingState === "top"} absolute>
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            onClick={scrollToTop}
            aria-label="Back to top"
            className="bg-card/95 shadow-lg backdrop-blur"
          >
            <ArrowUp />
          </Button>
        </FloatingPill>
      </div>
    </div>
  );

  return (
    <ReviewShell
      isLoading={reviewState.isLoading}
      fullHeader={fullHeader}
      condensedHeader={condensedHeader}
      main={main}
      rightSidebar={sidebar}
      sidebarOpen={rightSidebarOpen}
      onSidebarOpenChange={setRightSidebarOpen}
      rightSidebarSticky={!useSideCommentRail}
      actions={
        pr ? (
          <PRActionBar
            pr={pr}
            account={account}
            target={target}
            pendingInlineCommentCount={pendingInlineComments.length}
          />
        ) : null
      }
    />
  );
}

function HeaderSkeleton() {
  return (
    <div className="space-y-3 pb-6 pt-2">
      <Skeleton className="h-3 w-40" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-16 w-full rounded-md" />
      ))}
    </div>
  );
}
