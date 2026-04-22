import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, GitMerge } from "lucide-react";

import { Button } from "@g-spot/ui/components/button";

import type { CheckItem } from "@/hooks/use-github-detail";

import { ChecksPanel } from "./checks-panel";
import {
  SidebarAddButton,
  SidebarEmpty,
  SidebarSection,
} from "./sidebar-section";
import { PRStateBadge } from "./state-badge";

type Actor = { login: string; avatarUrl: string };

/** Right sidebar for PR view. Mirrors Graphite's grouped metadata. */
export function PRSidebar({
  state,
  isDraft,
  merged,
  mergeable,
  checks,
  checksLoading,
  author,
  reviewers,
  labels,
  assignees,
  milestone,
}: {
  state: "open" | "closed";
  isDraft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  checks: CheckItem[];
  checksLoading: boolean;
  author: Actor | null;
  reviewers: Actor[];
  labels: Array<{ name: string; color: string }>;
  assignees: Actor[];
  milestone: string | null;
}) {
  const requiredFailed = checks.some(
    (c) =>
      c.status === "completed" &&
      (c.conclusion === "failure" ||
        c.conclusion === "timed_out" ||
        c.conclusion === "cancelled"),
  );

  return (
    <div className="space-y-0">
      <StateCard
        state={state}
        isDraft={isDraft}
        merged={merged}
        mergeable={mergeable}
      />
      {requiredFailed ? <RequiredChecksCallout /> : null}

      <SidebarSection label="Checks">
        {checksLoading ? (
          <div className="space-y-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-5 animate-pulse rounded bg-muted"
              />
            ))}
          </div>
        ) : (
          <ChecksPanel checks={checks} />
        )}
      </SidebarSection>

      <SidebarSection label="Reviewers" action={<SidebarAddButton />}>
        {reviewers.length > 0 ? (
          <ul className="space-y-1">
            {reviewers.map((r) => (
              <UserRow key={r.login} user={r} />
            ))}
          </ul>
        ) : (
          <SidebarEmpty>No reviewers</SidebarEmpty>
        )}
      </SidebarSection>

      <SidebarSection label="Assignees" action={<SidebarAddButton />}>
        {assignees.length > 0 ? (
          <ul className="space-y-1">
            {assignees.map((a) => (
              <UserRow key={a.login} user={a} />
            ))}
          </ul>
        ) : author ? (
          <ul className="space-y-1">
            <UserRow user={author} />
          </ul>
        ) : (
          <SidebarEmpty>No one assigned</SidebarEmpty>
        )}
      </SidebarSection>

      <SidebarSection label="Labels" action={<SidebarAddButton />}>
        {labels.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {labels.map((l) => (
              <span
                key={l.name}
                className="rounded-md px-2 py-0.5 text-[11px]"
                style={{
                  background: `#${l.color}22`,
                  color: `#${l.color}`,
                }}
              >
                {l.name}
              </span>
            ))}
          </div>
        ) : (
          <SidebarEmpty>No labels</SidebarEmpty>
        )}
      </SidebarSection>

      {milestone ? (
        <SidebarSection label="Milestone">
          <div className="text-[12px]">{milestone}</div>
        </SidebarSection>
      ) : null}
    </div>
  );
}

function StateCard({
  state,
  isDraft,
  merged,
  mergeable,
}: {
  state: "open" | "closed";
  isDraft: boolean;
  merged: boolean;
  mergeable: boolean | null;
}) {
  return (
    <div className="mb-3 rounded-md border border-border/50 bg-card p-3">
      <div className="flex items-center justify-between">
        <PRStateBadge state={state} isDraft={isDraft} merged={merged} />
        {state === "open" && !merged ? (
          <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground/70">
            <GitMerge className="size-3.5" />
            {mergeable === false ? "Conflicts" : "Merge when ready"}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function RequiredChecksCallout() {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 p-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((s) => !s)}
        aria-expanded={open}
        className="h-auto w-full justify-start p-0 text-[13px] font-medium text-destructive hover:bg-transparent hover:text-destructive"
      >
        {open ? (
          <ChevronDown className="text-destructive/70" />
        ) : (
          <ChevronRight className="text-destructive/70" />
        )}
        <AlertTriangle />
        Required checks failed
      </Button>
      {open ? (
        <div className="mt-1 pl-[calc(0.875rem+0.5rem)] text-[12px] text-muted-foreground">
          1 or more required checks failed
        </div>
      ) : null}
    </div>
  );
}

function UserRow({ user }: { user: Actor }) {
  return (
    <li className="flex items-center gap-2 text-[12px]">
      {user.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.avatarUrl} alt="" className="size-5 rounded-full" />
      ) : (
        <span className="size-5 rounded-full bg-border" />
      )}
      <span className="truncate">{user.login}</span>
    </li>
  );
}
