import { useState } from "react";
import { CheckCircle2, Circle, CircleDashed, XCircle } from "lucide-react";

import type { CheckItem } from "@/hooks/use-github-detail";

function isPassing(c: CheckItem) {
  return (
    c.status === "completed" &&
    (c.conclusion === "success" ||
      c.conclusion === "neutral" ||
      c.conclusion === "skipped")
  );
}

export function ChecksPanel({ checks }: { checks: CheckItem[] }) {
  const [showAll, setShowAll] = useState(false);

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
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="text-primary hover:underline"
          >
            View all
          </button>
        ) : showAll && rollup.passed > 0 ? (
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className="text-muted-foreground/70 hover:underline"
          >
            Hide passing
          </button>
        ) : null}
      </div>
      {visible.length > 0 ? (
        <ul className="space-y-0.5">
          {visible.map((c) => (
            <li key={c.name}>
              <a
                href={c.detailsUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-sm px-2 py-1 text-[12px] hover:bg-muted"
              >
                <CheckIcon status={c.status} conclusion={c.conclusion} />
                <span className="flex-1 truncate">{c.name}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-sm px-2 py-1 text-[12px] text-muted-foreground/70">
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
