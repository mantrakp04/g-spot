import { cloneElement, useCallback, useEffect, useRef, useState } from "react";
import type { HTMLAttributes, PointerEvent, ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarGroup,
  AvatarGroupCount,
} from "@g-spot/ui/components/avatar";
import { Badge } from "@g-spot/ui/components/badge";
import {
  Check,
  CircleCheck,
  CircleDot,
  CircleSlash,
  CircleX,
  Clock,
  ExternalLink,
  GitPullRequest,
  Mail,
  MessageSquare,
  Milestone as MilestoneIcon,
  Paperclip,
  SmilePlus,
  XCircle,
} from "lucide-react";

import type { GitHubIssue, GitHubPullRequest } from "@/lib/github/types";
import type { GmailThread } from "@/lib/gmail/types";
import { GmailSenderAvatar } from "./gmail-sender-avatar";
import { GitHubLabels, fullDate, relativeTime } from "./shared";

// ── Generic Row Preview Wrapper ───────────────────────────────────────────

export const ROW_PREVIEW_BLOCK_ATTR = "data-row-preview-block";

function targetBlocksRowPreview(target: EventTarget | null) {
  return target instanceof Element && target.closest(`[${ROW_PREVIEW_BLOCK_ATTR}]`) !== null;
}

export function RowPreviewPopover({
  children,
  preview,
}: {
  children: ReactElement<HTMLAttributes<HTMLElement>>;
  preview: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const previewBlockedRef = useRef(false);
  const anchorElementRef = useRef<HTMLElement | null>(null);
  const previewElementRef = useRef<HTMLDivElement | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const updatePosition = useCallback(() => {
    const anchorElement = anchorElementRef.current;
    if (!anchorElement) return;

    const anchorRect = anchorElement.getBoundingClientRect();
    const previewWidth = previewElementRef.current?.offsetWidth ?? 320;
    const previewHeight = previewElementRef.current?.offsetHeight ?? 240;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const left = Math.min(
      Math.max(anchorRect.left, 8),
      Math.max(8, viewportWidth - previewWidth - 8),
    );

    const preferredTop = anchorRect.bottom + 4;
    const fallbackTop = anchorRect.top - previewHeight - 4;
    const top =
      preferredTop + previewHeight <= viewportHeight - 8
        ? preferredTop
        : Math.max(8, fallbackTop);

    setPosition({ top, left });
  }, []);

  const closePreview = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    setOpen(false);
  }, [clearCloseTimer, clearOpenTimer]);

  const scheduleClose = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
    }, 80);
  }, [clearCloseTimer, clearOpenTimer]);

  const scheduleOpen = useCallback(
    (anchorElement: HTMLElement) => {
      if (previewBlockedRef.current) return;

      anchorElementRef.current = anchorElement;
      clearOpenTimer();
      clearCloseTimer();
      openTimerRef.current = window.setTimeout(() => {
        updatePosition();
        setOpen(true);
      }, 400);
    },
    [clearCloseTimer, clearOpenTimer, updatePosition],
  );

  const handleBlockState = useCallback((target: EventTarget | null) => {
    const blocked = targetBlocksRowPreview(target);
    previewBlockedRef.current = blocked;
    if (blocked) {
      closePreview();
    }
  }, [closePreview]);

  useEffect(() => {
    if (!open) return;

    const handleWindowChange = () => {
      updatePosition();
    };

    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
  }, [open, updatePosition]);

  useEffect(() => () => {
    clearOpenTimer();
    clearCloseTimer();
  }, [clearCloseTimer, clearOpenTimer]);

  const child = cloneElement(children, {
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      handleBlockState(event.target);
      if (!previewBlockedRef.current) {
        scheduleOpen(event.currentTarget);
      }
      children.props.onPointerEnter?.(event);
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      const nextTarget = event.relatedTarget;
      if (
        nextTarget instanceof Node &&
        previewElementRef.current?.contains(nextTarget)
      ) {
        clearCloseTimer();
      } else {
        scheduleClose();
      }
      children.props.onPointerLeave?.(event);
    },
    onPointerOverCapture: (event: PointerEvent<HTMLElement>) => {
      handleBlockState(event.target);
      children.props.onPointerOverCapture?.(event);
    },
    onPointerDownCapture: (event: PointerEvent<HTMLElement>) => {
      handleBlockState(event.target);
      children.props.onPointerDownCapture?.(event);
    },
    onPointerOutCapture: (event: PointerEvent<HTMLElement>) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
        handleBlockState(nextTarget);
      } else {
        previewBlockedRef.current = false;
      }
      children.props.onPointerOutCapture?.(event);
    },
  });

  return (
    <>
      {child}
      {open
        ? createPortal(
            <div
              ref={previewElementRef}
              className="fixed isolate z-50 w-80 bg-popover p-0 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden"
              style={{ top: position.top, left: position.left }}
              onPointerEnter={() => {
                clearCloseTimer();
                clearOpenTimer();
              }}
              onPointerLeave={(event) => {
                const nextTarget = event.relatedTarget;
                if (
                  nextTarget instanceof Node &&
                  anchorElementRef.current?.contains(nextTarget)
                ) {
                  clearCloseTimer();
                } else {
                  scheduleClose();
                }
              }}
              onClick={(event) => event.stopPropagation()}
            >
              {preview}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

// ── Preview Footer ────────────────────────────────────────────────────────

function PreviewFooter({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-center gap-1.5 border-t border-border/40 px-3 py-2 text-[10px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      onClick={(e) => e.stopPropagation()}
    >
      {label}
      <ExternalLink className="size-2.5" />
    </a>
  );
}

// ── GitHub Issue Preview ──────────────────────────────────────────────────

function issueStateMeta(issue: GitHubIssue) {
  if (issue.state === "OPEN") {
    return {
      icon: <CircleDot className="size-3.5 text-emerald-500" />,
      label: "Open",
      bg: "bg-emerald-500/10",
      color: "text-emerald-500",
    };
  }
  if (issue.stateReason === "NOT_PLANNED") {
    return {
      icon: <CircleSlash className="size-3.5 text-muted-foreground" />,
      label: "Not planned",
      bg: "bg-muted",
      color: "text-muted-foreground",
    };
  }
  return {
    icon: <CircleCheck className="size-3.5 text-purple-500" />,
    label: "Closed",
    bg: "bg-purple-500/10",
    color: "text-purple-500",
  };
}

export function GitHubIssuePreview({ issue }: { issue: GitHubIssue }) {
  const state = issueStateMeta(issue);

  return (
    <>
      {/* Header */}
      <div className={`flex items-center gap-2 px-3 py-2.5 ${state.bg}`}>
        {state.icon}
        <span className={`text-xs font-semibold ${state.color}`}>{state.label}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {issue.repository.nameWithOwner}#{issue.number}
        </span>
      </div>

      {/* Body */}
      <div className="space-y-2.5 px-3 py-2.5">
        <p className="text-sm font-medium leading-snug">{issue.title}</p>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Avatar size="sm">
            <AvatarImage src={issue.author.avatarUrl} alt={issue.author.login} />
            <AvatarFallback>{issue.author.login.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span>{issue.author.login}</span>
          <span>&middot;</span>
          <span>updated {relativeTime(issue.updatedAt)}</span>
        </div>

        {issue.labels.length > 0 && <GitHubLabels labels={issue.labels} />}

        {/* Metadata */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {issue.comments > 0 && (
            <span className="flex items-center gap-1">
              <MessageSquare className="size-3" />
              {issue.comments}
            </span>
          )}
          {issue.reactions > 0 && (
            <span className="flex items-center gap-1">
              <SmilePlus className="size-3" />
              {issue.reactions}
            </span>
          )}
          {issue.milestone && (
            <span className="flex items-center gap-1">
              <MilestoneIcon className="size-3" />
              <span className="max-w-[10rem] truncate">{issue.milestone}</span>
            </span>
          )}
        </div>

        {issue.assignees.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Assignees:</span>
            <AvatarGroup>
              {issue.assignees.slice(0, 5).map((a) => (
                <Avatar key={a.login} size="sm">
                  <AvatarImage src={a.avatarUrl} alt={a.login} />
                  <AvatarFallback>{a.login.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
              ))}
              {issue.assignees.length > 5 && (
                <AvatarGroupCount>+{issue.assignees.length - 5}</AvatarGroupCount>
              )}
            </AvatarGroup>
          </div>
        )}
      </div>

      <PreviewFooter href={issue.url} label="View issue on GitHub" />
    </>
  );
}

// ── GitHub PR Preview ─────────────────────────────────────────────────────

function prRollupMeta(status: GitHubPullRequest["statusCheckRollup"]) {
  switch (status) {
    case "SUCCESS":
      return { icon: <Check className="size-3 text-emerald-500" />, label: "Checks passed", color: "text-emerald-500" };
    case "FAILURE":
    case "ERROR":
      return { icon: <XCircle className="size-3 text-destructive" />, label: "Checks failed", color: "text-destructive" };
    case "PENDING":
      return { icon: <Clock className="size-3 text-yellow-500" />, label: "Checks running", color: "text-yellow-500" };
    default:
      return null;
  }
}

function prReviewMeta(decision: GitHubPullRequest["reviewDecision"]) {
  switch (decision) {
    case "APPROVED":
      return { icon: <Check className="size-3 text-emerald-500" />, label: "Approved", color: "text-emerald-500" };
    case "CHANGES_REQUESTED":
      return { icon: <CircleX className="size-3 text-destructive" />, label: "Changes requested", color: "text-destructive" };
    case "REVIEW_REQUIRED":
      return { icon: <GitPullRequest className="size-3 text-muted-foreground" />, label: "Review required", color: "text-muted-foreground" };
    default:
      return null;
  }
}

export function GitHubPRPreview({ pr }: { pr: GitHubPullRequest }) {
  const rollup = prRollupMeta(pr.statusCheckRollup);
  const review = prReviewMeta(pr.reviewDecision);

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-2 bg-muted/50 px-3 py-2.5">
        <GitPullRequest className={`size-3.5 ${pr.isDraft ? "text-muted-foreground" : "text-emerald-500"}`} />
        <span className={`text-xs font-semibold ${pr.isDraft ? "text-muted-foreground" : "text-emerald-500"}`}>
          {pr.isDraft ? "Draft" : "Open"}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {pr.repository.nameWithOwner}#{pr.number}
        </span>
      </div>

      {/* Body */}
      <div className="space-y-2.5 px-3 py-2.5">
        <p className="text-sm font-medium leading-snug">{pr.title}</p>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Avatar size="sm">
            <AvatarImage src={pr.author.avatarUrl} alt={pr.author.login} />
            <AvatarFallback>{pr.author.login.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span>{pr.author.login}</span>
          <span>&middot;</span>
          <span>updated {relativeTime(pr.updatedAt)}</span>
        </div>

        {pr.labels.length > 0 && <GitHubLabels labels={pr.labels} />}

        {/* Changes */}
        {pr.additions != null && pr.deletions != null && (
          <div className="font-mono text-xs">
            <span className="text-emerald-500">+{pr.additions}</span>{" "}
            <span className="text-destructive">-{pr.deletions}</span>
          </div>
        )}

        {/* Status rows */}
        {(rollup || review) && (
          <div className="space-y-1">
            {rollup && (
              <div className="flex items-center gap-1.5 text-xs">
                {rollup.icon}
                <span className={rollup.color}>{rollup.label}</span>
              </div>
            )}
            {review && (
              <div className="flex items-center gap-1.5 text-xs">
                {review.icon}
                <span className={review.color}>{review.label}</span>
              </div>
            )}
          </div>
        )}

        {/* Reviewers */}
        {pr.reviewers.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Reviewers:</span>
            <AvatarGroup>
              {pr.reviewers.slice(0, 5).map((r) => (
                <Avatar key={r.login} size="sm">
                  <AvatarImage src={r.avatarUrl} alt={r.login} />
                  <AvatarFallback>{r.login.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
              ))}
              {pr.reviewers.length > 5 && (
                <AvatarGroupCount>+{pr.reviewers.length - 5}</AvatarGroupCount>
              )}
            </AvatarGroup>
          </div>
        )}
      </div>

      <PreviewFooter href={pr.url} label="View PR on GitHub" />
    </>
  );
}

// ── Gmail Thread Preview ──────────────────────────────────────────────────

const SYSTEM_LABELS = new Set([
  "INBOX", "UNREAD", "STARRED", "IMPORTANT", "SENT", "DRAFT",
  "SPAM", "TRASH", "CATEGORY_PERSONAL", "CATEGORY_SOCIAL",
  "CATEGORY_PROMOTIONS", "CATEGORY_UPDATES", "CATEGORY_FORUMS",
]);

export function GmailThreadPreview({ thread }: { thread: GmailThread }) {
  const userLabels = thread.labels.filter((l) => !SYSTEM_LABELS.has(l));

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-2 bg-muted/50 px-3 py-2.5">
        <Mail className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{thread.subject}</span>
      </div>

      {/* Body */}
      <div className="space-y-2 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <GmailSenderAvatar
            size="sm"
            name={thread.from.name}
            email={thread.from.email}
            avatarUrl={thread.avatarUrl}
          />
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">{thread.from.name}</p>
            <p className="truncate text-[10px] text-muted-foreground">{thread.from.email}</p>
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground">{fullDate(thread.date)}</p>

        {thread.snippet && (
          <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
            {thread.snippet}
          </p>
        )}

        {/* Labels + attachment */}
        {(userLabels.length > 0 || thread.hasAttachment) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {thread.hasAttachment && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Paperclip className="size-3" />
                Attachment
              </span>
            )}
            {userLabels.map((label) => (
              <Badge key={label} variant="outline" className="px-1.5 py-0 text-[10px]">
                {label}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
