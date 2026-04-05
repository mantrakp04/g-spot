import { useEffect, useState } from "react";

import type { FilterCondition, ColumnConfig } from "@g-spot/types/filters";
import { getDefaultColumns, PR_COLUMN_META, ISSUE_COLUMN_META } from "@g-spot/types/filters";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@g-spot/ui/components/table";
import { useUser } from "@stackframe/react";
import { Loader2 } from "lucide-react";

import { ColumnHeader } from "./column-layout";
import { GitHubIssueRow } from "./github-issue-row";
import { GitHubPRRow } from "./github-pr-row";
import { SectionEmpty } from "./section-empty";
import { SectionSkeleton } from "./section-skeleton";
import { useGitHubItems } from "@/hooks/use-github-items";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { useReadState } from "@/hooks/use-read-state";
import { useResizableSectionColumns } from "@/hooks/use-resizable-section-columns";
import type { GitHubIssue, GitHubPullRequest } from "@/lib/github/types";

type GitHubTableProps = {
  source: "github_pr" | "github_issue";
  sectionId: string;
  filters: FilterCondition[];
  repos?: string[];
  accountId?: string | null;
  sortAsc?: boolean;
  onCountChange?: (count: number) => void;
  columns?: ColumnConfig[];
};

export function GitHubTable({
  source,
  sectionId,
  filters,
  repos,
  accountId,
  sortAsc,
  onCountChange,
  columns: columnsProp,
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

  const columnMeta = source === "github_pr" ? PR_COLUMN_META : ISSUE_COLUMN_META;
  const { columns: baseColumns, resizingColumnId, beginResize } = useResizableSectionColumns(
    sectionId,
    source,
    columnsProp && columnsProp.length > 0 ? columnsProp : getDefaultColumns(source),
  );
  const visibleColumns = baseColumns.filter((c) => c.visible);

  // ── Rendering ─────────────────────────────────────────────────────────
  const label = source === "github_pr" ? "pull requests" : "issues";

  if (!user) return <SectionEmpty source={source} message={`Sign in to view ${label}`} />;
  if (!githubAccount) return <SectionEmpty source={source} message={`Connect your GitHub account to view ${label}`} />;
  if (isLoading) return <SectionSkeleton rows={7} />;
  if (isError) return <SectionEmpty source={source} message={error?.message ?? `Failed to load ${label}`} />;

  const items = data?.pages.flatMap((page) => {
    const p = page as Record<string, unknown>;
    return (page.items ?? p.pullRequests ?? p.issues ?? []) as typeof page.items;
  }) ?? [];

  if (items.length === 0) return <SectionEmpty source={source} />;

  return (
    <div ref={setScrollContainer} className="max-h-[28rem] overflow-y-auto [&_[data-slot=table-container]]:overflow-visible">
      <Table className="table-fixed">
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow className="hover:bg-transparent">
            {visibleColumns.map((col) => {
              const meta = columnMeta[col.id as keyof typeof columnMeta];
              if (!meta) return null;
              return (
                <ColumnHeader
                  key={col.id}
                  meta={meta}
                  column={col}
                  className={col.id === "title" ? "pl-3" : undefined}
                  isResizing={resizingColumnId === col.id}
                  onResizeStart={(event) => beginResize(col.id, event)}
                />
              );
            })}
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const isPR = source === "github_pr" || item.itemType === "pull_request";
            return isPR ? (
              <GitHubPRRow key={item.id} pr={item as GitHubPullRequest} isUnread={isUnread(item.id)} onMarkRead={markAsRead} columns={baseColumns} />
            ) : (
              <GitHubIssueRow key={item.id} issue={item as GitHubIssue} isUnread={isUnread(item.id)} onMarkRead={markAsRead} columns={baseColumns} />
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
