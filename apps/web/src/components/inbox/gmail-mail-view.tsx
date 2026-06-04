import type { ColumnConfig, FilterRule } from "@g-spot/types/filters";

import type { GmailThread } from "@/lib/gmail/types";
import { GmailThreadTable } from "./gmail-thread-table";

type GmailMailViewProps = {
  sectionId: string;
  filters: FilterRule;
  accountId?: string | null;
  sortAsc?: boolean;
  onCountChange?: (count: number, countTotalPending: boolean) => void;
  selectedThreadKey?: string | null;
  onSelectThread?: (thread: GmailThread, accountId: string | null, threads: GmailThread[]) => void;
  columns?: ColumnConfig[];
};

export function GmailMailView({
  sectionId,
  filters,
  accountId,
  sortAsc,
  onCountChange,
  selectedThreadKey,
  onSelectThread,
  columns,
}: GmailMailViewProps) {
  return (
    <GmailThreadTable
      sectionId={sectionId}
      filters={filters}
      accountId={accountId}
      sortAsc={sortAsc}
      onCountChange={onCountChange}
      selectedThreadKey={selectedThreadKey}
      onSelectThread={
        onSelectThread
          ? (thread, threads) =>
            onSelectThread(thread, thread.accountId ?? accountId ?? null, threads)
          : undefined
      }
      columns={columns}
    />
  );
}
