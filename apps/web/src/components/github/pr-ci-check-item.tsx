import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { CheckCircle2, Circle, CircleDashed, XCircle } from "lucide-react";

import { cn } from "@g-spot/ui/lib/utils";

export type PrCiCheckItemData = {
  id: string | number;
  name: string;
  status: string | null;
  conclusion: string | null;
  detailsUrl?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
};

function normalizeCheckValue(value: string | null | undefined) {
  return value?.toLowerCase() ?? null;
}

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

function checkElapsedMs(c: PrCiCheckItemData, now: number): number | null {
  if (!c.startedAt) return null;
  const start = new Date(c.startedAt).getTime();
  if (Number.isNaN(start)) return null;
  const end =
    normalizeCheckValue(c.status) === "completed" && c.completedAt
      ? new Date(c.completedAt).getTime()
      : now;
  return end - start;
}

function PrCiCheckDuration({ check }: { check: PrCiCheckItemData }) {
  const live = normalizeCheckValue(check.status) !== "completed";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [live]);
  const ms = checkElapsedMs(check, now);
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

export function isPassingPrCiCheck(check: PrCiCheckItemData) {
  const status = normalizeCheckValue(check.status);
  const conclusion = normalizeCheckValue(check.conclusion);
  return (
    status === "completed" &&
    (conclusion === "success" ||
      conclusion === "neutral" ||
      conclusion === "skipped")
  );
}

export function isFailedPrCiCheck(check: PrCiCheckItemData) {
  const status = normalizeCheckValue(check.status);
  const conclusion = normalizeCheckValue(check.conclusion);
  return (
    status === "completed" &&
    (conclusion === "failure" ||
      conclusion === "timed_out" ||
      conclusion === "cancelled")
  );
}

export function summarizePrCiChecks(checks: PrCiCheckItemData[]) {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const check of checks) {
    if (normalizeCheckValue(check.status) !== "completed") pending++;
    else if (isPassingPrCiCheck(check)) passed++;
    else failed++;
  }
  return { passed, failed, pending };
}

export function PrCiCheckIcon({
  status,
  conclusion,
}: {
  status: string | null;
  conclusion: string | null;
}) {
  const normalizedStatus = normalizeCheckValue(status);
  const normalizedConclusion = normalizeCheckValue(conclusion);

  if (normalizedStatus === "in_progress") {
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
  if (normalizedStatus !== "completed") {
    return <CircleDashed className="size-3.5 shrink-0 text-amber-500" />;
  }
  if (
    normalizedConclusion === "success" ||
    normalizedConclusion === "neutral" ||
    normalizedConclusion === "skipped"
  ) {
    return <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />;
  }
  if (
    normalizedConclusion === "failure" ||
    normalizedConclusion === "timed_out" ||
    normalizedConclusion === "cancelled"
  ) {
    return <XCircle className="size-3.5 shrink-0 text-destructive" />;
  }
  return <Circle className="size-3.5 shrink-0 text-muted-foreground/70" />;
}

export function PrCiCheckItem({
  check,
  fallbackHref,
  action,
  className,
  onLinkClick,
}: {
  check: PrCiCheckItemData;
  fallbackHref?: string;
  action?: ReactNode;
  className?: string;
  onLinkClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <div
      className={cn(
        "group/check flex items-center gap-2 rounded-md px-2 py-1 text-[12px] hover:bg-muted",
        className,
      )}
    >
      <PrCiCheckIcon status={check.status} conclusion={check.conclusion} />
      <a
        href={check.detailsUrl ?? fallbackHref ?? "#"}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 truncate hover:underline"
        onClick={onLinkClick}
      >
        {check.name}
      </a>
      {action}
      <PrCiCheckDuration check={check} />
    </div>
  );
}
