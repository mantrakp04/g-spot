import { useEffect, useMemo, type HTMLAttributes, type ReactElement } from "react";

import type { ColumnConfig, FilterCondition } from "@g-spot/types/filters";
import { getDefaultColumns, normalizeColumns } from "@g-spot/types/filters";
import { useQuery } from "@tanstack/react-query";

import type { GmailThread } from "@/lib/gmail/types";
import { useGmailThreadCount } from "@/hooks/use-gmail-thread-count";
import { useGmailThreads } from "@/hooks/use-gmail-threads";
import { useUpdateSectionMutation } from "@/hooks/use-sections";
import { gmailKeys } from "@/lib/query-keys";
import { persistedStaleWhileRevalidateQueryOptions } from "@/utils/query-defaults";
import { trpcClient } from "@/utils/trpc";
import { buildGmailColumns } from "./columns/gmail-columns";
import { InboxDataTable } from "./inbox-data-table";
import { GmailThreadPreview, RowPreviewPopover } from "./row-preview";
import { SectionEmpty } from "./section-empty";

type GmailThreadTableProps = {
  sectionId: string;
  filters: FilterCondition[];
  accountId?: string | null;
  sortAsc?: boolean;
  /** Second arg: show "+" on the count badge while the total-count query is still loading. */
  onCountChange?: (count: number, countTotalPending: boolean) => void;
  selectedThreadId?: string | null;
  onSelectThread?: (thread: GmailThread, threads: GmailThread[]) => void;
  columns?: ColumnConfig[];
};

export function GmailThreadTable({
  sectionId,
  filters,
  accountId,
  sortAsc,
  onCountChange,
  selectedThreadId,
  onSelectThread,
  columns: columnsProp,
}: GmailThreadTableProps) {
  const providerAccountId = accountId ?? null;

  const { data, isLoading, isError, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useGmailThreads(sectionId, filters, providerAccountId);
  const { data: countData, isPending: isCountTotalPending } = useGmailThreadCount(
    sectionId,
    filters,
    providerAccountId,
  );
  const { data: labelCatalog } = useQuery({
    queryKey: gmailKeys.labelsCatalog(providerAccountId),
    queryFn: () =>
      trpcClient.gmail.getLabelCatalog.query({
        providerAccountId: providerAccountId!,
      }),
    enabled: providerAccountId != null,
    ...persistedStaleWhileRevalidateQueryOptions,
  });

  const loadedCount = data?.pages.reduce((sum, p) => sum + p.threads.length, 0) ?? 0;
  const displayCount = countData?.count ?? loadedCount;
  useEffect(() => {
    onCountChange?.(displayCount, isCountTotalPending);
  }, [isCountTotalPending, displayCount, onCountChange]);

  const updateSectionMutation = useUpdateSectionMutation();

  const threads = useMemo(() => {
    const flat = data?.pages.flatMap((p) => p.threads) ?? [];
    if (!sortAsc) return flat;
    return [...flat].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [data, sortAsc]);

  const labelCatalogById = useMemo(
    () => Object.fromEntries((labelCatalog ?? []).map((label) => [label.id, label])),
    [labelCatalog],
  );

  // Key the memo on the *content* of columnsProp, not its reference — the
  // parent re-creates this array on every render (parseJson), so relying on
  // reference equality would thrash every child memo each render.
  const columnsPropKey = columnsProp ? JSON.stringify(columnsProp) : "";
  const columnConfig = useMemo<ColumnConfig[]>(
    () =>
      normalizeColumns(
        "gmail",
        columnsProp && columnsProp.length > 0 ? columnsProp : getDefaultColumns("gmail"),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columnsPropKey],
  );

  const tableColumns = useMemo(
    () =>
      buildGmailColumns({
        columnConfig: columnConfig.map((c) => ({
          id: c.id,
          visible: c.visible,
          truncation: c.truncation ?? "end",
          label: c.label,
        })),
        labelCatalog: labelCatalogById,
      }),
    [columnConfig, labelCatalogById],
  );

  if (!providerAccountId)
    return (
      <SectionEmpty source="gmail" message="No Google account linked to this section" />
    );

  return (
    <InboxDataTable
      columns={tableColumns}
      data={threads}
      getRowId={(thread) => thread.id}
      columnConfig={columnConfig}
      fillColumnId="subject"
      onColumnConfigChange={(next) =>
        updateSectionMutation.mutate({ id: sectionId, columns: next })
      }
      rowClassName={(thread) =>
        selectedThreadId === thread.threadId ? "bg-accent" : undefined
      }
      onRowClick={onSelectThread ? (thread) => onSelectThread(thread, threads) : undefined}
      rowWrapper={(thread, element) => (
        <RowPreviewPopover preview={<GmailThreadPreview thread={thread} />}>
          {element as ReactElement<HTMLAttributes<HTMLElement>>}
        </RowPreviewPopover>
      )}
      hasNextPage={hasNextPage ?? false}
      isFetchingNextPage={isFetchingNextPage}
      fetchNextPage={() => void fetchNextPage()}
      isLoading={isLoading}
      emptyState={<SectionEmpty source="gmail" />}
      errorState={
        isError
          ? <SectionEmpty source="gmail" message={error?.message ?? "Failed to load email threads"} />
          : undefined
      }
    />
  );
}
