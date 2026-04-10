import { useEffect, useMemo, type HTMLAttributes, type ReactElement } from "react";

import type { ColumnConfig, FilterCondition } from "@g-spot/types/filters";
import { getDefaultColumns, normalizeColumns } from "@g-spot/types/filters";
import { useUser } from "@stackframe/react";

import type { GitHubIssue, GitHubPullRequest } from "@/lib/github/types";
import { useGitHubItems } from "@/hooks/use-github-items";
import { useReadState } from "@/hooks/use-read-state";
import { useUpdateSectionMutation } from "@/hooks/use-sections";
import { buildIssueColumns } from "./columns/github-issue-columns";
import { buildPrColumns } from "./columns/github-pr-columns";
import { InboxDataTable } from "./inbox-data-table";
import {
  GitHubIssuePreview,
  GitHubPRPreview,
  RowPreviewPopover,
} from "./row-preview";
import { SectionEmpty } from "./section-empty";

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

  const updateSectionMutation = useUpdateSectionMutation();

  // Key the memo on the *content* of columnsProp, not its reference — the
  // parent re-creates this array on every render (parseJson), so relying on
  // reference equality would thrash every child memo each render.
  const columnsPropKey = columnsProp ? JSON.stringify(columnsProp) : "";
  const columnConfig = useMemo<ColumnConfig[]>(
    () =>
      normalizeColumns(
        source,
        columnsProp && columnsProp.length > 0 ? columnsProp : getDefaultColumns(source),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columnsPropKey, source],
  );

  const items = useMemo(
    () =>
      data?.pages.flatMap((page) => {
        const p = page as Record<string, unknown>;
        return (page.items ?? p.pullRequests ?? p.issues ?? []) as unknown[];
      }) ?? [],
    [data],
  );

  const configForColumns = useMemo(
    () =>
      columnConfig.map((c) => ({
        id: c.id,
        visible: c.visible,
        truncation: c.truncation ?? "end",
        label: c.label,
      })),
    [columnConfig],
  );

  const prColumns = useMemo(
    () => buildPrColumns({ columnConfig: configForColumns, isUnread }),
    [configForColumns, isUnread],
  );
  const issueColumns = useMemo(
    () => buildIssueColumns({ columnConfig: configForColumns, isUnread }),
    [configForColumns, isUnread],
  );

  const label = source === "github_pr" ? "pull requests" : "issues";

  if (!user) return <SectionEmpty source={source} message={`Sign in to view ${label}`} />;
  if (!githubAccount)
    return (
      <SectionEmpty source={source} message={`Connect your GitHub account to view ${label}`} />
    );

  const sharedProps = {
    columnConfig,
    onColumnConfigChange: (next: ColumnConfig[]) =>
      updateSectionMutation.mutate({ id: sectionId, columns: next }),
    fillColumnId: "title",
    hasNextPage: hasNextPage ?? false,
    isFetchingNextPage,
    fetchNextPage: () => void fetchNextPage(),
    isLoading,
    emptyState: <SectionEmpty source={source} />,
    errorState: isError ? (
      <SectionEmpty source={source} message={error?.message ?? `Failed to load ${label}`} />
    ) : undefined,
  };

  if (source === "github_pr") {
    return (
      <InboxDataTable<GitHubPullRequest>
        {...sharedProps}
        columns={prColumns}
        data={items as GitHubPullRequest[]}
        getRowId={(pr) => pr.id}
        onRowClick={(pr) => {
          markAsRead(pr.id);
          window.open(pr.url, "_blank", "noopener");
        }}
        rowWrapper={(pr, element) => (
          <RowPreviewPopover preview={<GitHubPRPreview pr={pr} />}>
            {element as ReactElement<HTMLAttributes<HTMLElement>>}
          </RowPreviewPopover>
        )}
      />
    );
  }

  return (
    <InboxDataTable<GitHubIssue>
      {...sharedProps}
      columns={issueColumns}
      data={items as GitHubIssue[]}
      getRowId={(issue) => issue.id}
      onRowClick={(issue) => {
        markAsRead(issue.id);
        window.open(issue.url, "_blank", "noopener");
      }}
      rowWrapper={(issue, element) => (
        <RowPreviewPopover preview={<GitHubIssuePreview issue={issue} />}>
          {element as ReactElement<HTMLAttributes<HTMLElement>>}
        </RowPreviewPopover>
      )}
    />
  );
}
