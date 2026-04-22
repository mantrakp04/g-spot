import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OAuthConnection } from "@stackframe/react";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@g-spot/ui/components/hover-card";
import { AlertTriangle, ArrowDown, ArrowUp, FileText, MessageSquare, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@g-spot/ui/lib/utils";

import type { ReviewTarget } from "@/hooks/use-github-detail";
import {
  useGitHubPRChecks,
  useGitHubPRCommits,
  useGitHubPRDetail,
  useGitHubPRFiles,
  useGitHubPRReviewComments,
  useGitHubPRStack,
  useGitHubPRTimeline,
} from "@/hooks/use-github-detail";
import { CommitSelector, type CommitRange } from "./commit-selector";
import { DiffSettingsMenu } from "./diff-settings";

import { usePendingComments } from "@/hooks/use-pending-comments";
import { useLocalStorageState } from "@/lib/use-local-storage-state";

// Sticky top strip (48px) + files toolbar (48px). Crossing this means the
// Files section is pinned; switch the floating pill from "skip to code" to
// "back to top".
const STICKY_HEADER_OFFSET_PX = 96;

import { PRActionBar } from "./action-bar";
import { CommentsDrawer } from "./comments-drawer";
import { DescriptionCard, SectionHeading } from "./overview-region";
import {
  DiffModeToggle,
  DiffSkeleton,
  FileDiffCard,
  FileTreePanel,
  type DiffMode,
  type PRFile,
} from "./diff-viewer";
import { PRCondensedHeader, PRFullHeader } from "./pr-header";
import { PRSidebar } from "./pr-sidebar";
import { ReviewShell } from "./shell";
import { Timeline, TimelineSkeleton } from "./timeline";

const FILE_EXPAND_LIMIT = 50;

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
                  onClick={() => onSelect(f.filename)}
                  data-active={active}
                  data-attention={attention}
                  title={f.filename}
                  className={cn(
                    "h-[3px] w-[5px] shrink-0 rounded-[1px] transition-colors",
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
  children: React.ReactNode;
}) {
  return (
    <div
      aria-hidden={!visible}
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
  account: OAuthConnection;
}) {
  const detail = useGitHubPRDetail(target, account);
  const [commitRange, setCommitRange] = useState<CommitRange>(null);
  const files = useGitHubPRFiles(target, account, commitRange);
  const commits = useGitHubPRCommits(target, account);
  const timeline = useGitHubPRTimeline(target, account);
  const checks = useGitHubPRChecks(target, account, detail.data?.head.sha);
  const stack = useGitHubPRStack(target, account, detail.data);
  const reviewComments = useGitHubPRReviewComments(target, account);

  const pending = usePendingComments({
    owner: target.owner,
    repo: target.repo,
    prNumber: target.number,
  });

  const [diffMode, setDiffMode] = useLocalStorageState<DiffMode>(
    "gspot:review:diff-mode",
    "split",
    (raw) => (raw === "unified" ? "unified" : "split"),
  );
  const [treeOpen, setTreeOpen] = useLocalStorageState<boolean>(
    "gspot:review:tree-open",
    true,
    (raw) => raw !== "false",
  );
  const [commentsOpen, setCommentsOpen] = useState(false);

  const isLoading = detail.isLoading || files.isLoading || timeline.isLoading;
  const pr = detail.data;

  // GitHub occasionally returns duplicate entries for the same filename
  // (renames, symlinks like CLAUDE.md → AGENTS.md). Keep the last one so the
  // file appears once with final stats.
  const fileList = useMemo(() => {
    const raw = (files.data ?? []) as unknown as PRFile[];
    const byName = new Map<string, PRFile>();
    for (const f of raw) byName.set(f.filename, f);
    return Array.from(byName.values());
  }, [files.data]);
  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const filesSectionRef = useRef<HTMLDivElement | null>(null);
  const [floatingState, setFloatingState] = useState<"skip" | "top">("skip");

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
    filesSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  const scrollToFile = useCallback((filename: string) => {
    const el = fileRefs.current.get(filename);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveFile(filename);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement) {
        const tag = e.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
      }
      if (e.key !== "j" && e.key !== "k") return;
      if (fileList.length === 0) return;
      const idx = fileList.findIndex((f) => f.filename === activeFile);
      const nextIdx =
        e.key === "j"
          ? Math.min(fileList.length - 1, idx + 1)
          : Math.max(0, idx - 1);
      const next = fileList[nextIdx];
      if (next) {
        e.preventDefault();
        scrollToFile(next.filename);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fileList, activeFile, scrollToFile]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const first = visible[0]?.target as HTMLElement | undefined;
        if (first?.dataset.filename) setActiveFile(first.dataset.filename);
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 },
    );
    for (const el of fileRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [fileList]);

  const repoLabel = `${target.owner}/${target.repo}`;

  const commentCount = useMemo(() => {
    let n = 0;
    for (const list of Object.values(reviewComments.data ?? {})) n += list.length;
    return n;
  }, [reviewComments.data]);

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
      stack={stack.data ?? []}
    />
  ) : (
    <HeaderSkeleton />
  );

  const condensedHeader = pr ? (
    <PRCondensedHeader number={pr.number} title={pr.title} />
  ) : (
    <div className="h-10" />
  );

  const sidebar = pr ? (
    <PRSidebar
      state={pr.state as "open" | "closed"}
      isDraft={pr.draft ?? false}
      merged={pr.merged ?? false}
      mergeable={pr.mergeable ?? null}
      checks={checks.data ?? []}
      checksLoading={checks.isLoading}
      author={
        pr.user
          ? { login: pr.user.login, avatarUrl: pr.user.avatar_url }
          : null
      }
      reviewers={(pr.requested_reviewers ?? [])
        .filter((r): r is NonNullable<typeof r> => r != null)
        .map((r) => ({
          login: r.login,
          avatarUrl: r.avatar_url,
        }))}
      labels={(pr.labels ?? []).map((l) => ({
        name: l.name,
        color: l.color,
      }))}
      assignees={(pr.assignees ?? []).map((a) => ({
        login: a.login,
        avatarUrl: a.avatar_url,
      }))}
      milestone={pr.milestone?.title ?? null}
    />
  ) : (
    <SidebarSkeleton />
  );

  const main = (
    <div className="space-y-8">
      <section>
        <SectionHeading>Description</SectionHeading>
        {detail.isLoading || !pr ? (
          <Skeleton className="h-32 w-full rounded-lg" />
        ) : (
          <DescriptionCard markdown={pr.body} />
        )}
      </section>

      <section>
        <SectionHeading>Activity</SectionHeading>
        {timeline.isLoading ? (
          <TimelineSkeleton />
        ) : (
          <Timeline
            events={timeline.data ?? []}
            target={target}
            account={account}
          />
        )}
      </section>

      <section ref={filesSectionRef}>
        <div className="sticky top-0 z-10 -mx-4 flex items-center justify-between border-b border-border/50 bg-background px-4 py-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTreeOpen((s) => !s)}
              className="flex size-6 items-center justify-center rounded-sm text-muted-foreground/70 hover:bg-muted hover:text-foreground"
              aria-label={treeOpen ? "Hide file tree" : "Show file tree"}
              title={treeOpen ? "Hide file tree" : "Show file tree"}
            >
              {treeOpen ? (
                <PanelLeftClose className="size-4" />
              ) : (
                <PanelLeftOpen className="size-4" />
              )}
            </button>
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
                commits={commits.data}
                baseSha={pr.base.sha}
                headSha={pr.head.sha}
                range={commitRange}
                onChange={setCommitRange}
              />
            ) : null}
            <DiffModeToggle mode={diffMode} onChange={setDiffMode} />
            <DiffSettingsMenu />
            <button
              type="button"
              onClick={() => setCommentsOpen(true)}
              className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-border/50 bg-card px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              title="View comments"
            >
              <MessageSquare className="size-3.5" />
              {commentCount}
            </button>
            <span className="text-[11px] text-muted-foreground/70">
              Press{" "}
              <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">
                j
              </kbd>{" "}
              /{" "}
              <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">
                k
              </kbd>
            </span>
          </div>
        </div>

        {files.isLoading ? (
          <DiffSkeleton />
        ) : fileList.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/50 p-4 text-[13px] text-muted-foreground/70">
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
              <div className="self-start sticky top-[44px] max-h-[calc(100vh-92px)] overflow-y-auto">
                <FileTreePanel
                  files={fileList}
                  activeFile={activeFile}
                  onSelect={scrollToFile}
                />
              </div>
            ) : (
              <FileRailHandle
                files={fileList}
                activeFile={activeFile}
                commentsByFile={reviewComments.data ?? {}}
                onSelect={scrollToFile}
              />
            )}
            <div className="min-w-0 space-y-3 p-3">
              {fileList.length > FILE_EXPAND_LIMIT ? (
                <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-muted-foreground">
                  <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
                  This PR has {fileList.length} files. To improve performance,
                  only the first {FILE_EXPAND_LIMIT} files are expanded.
                </div>
              ) : null}
              {fileList.map((f, i) => (
                <div
                  key={f.filename}
                  data-filename={f.filename}
                  ref={(el) => {
                    if (el) fileRefs.current.set(f.filename, el);
                    else fileRefs.current.delete(f.filename);
                  }}
                >
                  <FileDiffCard
                    file={f}
                    isActive={activeFile === f.filename}
                    mode={diffMode}
                    comments={reviewComments.data?.[f.filename] ?? []}
                    defaultExpanded={i < FILE_EXPAND_LIMIT}
                    target={target}
                    account={account}
                    headSha={pr?.head.sha ?? ""}
                    headRef={pr?.head.ref}
                    pendingKey={{
                      owner: target.owner,
                      repo: target.repo,
                      prNumber: target.number,
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <CommentsDrawer
        open={commentsOpen}
        onOpenChange={setCommentsOpen}
        commentsByFile={reviewComments.data ?? {}}
        onJumpTo={(path) => {
          setCommentsOpen(false);
          scrollToFile(path);
        }}
      />

      <div className="fixed bottom-6 left-1/2 z-20 -translate-x-1/2">
        <FloatingPill visible={floatingState === "skip"}>
          <button
            type="button"
            onClick={scrollToFiles}
            className="inline-flex h-9 items-center gap-2 rounded-full border border-border/60 bg-card/95 px-4 text-[12px] font-medium text-foreground shadow-lg backdrop-blur hover:bg-muted"
          >
            Skip to code
            <ArrowDown className="size-3.5" />
          </button>
        </FloatingPill>
        <FloatingPill visible={floatingState === "top"} absolute>
          <button
            type="button"
            onClick={scrollToTop}
            aria-label="Back to top"
            className="inline-flex size-9 items-center justify-center rounded-full border border-border/60 bg-card/95 text-foreground shadow-lg backdrop-blur hover:bg-muted"
          >
            <ArrowUp className="size-4" />
          </button>
        </FloatingPill>
      </div>
    </div>
  );

  return (
    <ReviewShell
      isLoading={isLoading}
      fullHeader={fullHeader}
      condensedHeader={condensedHeader}
      main={main}
      rightSidebar={sidebar}
      actions={
        pr ? (
          <PRActionBar
            pr={pr}
            account={account}
            target={target}
            pendingReviewCount={pending.length}
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
        <Skeleton key={i} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  );
}
