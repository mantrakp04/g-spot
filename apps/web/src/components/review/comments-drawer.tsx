import { useMemo, useState } from "react";
import { ArrowUpDown, MessageSquare } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@g-spot/ui/components/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@g-spot/ui/components/dropdown-menu";
import { cn } from "@g-spot/ui/lib/utils";

import type { ReviewComment } from "@/hooks/use-github-detail";
import { Markdown } from "./markdown";

type StatusFilter = "open" | "resolved" | "all";
type SortOrder = "newest" | "oldest" | "file";

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

export function CommentsDrawer({
  open,
  onOpenChange,
  commentsByFile,
  onJumpTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commentsByFile: Record<string, ReviewComment[]>;
  onJumpTo?: (path: string) => void;
}) {
  const [reviewer, setReviewer] = useState<string>("all");
  const [status, setStatus] = useState<StatusFilter>("open");
  const [sort, setSort] = useState<SortOrder>("newest");

  const allRoots = useMemo(() => {
    const out: Array<{ path: string; root: ReviewComment; replies: number }> =
      [];
    for (const [path, list] of Object.entries(commentsByFile)) {
      const byId = new Map(list.map((c) => [c.id, c] as const));
      for (const c of list) {
        const isRoot = c.inReplyToId == null || !byId.has(c.inReplyToId);
        if (!isRoot) continue;
        const replies = list.filter((r) => r.inReplyToId === c.id).length;
        out.push({ path, root: c, replies });
      }
    }
    return out;
  }, [commentsByFile]);

  const reviewers = useMemo(() => {
    const set = new Set<string>();
    for (const { root } of allRoots) {
      if (root.user?.login) set.add(root.user.login);
    }
    return Array.from(set).sort();
  }, [allRoots]);

  const filtered = useMemo(() => {
    let out = allRoots.slice();
    if (reviewer !== "all") {
      out = out.filter((x) => x.root.user?.login === reviewer);
    }
    if (status !== "all") {
      const want = status === "resolved";
      out = out.filter((x) => (x.root.isResolved ?? false) === want);
    }
    out.sort((a, b) => {
      if (sort === "file") return a.path.localeCompare(b.path);
      const ta = new Date(a.root.createdAt).getTime();
      const tb = new Date(b.root.createdAt).getTime();
      return sort === "newest" ? tb - ta : ta - tb;
    });
    return out;
  }, [allRoots, reviewer, status, sort]);

  const hiddenCount = allRoots.length - filtered.length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full max-w-[420px] flex-col gap-0 p-0"
      >
        <SheetHeader className="flex-row items-center justify-between border-b border-border/50 p-4">
          <SheetTitle className="text-[15px]">Comments</SheetTitle>
        </SheetHeader>

        <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2 text-[12px]">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1 rounded-sm border border-border/50 bg-card px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {reviewer === "all" ? "All reviewers" : reviewer}
                </button>
              }
            />
            <DropdownMenuContent align="start" className="min-w-[180px]">
              <DropdownMenuItem onClick={() => setReviewer("all")}>
                All reviewers
              </DropdownMenuItem>
              {reviewers.map((r) => (
                <DropdownMenuItem key={r} onClick={() => setReviewer(r)}>
                  {r}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1 rounded-sm border border-border/50 bg-card px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {status === "open"
                    ? "Open"
                    : status === "resolved"
                      ? "Resolved"
                      : "All"}
                </button>
              }
            />
            <DropdownMenuContent align="start" className="min-w-[140px]">
              <DropdownMenuItem onClick={() => setStatus("open")}>
                Open
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatus("resolved")}>
                Resolved
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatus("all")}>
                All
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="ml-auto inline-flex size-7 items-center justify-center rounded-sm border border-border/50 bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Sort comments"
                >
                  <ArrowUpDown className="size-3.5" />
                </button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-[160px]">
              <DropdownMenuItem onClick={() => setSort("newest")}>
                Newest first
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSort("oldest")}>
                Oldest first
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSort("file")}>
                By file
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {hiddenCount > 0 ? (
          <div className="flex items-center justify-between border-b border-border/50 px-4 py-1.5 text-[11px] text-muted-foreground/80">
            <span>
              {hiddenCount} {hiddenCount === 1 ? "thread" : "threads"} hidden
            </span>
            <button
              type="button"
              onClick={() => {
                setReviewer("all");
                setStatus("all");
              }}
              className="text-primary hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center text-[12px] text-muted-foreground/70">
              <MessageSquare className="size-6 opacity-50" />
              No comments match these filters.
            </div>
          ) : (
            <ul>
              {filtered.map(({ path, root, replies }) => (
                <li
                  key={root.id}
                  className="border-b border-border/40 last:border-b-0"
                >
                  <button
                    type="button"
                    onClick={() => onJumpTo?.(path)}
                    className="block w-full cursor-pointer px-4 py-3 text-left hover:bg-muted/50"
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground/80">
                      <span className="truncate font-mono">
                        {path}
                        {root.line != null ? (
                          <span className="ml-1 text-muted-foreground/60">
                            L{root.line}
                          </span>
                        ) : null}
                      </span>
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          root.isResolved
                            ? "bg-muted-foreground/40"
                            : "bg-primary",
                        )}
                      />
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-[12px]">
                      {root.user?.avatarUrl ? (
                        <img
                          src={root.user.avatarUrl}
                          alt=""
                          className="size-5 shrink-0 rounded-full object-cover"
                        />
                      ) : (
                        <div className="size-5 shrink-0 rounded-full bg-muted" />
                      )}
                      <span className="font-medium text-foreground">
                        {root.user?.login ?? "ghost"}
                      </span>
                      <span className="text-muted-foreground/70">
                        {relTime(root.createdAt)}
                      </span>
                    </div>
                    <div className="mt-1.5 line-clamp-4 text-[12px] text-foreground/90">
                      <Markdown>{root.body}</Markdown>
                    </div>
                    {replies > 0 ? (
                      <div className="mt-2 text-[11px] text-muted-foreground/70">
                        {replies} {replies === 1 ? "reply" : "replies"}
                      </div>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
