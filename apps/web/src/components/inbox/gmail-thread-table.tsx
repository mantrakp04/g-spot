import { useEffect, useMemo, type HTMLAttributes, type ReactElement } from "react";

import type { ColumnConfig, FilterRule } from "@g-spot/types/filters";
import { useQuery } from "@tanstack/react-query";

import type { GmailThread } from "@/lib/gmail/types";
import { useGmailThreadCount } from "@/hooks/use-gmail-thread-count";
import type { GmailLabelCatalogEntry } from "@/hooks/use-gmail-options";
import { useGmailThreads } from "@/hooks/use-gmail-threads";
import { useUpdateSectionMutation } from "@/hooks/use-sections";
import { gmailKeys } from "@/lib/query-keys";
import { persistedStaleWhileRevalidateQueryOptions } from "@/utils/query-defaults";
import { trpcClient } from "@/utils/trpc";
import { buildGmailColumns } from "./columns/gmail-columns";
import { useNormalizedColumnConfig } from "./columns/use-normalized-column-config";
import { InboxDataTable } from "./inbox-data-table";
import { GmailThreadPreview, RowPreviewPopover } from "./row-preview";
import { SectionEmpty } from "./section-empty";

type GmailThreadTableProps = {
  sectionId: string;
  filters: FilterRule;
  accountId?: string | null;
  sortAsc?: boolean;
  /** Second arg: show "+" on the count badge while the total-count query is still loading. */
  onCountChange?: (count: number, countTotalPending: boolean) => void;
  selectedThreadKey?: string | null;
  onSelectThread?: (thread: GmailThread, threads: GmailThread[]) => void;
  columns?: ColumnConfig[];
};

export function GmailThreadTable({
  sectionId,
  filters,
  accountId,
  sortAsc,
  onCountChange,
  selectedThreadKey,
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
  const { data: labelCatalog } = useQuery<GmailLabelCatalogEntry[]>({
    queryKey: gmailKeys.labelsCatalog(providerAccountId),
    queryFn: () =>
      trpcClient.gmail.getLabelCatalog.query({
        providerAccountId,
      }),
    ...persistedStaleWhileRevalidateQueryOptions,
  });

  const loadedCount = data?.pages.reduce((sum, p) => sum + p.threads.length, 0) ?? 0;
  // useGmailThreadCount's data type is currently erased to `{}` by the shared
  // persister options (query-defaults.ts) — re-derive the real procedure output.
  const totalCount = countData as
    | Awaited<ReturnType<typeof trpcClient.gmail.getThreadCount.query>>
    | undefined;
  const displayCount = totalCount?.count ?? loadedCount;
  useEffect(() => {
    onCountChange?.(displayCount, isCountTotalPending);
  }, [isCountTotalPending, displayCount, onCountChange]);

  const updateSectionMutation = useUpdateSectionMutation({ refetchOnSettled: false });

  const threads = useMemo(() => {
    const flat = data?.pages.flatMap((p) => p.threads) ?? [];
    if (!sortAsc) return flat;
    return [...flat].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [data, sortAsc]);

  const labelCatalogById = useMemo(
    () => Object.fromEntries((labelCatalog ?? []).map((label) => [label.id, label])),
    [labelCatalog],
  );

  const columnConfig = useNormalizedColumnConfig("gmail", columnsProp);

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
        selectedThreadKey === `${thread.accountId}:${thread.threadId}` ? "bg-accent" : undefined
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
