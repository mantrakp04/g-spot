import { useEffect, useState } from "react";

import type { FilterCondition } from "@g-spot/types/filters";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@g-spot/ui/components/table";
import { useUser } from "@stackframe/react";
import { Loader2 } from "lucide-react";

import { GitHubIssueRow } from "./github-issue-row";
import { GitHubPRRow } from "./github-pr-row";
import { SectionEmpty } from "./section-empty";
import { SectionSkeleton } from "./section-skeleton";
import { useGitHubItems } from "@/hooks/use-github-items";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { useReadState } from "@/hooks/use-read-state";
import type { GitHubIssue, GitHubPullRequest } from "@/lib/github/types";

type GitHubTableProps = {
  source: "github_pr" | "github_issue";
  sectionId: string;
  filters: FilterCondition[];
  repos?: string[];
  accountId?: string | null;
  sortAsc?: boolean;
  onCountChange?: (count: number) => void;
};

export function GitHubTable({
  source,
  sectionId,
  filters,
  repos,
  accountId,
  sortAsc,
  onCountChange,
}: GitHubTableProps) {
  const user = useUser();
  const accounts = user?.useConnectedAccounts();
  const githubAccount = accountId
    ? accounts?.find((a) => a.providerAccountId === accountId) ?? null
    : accounts?.find((a) => a.provider === "github") ?? null;

  const { data, isLoading, isError, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useGitHubItems(source, sectionId, filters, githubAccount, repos, sortAsc);

  const totalCount = data?.pages[0]?.totalCount ?? 0;
  useEffect(() => {
    onCountChange?.(totalCount);
  }, [totalCount, onCountChange]);

  const readStateKey = source === "github_pr" ? "github-prs" : "github-issues";
  const { isUnread, markAsRead } = useReadState(`${readStateKey}:${sectionId}`);

  const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);
  const sentinelRef = useInfiniteScroll({
    hasNextPage: hasNextPage ?? false,
    isFetchingNextPage,
    fetchNextPage: () => void fetchNextPage(),
    root: scrollContainer,
  });

  const label = source === "github_pr" ? "pull requests" : "issues";

  if (!user) {
    return <SectionEmpty source={source} message={`Sign in to view ${label}`} />;
  }

  if (!githubAccount) {
    return (
      <SectionEmpty
        source={source}
        message={`Connect your GitHub account to view ${label}`}
      />
    );
  }

  if (isLoading) return <SectionSkeleton rows={7} />;

  if (isError) {
    return (
      <SectionEmpty
        source={source}
        message={error?.message ?? `Failed to load ${label}`}
      />
    );
  }

  const items = data?.pages.flatMap((page) => {
    // Handle both new unified shape and stale persisted cache with old shape
    const p = page as Record<string, unknown>;
    return (page.items ?? p.pullRequests ?? p.issues ?? []) as typeof page.items;
  }) ?? [];

  if (items.length === 0) return <SectionEmpty source={source} />;

  return (
    <div ref={setScrollContainer} className="max-h-[28rem] overflow-y-auto [&_[data-slot=table-container]]:overflow-visible">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-3">Title</TableHead>
            {source === "github_pr" ? (
              <>
                <TableHead className="hidden md:table-cell">Reviewers</TableHead>
                <TableHead className="hidden text-center sm:table-cell">CI</TableHead>
                <TableHead className="hidden text-center sm:table-cell">Review</TableHead>
                <TableHead className="hidden lg:table-cell">Changes</TableHead>
              </>
            ) : (
              <>
                <TableHead className="hidden text-center sm:table-cell">Status</TableHead>
                <TableHead className="hidden text-center md:table-cell">Comments</TableHead>
              </>
            )}
            <TableHead className="pr-3 text-right">Updated</TableHead>
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const isPR = source === "github_pr" || item.itemType === "pull_request";
            return isPR ? (
              <GitHubPRRow key={item.id} pr={item as GitHubPullRequest} isUnread={isUnread(item.id)} onMarkRead={markAsRead} />
            ) : (
              <GitHubIssueRow key={item.id} issue={item as GitHubIssue} isUnread={isUnread(item.id)} onMarkRead={markAsRead} />
            );
          })}
        </TableBody>
      </Table>

      {hasNextPage && <div ref={sentinelRef} className="h-1" />}

      {isFetchingNextPage && (
        <div className="flex justify-center py-2">
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
