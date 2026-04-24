import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, GitMerge, Plus } from "lucide-react";
import type { OAuthConnection } from "@stackframe/react";

import { Button } from "@g-spot/ui/components/button";

import type { ReviewTarget } from "@/hooks/use-github-detail";
import { useGitHubPRDetail } from "@/hooks/use-github-detail";

import {
  AssigneePicker,
  CloseReopenButton,
  DraftToggleButton,
  LabelEditor,
  MilestonePicker,
  ReviewersPicker,
} from "./action-bar";
import { ChecksPanel } from "./checks-panel";
import {
  SidebarEmpty,
  SidebarSection,
} from "./sidebar-section";
import { PRStateBadge } from "./state-badge";

type PR = NonNullable<ReturnType<typeof useGitHubPRDetail>["data"]>;
type Actor = { login: string; avatarUrl: string };
type ChecksLike = Parameters<typeof ChecksPanel>[0]["checks"];

/** Right sidebar for PR view. Mirrors Graphite's grouped metadata. */
export function PRSidebar({
  pr,
  target,
  account,
  checks,
  checksLoading,
}: {
  pr: PR;
  target: ReviewTarget;
  account: OAuthConnection | null;
  checks: ChecksLike;
  checksLoading: boolean;
}) {
  const state = pr.state as "open" | "closed";
  const isDraft = pr.draft ?? false;
  const merged = pr.merged ?? false;
  const mergeable = pr.mergeable ?? null;
  const author: Actor | null = pr.user
    ? { login: pr.user.login, avatarUrl: pr.user.avatar_url }
    : null;
  const reviewers: Actor[] = (pr.requested_reviewers ?? [])
    .filter((r): r is NonNullable<typeof r> => r != null)
    .map((r) => ({ login: r.login, avatarUrl: r.avatar_url }));
  const labels = (pr.labels ?? []).map((l) => ({
    name: l.name,
    color: l.color,
  }));
  const assignees: Actor[] = (pr.assignees ?? []).map((a) => ({
    login: a.login,
    avatarUrl: a.avatar_url,
  }));
  const milestone = pr.milestone?.title ?? null;

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
        controls={
          account && !merged ? (
            <div className="flex items-center gap-1.5">
              {state === "open" ? (
                <DraftToggleButton
                  target={target}
                  account={account}
                  isDraft={isDraft}
                  nodeId={pr.node_id}
                />
              ) : null}
              <CloseReopenButton
                target={target}
                account={account}
                state={state}
                stateReason={null}
              />
            </div>
          ) : null
        }
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
          <ChecksPanel
            checks={checks}
            target={target}
            account={account}
            headSha={pr.head.sha}
          />
        )}
      </SidebarSection>

      <SidebarSection
        label="Reviewers"
        action={
          account ? (
            <ReviewersPicker
              target={target}
              account={account}
              pr={pr}
              trigger={<SidebarIconTrigger label="Edit reviewers" />}
            />
          ) : null
        }
      >
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

      <SidebarSection
        label="Assignees"
        action={
          account ? (
            <AssigneePicker
              target={target}
              account={account}
              item={pr}
              trigger={<SidebarIconTrigger label="Edit assignees" />}
            />
          ) : null
        }
      >
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

      <SidebarSection
        label="Labels"
        action={
          account ? (
            <LabelEditor
              target={target}
              account={account}
              item={pr}
              trigger={<SidebarIconTrigger label="Edit labels" />}
            />
          ) : null
        }
      >
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

      <SidebarSection
        label="Milestone"
        action={
          account ? (
            <MilestonePicker
              target={target}
              account={account}
              item={pr}
              trigger={<SidebarIconTrigger label="Edit milestone" />}
            />
          ) : null
        }
      >
        {milestone ? (
          <div className="text-[12px]">{milestone}</div>
        ) : (
          <SidebarEmpty>No milestone</SidebarEmpty>
        )}
      </SidebarSection>
    </div>
  );
}

function SidebarIconTrigger({
  label,
  ...props
}: { label: string } & React.ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      {...props}
    >
      <Plus />
    </Button>
  );
}

function StateCard({
  state,
  isDraft,
  merged,
  mergeable,
  controls,
}: {
  state: "open" | "closed";
  isDraft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  controls?: React.ReactNode;
}) {
  const showMergeHint = state === "open" && !merged;
  return (
    <div className="mb-3 rounded-md border border-border/50 bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <PRStateBadge state={state} isDraft={isDraft} merged={merged} />
        {controls}
      </div>
      {showMergeHint ? (
        <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground/70">
          <GitMerge className="size-3" />
          {mergeable === false ? "Conflicts" : "Merge when ready"}
        </div>
      ) : null}
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
