import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { OAuthConnection } from "@stackframe/react";
import { AlertCircle, MessageSquare, CheckCircle2, XCircle } from "lucide-react";

import { Button } from "@g-spot/ui/components/button";
import { Kbd, KbdGroup } from "@g-spot/ui/components/kbd";
import { RadioGroup, RadioGroupItem } from "@g-spot/ui/components/radio-group";
import { Textarea } from "@g-spot/ui/components/textarea";
import { cn } from "@g-spot/ui/lib/utils";

import { getGitHubOctokit } from "@/lib/github/client";
import { getPendingCommentsKey } from "@/lib/review/pr-review-state";
import {
  githubDetailKeys,
  type ReviewTarget,
} from "@/hooks/use-github-detail";
import {
  useClearPendingComments,
  usePendingComments,
  type PendingComment,
} from "@/hooks/use-pending-comments";

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

const EVENT_OPTIONS: {
  value: ReviewEvent;
  label: string;
  icon: typeof MessageSquare;
  activeClass: string;
}[] = [
  {
    value: "COMMENT",
    label: "Comment",
    icon: MessageSquare,
    activeClass: "border-primary bg-primary/10 text-primary",
  },
  {
    value: "REQUEST_CHANGES",
    label: "Request changes",
    icon: XCircle,
    activeClass: "border-rose-500/50 bg-rose-500/10 text-rose-500",
  },
  {
    value: "APPROVE",
    label: "Approve",
    icon: CheckCircle2,
    activeClass: "border-emerald-500/50 bg-emerald-500/10 text-emerald-500",
  },
];

function toOctokitComment(c: PendingComment) {
  const base = {
    path: c.path,
    body: c.body,
    line: c.line,
    side: c.side,
  };
  if (c.startLine && c.startLine !== c.line) {
    return {
      ...base,
      start_line: c.startLine,
      start_side: c.side,
    };
  }
  return base;
}

export function ReviewForm({
  target,
  account,
  initialEvent,
  onSubmitted,
}: {
  target: ReviewTarget;
  account: OAuthConnection;
  initialEvent?: ReviewEvent;
  onSubmitted?: () => void;
}) {
  const pendingKey = getPendingCommentsKey(target);
  const pendingInlineComments = usePendingComments(pendingKey);
  const clearPendingInlineComments = useClearPendingComments(pendingKey);

  const [event, setEvent] = useState<ReviewEvent>(initialEvent ?? "COMMENT");
  useEffect(() => {
    if (initialEvent) setEvent(initialEvent);
  }, [initialEvent]);
  const [body, setBody] = useState("");
  const queryClient = useQueryClient();

  const submit = useMutation({
    mutationFn: async () => {
      const kit = await getGitHubOctokit(account);
      const { data } = await kit.rest.pulls.createReview({
        owner: target.owner,
        repo: target.repo,
        pull_number: target.number,
        event,
        body: body.trim() || undefined,
        comments: pendingInlineComments.map(toOctokitComment),
      });
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: githubDetailKeys.prReviewComments(
            target,
            account.providerAccountId,
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: githubDetailKeys.prTimeline(
            target,
            account.providerAccountId,
          ),
        }),
      ]);
      clearPendingInlineComments();
      setBody("");
      setEvent("COMMENT");
      onSubmitted?.();
    },
  });

  const canSubmit =
    !submit.isPending &&
    (pendingInlineComments.length > 0 || body.trim().length > 0);

  return (
    <div className="flex w-[420px] flex-col gap-3">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write your review (optional)"
        className="min-h-[120px] resize-none border-primary/50 bg-background text-[13px] focus-visible:ring-primary/30"
        autoFocus
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) {
            e.preventDefault();
            submit.mutate();
          }
        }}
      />

      <RadioGroup
        value={event}
        onValueChange={(v) => setEvent(v as ReviewEvent)}
        className="flex flex-col gap-1"
      >
        {EVENT_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const active = event === opt.value;
          return (
            <label
              key={opt.value}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-2 rounded-md border px-3 py-2 text-[13px] font-medium transition-colors",
                active
                  ? opt.activeClass
                  : "border-border/60 text-muted-foreground hover:bg-muted",
              )}
            >
              <span className="inline-flex items-center gap-2">
                <RadioGroupItem value={opt.value} className="size-3.5" />
                {opt.label}
              </span>
              <Icon className="size-3.5 opacity-70" />
            </label>
          );
        })}
      </RadioGroup>

      {submit.isError ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-[12px] text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0">
            {submit.error instanceof Error
              ? submit.error.message
              : "Failed to submit review."}
          </div>
        </div>
      ) : null}

      <Button
        type="button"
        size="lg"
        disabled={!canSubmit}
        onClick={() => submit.mutate()}
        className="w-full"
      >
        {submit.isPending ? "Submitting..." : "Submit review"}
        <KbdGroup className="opacity-70">
          <Kbd>⌘</Kbd>
          <Kbd>↵</Kbd>
        </KbdGroup>
      </Button>
    </div>
  );
}
