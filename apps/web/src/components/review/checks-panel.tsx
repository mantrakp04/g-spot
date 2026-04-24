import { useEffect, useState } from "react";
import { CheckCircle2, Circle, CircleDashed, RotateCw, XCircle } from "lucide-react";
import type { OAuthConnection } from "@stackframe/react";
import { toast } from "sonner";

import { Button } from "@g-spot/ui/components/button";

import type { CheckItem, ReviewTarget } from "@/hooks/use-github-detail";
import { useRerunCheckMutation } from "@/hooks/use-github-detail";

function formatDuration(ms: number) {
  if (ms < 0 || !Number.isFinite(ms)) return null;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

function checkElapsedMs(c: CheckItem, now: number): number | null {
  if (!c.startedAt) return null;
  const start = new Date(c.startedAt).getTime();
  if (Number.isNaN(start)) return null;
  const end =
    c.status === "completed" && c.completedAt
      ? new Date(c.completedAt).getTime()
      : now;
  return end - start;
}

function CheckDuration({ c }: { c: CheckItem }) {
  const live = c.status !== "completed";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [live]);
  const ms = checkElapsedMs(c, now);
  if (ms == null) return null;
  const text = formatDuration(ms);
  if (!text) return null;
  return (
    <span
      className="shrink-0 font-mono text-[11px] text-muted-foreground/70"
      title={live ? "Running" : "Duration"}
    >
      {text}
    </span>
  );
}

function isPassing(c: CheckItem) {
  return (
    c.status === "completed" &&
    (c.conclusion === "success" ||
      c.conclusion === "neutral" ||
      c.conclusion === "skipped")
  );
}

function isFailed(c: CheckItem) {
  return (
    c.status === "completed" &&
    (c.conclusion === "failure" ||
      c.conclusion === "timed_out" ||
      c.conclusion === "cancelled")
  );
}

export function ChecksPanel({
  checks,
  target,
  account,
  headSha,
}: {
  checks: CheckItem[];
  target?: ReviewTarget;
  account?: OAuthConnection | null;
  headSha?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const rerun = useRerunCheckMutation(
    target ?? { kind: "pr", owner: "", repo: "", number: 0 },
    account ?? null,
    headSha,
  );
  const canRerun = !!target && !!account;

  if (checks.length === 0) {
    return (
      <div className="text-[12px] italic text-muted-foreground/70">
        No checks yet.
      </div>
    );
  }

  const rollup = summarize(checks);
  const visible = showAll ? checks : checks.filter((c) => !isPassing(c));
  const hiddenCount = checks.length - visible.length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-muted-foreground/70">
          {rollup.passed} passed · {rollup.failed} failed · {rollup.pending} pending
        </span>
        {hiddenCount > 0 ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => setShowAll(true)}
            className="h-auto p-0"
          >
            View all
          </Button>
        ) : showAll && rollup.passed > 0 ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => setShowAll(false)}
            className="h-auto p-0 text-muted-foreground/70"
          >
            Hide passing
          </Button>
        ) : null}
      </div>
      {visible.length > 0 ? (
        <ul className="space-y-0.5">
          {visible.map((c) => (
            <li key={c.name}>
              <div className="group/check flex items-center gap-2 rounded-md px-2 py-1 text-[12px] hover:bg-muted">
                <CheckIcon status={c.status} conclusion={c.conclusion} />
                <a
                  href={c.detailsUrl ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  {c.name}
                </a>
                {canRerun && isFailed(c) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Retry ${c.name}`}
                    title="Retry"
                    onClick={(e) => {
                      e.preventDefault();
                      rerun.mutate(
                        { check: c },
                        {
                          onSuccess: () =>
                            toast.success(`Retrying ${c.name}`),
                          onError: (err) =>
                            toast.error(
                              err instanceof Error
                                ? err.message
                                : "Failed to retry check",
                            ),
                        },
                      );
                    }}
                    className="opacity-0 transition-opacity group-hover/check:opacity-100 focus-visible:opacity-100"
                  >
                    <RotateCw />
                  </Button>
                ) : null}
                <CheckDuration c={c} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-md px-2 py-1 text-[12px] text-muted-foreground/70">
          All checks passing.
        </div>
      )}
    </div>
  );
}

function summarize(checks: CheckItem[]) {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const c of checks) {
    if (c.status !== "completed") pending++;
    else if (isPassing(c)) passed++;
    else failed++;
  }
  return { passed, failed, pending };
}

function CheckIcon({
  status,
  conclusion,
}: {
  status: string;
  conclusion: string | null;
}) {
  if (status === "in_progress") {
    return (
      <span className="relative inline-flex size-3.5 shrink-0 items-center justify-center">
        <svg
          viewBox="0 0 16 16"
          fill="none"
          className="absolute inset-0 size-3.5 animate-spin text-amber-500"
        >
          <circle
            cx="8"
            cy="8"
            r="6.25"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="28 10"
            strokeLinecap="round"
          />
        </svg>
        <span className="size-1.5 rounded-full bg-amber-500" />
      </span>
    );
  }
  if (status !== "completed") {
    return <CircleDashed className="size-3.5 text-amber-500" />;
  }
  if (conclusion === "success" || conclusion === "neutral" || conclusion === "skipped") {
    return <CheckCircle2 className="size-3.5 text-emerald-500" />;
  }
  if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "cancelled") {
    return <XCircle className="size-3.5 text-destructive" />;
  }
  return <Circle className="size-3.5 text-muted-foreground/70" />;
}
