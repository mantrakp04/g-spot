import { Plus } from "lucide-react";
import type { OAuthConnection } from "@stackframe/react";

import { Button } from "@g-spot/ui/components/button";

import type { ReviewTarget } from "@/hooks/use-github-detail";
import { useGitHubIssueDetail } from "@/hooks/use-github-detail";

import {
  AssigneePicker,
  CloseReopenButton,
  LabelEditor,
  MilestonePicker,
} from "./action-bar";
import {
  SidebarEmpty,
  SidebarSection,
} from "./sidebar-section";
import { StateBadge } from "./state-badge";

type Issue = NonNullable<ReturnType<typeof useGitHubIssueDetail>["data"]>;
type Actor = { login: string; avatarUrl: string };

export function IssueSidebar({
  issue,
  target,
  account,
}: {
  issue: Issue;
  target: ReviewTarget;
  account: OAuthConnection | null;
}) {
  const state = issue.state as "open" | "closed";
  const stateReason = issue.state_reason ?? null;
  const author: Actor | null = issue.user
    ? { login: issue.user.login, avatarUrl: issue.user.avatar_url }
    : null;
  const assignees: Actor[] = (issue.assignees ?? []).map((a) => ({
    login: a.login,
    avatarUrl: a.avatar_url,
  }));
  const labels = issue.labels.map((l) => {
    if (typeof l === "string") return { name: l, color: "aeaeb8" };
    return { name: l.name ?? "", color: l.color ?? "aeaeb8" };
  });
  const milestone = issue.milestone?.title ?? null;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-border/50 bg-card px-3 py-2.5">
        <StateBadge kind="issue" state={state} stateReason={stateReason} />
        {account ? (
          <CloseReopenButton
            target={target}
            account={account}
            state={state}
            stateReason={stateReason}
          />
        ) : null}
      </div>

      <SidebarSection
        label="Assignees"
        action={
          account ? (
            <AssigneePicker
              target={target}
              account={account}
              item={issue}
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
              item={issue}
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
              item={issue}
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

      {author ? (
        <SidebarSection label="Author">
          <UserRow user={author} />
        </SidebarSection>
      ) : null}
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

function UserRow({ user }: { user: Actor }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      {user.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.avatarUrl} alt="" className="size-5 rounded-full" />
      ) : (
        <span className="size-5 rounded-full bg-border" />
      )}
      <span className="truncate">{user.login}</span>
    </div>
  );
}
