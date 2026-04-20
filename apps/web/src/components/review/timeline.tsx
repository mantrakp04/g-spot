import { CheckCircle2, MessageSquare, SmilePlus, XCircle } from "lucide-react";
import type { OAuthConnection } from "@stackframe/react";

import type {
  ReactionContent,
  ReactionScope,
  ReactionSummary,
  ReviewTarget,
  TimelineEvent,
} from "@/hooks/use-github-detail";
import {
  REACTION_CONTENTS,
  useReactionMutation,
} from "@/hooks/use-github-detail";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@g-spot/ui/components/dropdown-menu";
import { Skeleton } from "@g-spot/ui/components/skeleton";

import { Markdown } from "./markdown";

const REACTION_EMOJI: Record<ReactionContent, string> = {
  "+1": "👍",
  "-1": "👎",
  laugh: "😄",
  hooray: "🎉",
  confused: "😕",
  heart: "❤️",
  rocket: "🚀",
  eyes: "👀",
};

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

export function Timeline({
  events,
  target,
  account,
}: {
  events: TimelineEvent[];
  target?: ReviewTarget;
  account?: OAuthConnection | null;
}) {
  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/50 p-6 text-center text-[13px] text-muted-foreground/70">
        No activity yet.
      </div>
    );
  }
  return (
    <ol className="space-y-4">
      {events.map((e) => (
        <TimelineItem
          key={e.id}
          event={e}
          target={target}
          account={account}
        />
      ))}
    </ol>
  );
}

function TimelineItem({
  event,
  target,
  account,
}: {
  event: TimelineEvent;
  target?: ReviewTarget;
  account?: OAuthConnection | null;
}) {
  const isReview = event.kind === "review";
  const Icon =
    event.meta === "APPROVED"
      ? CheckCircle2
      : event.meta === "CHANGES_REQUESTED"
      ? XCircle
      : MessageSquare;
  return (
    <li className="flex gap-3">
      <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
        {event.author?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={event.author.avatarUrl}
            alt=""
            className="size-7 rounded-full object-cover"
          />
        ) : (
          <Icon className="size-3.5 text-muted-foreground/70" />
        )}
      </div>
      <div className="min-w-0 flex-1 rounded-lg border border-border/50 bg-card">
        <div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-2 text-[12px]">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">
              {event.author?.login ?? "ghost"}
            </span>
            {isReview && event.meta ? (
              <span className="text-muted-foreground/70">
                {event.meta.toLowerCase().replace("_", " ")}
              </span>
            ) : (
              <span className="text-muted-foreground/70">commented</span>
            )}
          </div>
          <span className="text-muted-foreground/70">
            {relativeTime(event.createdAt)}
          </span>
        </div>
        {event.body ? (
          <div className="px-4 py-3">
            <Markdown>{event.body}</Markdown>
          </div>
        ) : null}
        {event.reactionScope && target && account ? (
          <ReactionsRow
            scope={event.reactionScope}
            reactions={event.reactions ?? {}}
            target={target}
            account={account}
          />
        ) : null}
      </div>
    </li>
  );
}

function ReactionsRow({
  scope,
  reactions,
  target,
  account,
}: {
  scope: ReactionScope;
  reactions: ReactionSummary;
  target: ReviewTarget;
  account: OAuthConnection;
}) {
  const mutate = useReactionMutation(target, account);
  const active = new Set<ReactionContent>();
  const visible = REACTION_CONTENTS.filter((c) => (reactions[c] ?? 0) > 0);
  const toggle = (content: ReactionContent) => {
    mutate.mutate({ scope, content, existingReactionId: null });
  };
  return (
    <div className="flex items-center gap-1 border-t border-border/50 px-3 py-2">
      {visible.map((c) => {
        const count = reactions[c] ?? 0;
        const isActive = active.has(c);
        return (
          <button
            key={c}
            type="button"
            onClick={() => toggle(c)}
            className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] transition-colors ${
              isActive
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-muted"
            }`}
          >
            <span>{REACTION_EMOJI[c]}</span>
            <span>{count}</span>
          </button>
        );
      })}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="inline-flex size-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:bg-muted"
              aria-label="Add reaction"
            >
              <SmilePlus className="size-3" />
            </button>
          }
        />
        <DropdownMenuContent align="start" className="min-w-0 p-1">
          <div className="flex gap-0.5">
            {REACTION_CONTENTS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => toggle(c)}
                className="flex size-7 items-center justify-center rounded-sm text-[15px] hover:bg-muted"
                title={c}
              >
                {REACTION_EMOJI[c]}
              </button>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function TimelineSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-7 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-8 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}
