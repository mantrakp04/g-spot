import type { FilterCondition } from "@g-spot/types/filters";

import type { GmailThread } from "@/lib/gmail/types";
import { GmailThreadTable } from "./gmail-thread-table";

type GmailMailViewProps = {
  sectionId: string;
  filters: FilterCondition[];
  accountId?: string | null;
  sortAsc?: boolean;
  onCountChange?: (count: number, hasMore: boolean) => void;
  selectedThreadId?: string | null;
  onSelectThread?: (thread: GmailThread, accountId: string | null) => void;
};

export function GmailMailView({
  sectionId,
  filters,
  accountId,
  sortAsc,
  onCountChange,
  selectedThreadId,
  onSelectThread,
}: GmailMailViewProps) {
  return (
    <GmailThreadTable
      sectionId={sectionId}
      filters={filters}
      accountId={accountId}
      sortAsc={sortAsc}
      onCountChange={onCountChange}
      selectedThreadId={selectedThreadId}
      onSelectThread={
        onSelectThread
          ? (thread) => onSelectThread(thread, accountId ?? null)
          : undefined
      }
    />
  );
}
