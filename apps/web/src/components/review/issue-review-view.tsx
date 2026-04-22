import type { OAuthConnection } from "@stackframe/react";
import { Skeleton } from "@g-spot/ui/components/skeleton";

import type { ReviewTarget } from "@/hooks/use-github-detail";
import {
  useGitHubIssueDetail,
  useGitHubIssueTimeline,
} from "@/hooks/use-github-detail";

import { IssueActionBar } from "./action-bar";
import { DescriptionCard, SectionHeading } from "./overview-region";
import { IssueCondensedHeader, IssueFullHeader } from "./pr-header";
import { IssueSidebar } from "./issue-sidebar";
import { ReviewShell } from "./shell";
import { Timeline, TimelineSkeleton } from "./timeline";

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function IssueReviewView({
  target,
  account,
}: {
  target: ReviewTarget;
  account: OAuthConnection;
}) {
  const detail = useGitHubIssueDetail(target, account);
  const timeline = useGitHubIssueTimeline(target, account);
  const isLoading = detail.isLoading || timeline.isLoading;
  const issue = detail.data;

  const repoLabel = `${target.owner}/${target.repo}`;

  const fullHeader = issue ? (
    <IssueFullHeader
      repoLabel={repoLabel}
      number={issue.number}
      title={issue.title}
      url={issue.html_url}
      author={
        issue.user
          ? { login: issue.user.login, avatarUrl: issue.user.avatar_url }
          : null
      }
      createdAgo={relativeTime(issue.created_at)}
    />
  ) : (
    <div className="space-y-3 pb-6 pt-2">
      <Skeleton className="h-3 w-40" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );

  const condensedHeader = issue ? (
    <IssueCondensedHeader number={issue.number} title={issue.title} />
  ) : (
    <div className="h-10" />
  );

  const sidebar = issue ? (
    <IssueSidebar
      state={issue.state as "open" | "closed"}
      stateReason={issue.state_reason ?? null}
      author={
        issue.user
          ? { login: issue.user.login, avatarUrl: issue.user.avatar_url }
          : null
      }
      assignees={(issue.assignees ?? []).map((a) => ({
        login: a.login,
        avatarUrl: a.avatar_url,
      }))}
      labels={issue.labels.map((l) => {
        if (typeof l === "string") return { name: l, color: "aeaeb8" };
        return { name: l.name ?? "", color: l.color ?? "aeaeb8" };
      })}
      milestone={issue.milestone?.title ?? null}
    />
  ) : (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-16 w-full rounded-md" />
      ))}
    </div>
  );

  const main = (
    <div className="space-y-8">
      <section>
        <SectionHeading>Description</SectionHeading>
        {detail.isLoading || !issue ? (
          <Skeleton className="h-32 w-full rounded-md" />
        ) : (
          <DescriptionCard markdown={issue.body} />
        )}
      </section>

      <section>
        <SectionHeading>Activity</SectionHeading>
        {timeline.isLoading ? (
          <TimelineSkeleton />
        ) : (
          <Timeline
            events={timeline.data ?? []}
            target={target}
            account={account}
          />
        )}
      </section>
    </div>
  );

  return (
    <ReviewShell
      isLoading={isLoading}
      fullHeader={fullHeader}
      condensedHeader={condensedHeader}
      main={main}
      rightSidebar={sidebar}
      actions={
        issue ? (
          <IssueActionBar issue={issue} target={target} account={account} />
        ) : null
      }
    />
  );
}
