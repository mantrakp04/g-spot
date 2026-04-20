import { useMemo } from "react";
import { ChevronDown, Check, GitCommit } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@g-spot/ui/components/dropdown-menu";

import type { useGitHubPRCommits } from "@/hooks/use-github-detail";

export type CommitRange = {
  baseSha: string;
  headSha: string;
} | null;

type PRCommits = NonNullable<
  ReturnType<typeof useGitHubPRCommits>["data"]
>;

export function CommitSelector({
  commits,
  baseSha,
  headSha,
  range,
  onChange,
}: {
  commits: PRCommits | undefined;
  baseSha: string;
  headSha: string;
  range: CommitRange;
  onChange: (range: CommitRange) => void;
}) {
  const effectiveBase = range?.baseSha ?? baseSha;
  const effectiveHead = range?.headSha ?? headSha;

  const label = useMemo(() => {
    if (!range) return `Base \u2194 ${commits?.length ?? 0} commits`;
    const n = countCommitsInRange(commits ?? [], range);
    return `${short(range.baseSha)} \u2194 ${short(range.headSha)} (${n})`;
  }, [commits, range]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-border/50 bg-card px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Commit range"
            title="Commit range"
          >
            <GitCommit className="size-3.5" />
            <span className="max-w-[220px] truncate font-mono">{label}</span>
            <ChevronDown className="size-3" />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-[320px] p-1">
        <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground/70">
          Compare commits
        </div>
        <DropdownMenuSeparator />
        <button
          type="button"
          onClick={() => onChange(null)}
          className={rowClass(range == null)}
        >
          <span className="flex-1 truncate">
            Full PR diff (base {"\u2192"} head)
          </span>
          {range == null ? <Check className="size-3.5" /> : null}
        </button>
        <DropdownMenuSeparator />
        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
          Base
        </div>
        <CommitList
          commits={commits}
          selected={effectiveBase}
          pinned={baseSha}
          onPick={(sha) =>
            onChange(
              sha === baseSha && effectiveHead === headSha
                ? null
                : { baseSha: sha, headSha: effectiveHead },
            )
          }
        />
        <DropdownMenuSeparator />
        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
          Head
        </div>
        <CommitList
          commits={commits}
          selected={effectiveHead}
          pinned={headSha}
          onPick={(sha) =>
            onChange(
              sha === headSha && effectiveBase === baseSha
                ? null
                : { baseSha: effectiveBase, headSha: sha },
            )
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function rowClass(active: boolean) {
  return `flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] ${
    active
      ? "bg-muted text-foreground"
      : "text-muted-foreground hover:bg-muted hover:text-foreground"
  }`;
}

function short(sha: string) {
  return sha.slice(0, 7);
}

function CommitList({
  commits,
  selected,
  pinned,
  onPick,
}: {
  commits: PRCommits | undefined;
  selected: string;
  pinned: string;
  onPick: (sha: string) => void;
}) {
  if (!commits || commits.length === 0) {
    return (
      <div className="px-2 py-1.5 text-[11px] text-muted-foreground/70">
        Loading commits{"\u2026"}
      </div>
    );
  }
  return (
    <div className="max-h-[200px] overflow-y-auto">
      {commits.map((c) => {
        const msg = (c.commit.message ?? "").split("\n")[0] ?? "";
        const active = selected === c.sha;
        return (
          <button
            key={c.sha}
            type="button"
            onClick={() => onPick(c.sha)}
            className={rowClass(active)}
          >
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
              {short(c.sha)}
            </span>
            <span className="flex-1 truncate">{msg}</span>
            {c.sha === pinned ? (
              <span className="shrink-0 rounded-sm bg-background px-1 text-[10px] text-muted-foreground/70">
                {selected === pinned ? "" : "default"}
              </span>
            ) : null}
            {active ? <Check className="size-3.5 shrink-0" /> : null}
          </button>
        );
      })}
    </div>
  );
}

function countCommitsInRange(commits: PRCommits, range: NonNullable<CommitRange>) {
  const baseIdx = commits.findIndex((c) => c.sha === range.baseSha);
  const headIdx = commits.findIndex((c) => c.sha === range.headSha);
  if (baseIdx < 0 || headIdx < 0) return 0;
  return Math.max(0, headIdx - baseIdx);
}
