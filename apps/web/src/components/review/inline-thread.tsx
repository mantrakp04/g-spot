import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Undo2 } from "lucide-react";
import type { OAuthConnection } from "@stackframe/react";

import { Button } from "@g-spot/ui/components/button";
import { Textarea } from "@g-spot/ui/components/textarea";

import {
  useReplyReviewComment,
  useResolveReviewThread,
  type ReviewComment,
  type ReviewTarget,
} from "@/hooks/use-github-detail";

import { Markdown, SuggestionContext, type SuggestionAnchor } from "./markdown";
import { Wrappable } from "./wrappable";

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function CommentCard({
  comment,
  anchor,
}: {
  comment: ReviewComment;
  anchor: SuggestionAnchor | null;
}) {
  return (
    <div
      className="rounded-md border"
      style={{
        background: "var(--diffs-bg, var(--card))",
        borderColor: "var(--diffs-bg-separator, var(--border))",
      }}
    >
      <div
        className="flex items-center justify-between gap-2 border-b px-3 py-1.5 text-[12px]"
        style={{
          borderColor: "var(--diffs-bg-separator, var(--border))",
        }}
      >
        <div className="flex items-center gap-2">
          {comment.user?.avatarUrl ? (
            <img
              src={comment.user.avatarUrl}
              alt=""
              className="size-5 rounded-full object-cover"
            />
          ) : (
            <div
              className="size-5 rounded-full"
              style={{ background: "var(--diffs-bg-buffer, var(--muted))" }}
            />
          )}
          <span className="font-medium text-foreground">
            {comment.user?.login ?? "ghost"}
          </span>
          <span className="text-muted-foreground/70">commented</span>
        </div>
        <span className="text-muted-foreground/70">
          {relativeTime(comment.createdAt)}
        </span>
      </div>
      {comment.body ? (
        <Wrappable className="px-3 py-2">
          <SuggestionContext.Provider value={anchor}>
            <Markdown>{comment.body}</Markdown>
          </SuggestionContext.Provider>
        </Wrappable>
      ) : null}
    </div>
  );
}

export function InlineThread({
  root,
  replies,
  target,
  account,
  prHeadRef,
  baseRepoFull,
}: {
  root: ReviewComment;
  replies: ReviewComment[];
  target?: ReviewTarget;
  account?: OAuthConnection | null;
  prHeadRef?: string;
  baseRepoFull?: string;
}) {
  const anchor = useMemo<SuggestionAnchor | null>(() => {
    if (!account || !prHeadRef || !baseRepoFull || root.line == null) {
      return null;
    }
    return {
      path: root.path,
      side: root.side,
      line: root.line,
      startLine: null,
      prHeadRef,
      baseRepoFull,
      account,
    };
  }, [account, prHeadRef, baseRepoFull, root.path, root.side, root.line]);
  const [expanded, setExpanded] = useState(true);
  // Resolved threads default to collapsed — they're noise once handled.
  const [threadCollapsed, setThreadCollapsed] = useState(root.isResolved);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");

  const totalCount = 1 + replies.length;
  const snippet = useMemo(() => {
    const text = (root.body ?? "").replace(/\s+/g, " ").trim();
    return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  }, [root.body]);

  const canMutate = !!target && !!account;
  const reply = useReplyReviewComment(
    target ?? { kind: "pr", owner: "", repo: "", number: 0 },
    account ?? null,
  );
  const resolveThread = useResolveReviewThread(
    target ?? { kind: "pr", owner: "", repo: "", number: 0 },
    account ?? null,
  );

  const handleReply = () => {
    if (!replyBody.trim() || !canMutate) return;
    reply.mutate(
      { commentId: root.id, body: replyBody.trim() },
      {
        onSuccess: () => {
          setReplyBody("");
          setReplyOpen(false);
        },
      },
    );
  };

  const handleResolve = () => {
    if (!root.threadId || !canMutate) return;
    resolveThread.mutate({
      threadId: root.threadId,
      resolve: !root.isResolved,
    });
  };

  return (
    <div
      className="space-y-2 border-y px-3 py-3"
      style={{
        background: "var(--diffs-bg-buffer, var(--muted))",
        color: "var(--diffs-fg, var(--foreground))",
        borderColor: "var(--diffs-bg-separator, var(--border))",
        fontFamily: "var(--diffs-font-family, inherit)",
      }}
    >
      {threadCollapsed ? (
        <button
          type="button"
          onClick={() => setThreadCollapsed(false)}
          className="flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-card/60"
          style={{
            background: "var(--diffs-bg, var(--card))",
            borderColor: "var(--diffs-bg-separator, var(--border))",
          }}
        >
          <ChevronRight className="size-3 shrink-0 text-muted-foreground/70" />
          {root.isResolved ? (
            <Check className="size-3 shrink-0 text-primary" />
          ) : null}
          {root.user?.avatarUrl ? (
            <img
              src={root.user.avatarUrl}
              alt=""
              className="size-4 shrink-0 rounded-full object-cover"
            />
          ) : null}
          <span className="shrink-0 font-medium text-foreground">
            {root.user?.login ?? "ghost"}
          </span>
          {snippet ? (
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {snippet}
            </span>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
          <span className="shrink-0 text-[11px] text-muted-foreground/70">
            {totalCount} {totalCount === 1 ? "comment" : "comments"}
          </span>
        </button>
      ) : (
        <>
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setThreadCollapsed(true)}
          className="text-muted-foreground/70"
          title="Collapse thread"
        >
          <ChevronDown />
          {totalCount} {totalCount === 1 ? "comment" : "comments"}
        </Button>
        {root.isResolved ? (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
            <Check className="size-3 text-primary" />
            Resolved
          </div>
        ) : null}
      </div>
      <CommentCard comment={root} anchor={anchor} />
      {replies.length > 0 ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setExpanded((s) => !s)}
            className="text-muted-foreground/70"
          >
            {expanded ? <ChevronDown /> : <ChevronRight />}
            {replies.length} {replies.length === 1 ? "reply" : "replies"}
          </Button>
          {expanded ? (
            <div className="space-y-2 pl-4">
              {replies.map((r) => (
                <CommentCard key={r.id} comment={r} anchor={anchor} />
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {canMutate ? (
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setReplyOpen((s) => !s)}
            className="text-muted-foreground/80"
          >
            {replyOpen ? "Close reply" : "Reply"}
          </Button>
          {root.threadId ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={handleResolve}
              disabled={resolveThread.isPending}
            >
              {root.isResolved ? (
                <>
                  <Undo2 />
                  Unresolve
                </>
              ) : (
                <>
                  <Check />
                  Resolve
                </>
              )}
            </Button>
          ) : null}
        </div>
      ) : null}

      {replyOpen && canMutate ? (
        <div className="space-y-2">
          <Textarea
            autoFocus
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Write a reply..."
            className="min-h-[70px] bg-card text-[12px]"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                handleReply();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setReplyOpen(false);
              }
            }}
          />
          <div className="flex justify-end gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="default"
              onClick={() => setReplyOpen(false)}
              disabled={reply.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="default"
              onClick={handleReply}
              disabled={!replyBody.trim() || reply.isPending}
            >
              {reply.isPending ? "Replying..." : "Reply"}
            </Button>
          </div>
        </div>
      ) : null}
        </>
      )}
    </div>
  );
}
