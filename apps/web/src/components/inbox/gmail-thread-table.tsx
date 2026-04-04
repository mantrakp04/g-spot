import { useState, useEffect, useMemo } from "react";

import type { FilterCondition } from "@g-spot/types/filters";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@g-spot/ui/components/table";
import { TooltipProvider } from "@g-spot/ui/components/tooltip";
import { useUser } from "@stackframe/react";
import { Loader2 } from "lucide-react";

import type { GmailThread } from "@/lib/gmail/types";
import { GmailThreadRow } from "./gmail-thread-row";
import { SectionEmpty } from "./section-empty";
import { useGmailThreads } from "@/hooks/use-gmail-threads";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";

type GmailThreadTableProps = {
  sectionId: string;
  filters: FilterCondition[];
  accountId?: string | null;
  sortAsc?: boolean;
  onCountChange?: (count: number, hasMore: boolean) => void;
  selectedThreadId?: string | null;
  onSelectThread?: (thread: GmailThread) => void;
};

function GmailSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <Table>
      <TableBody>
        {Array.from({ length: rows }, (_, i) => (
          <TableRow key={i} className="pointer-events-none">
            <TableCell className="w-48 pl-3">
              <div className="flex items-center gap-2.5">
                <Skeleton className="size-1.5 rounded-full" />
                <Skeleton className="size-6 rounded-full" />
                <Skeleton className="h-3.5 w-24" />
              </div>
            </TableCell>
            <TableCell className="w-full">
              <Skeleton className="h-3.5 w-64" />
            </TableCell>
            <TableCell className="hidden sm:table-cell">
              <Skeleton className="size-3" />
            </TableCell>
            <TableCell className="pr-3 text-right">
              <Skeleton className="ml-auto h-3 w-12" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function GmailThreadTable({ sectionId, filters, accountId, sortAsc, onCountChange, selectedThreadId, onSelectThread }: GmailThreadTableProps) {
  const user = useUser();
  const accounts = user?.useConnectedAccounts();
  const googleAccount = accountId
    ? accounts?.find((a) => a.providerAccountId === accountId) ?? null
    : accounts?.find((a) => a.provider === "google") ?? null;

  const { data, isLoading, isError, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useGmailThreads(sectionId, filters, googleAccount);

  // Report the filtered total estimate from Gmail rather than just loaded rows.
  const loadedCount = data?.pages.reduce((sum, p) => sum + p.threads.length, 0) ?? 0;
  const estimatedTotalCount = data?.pages[0]?.resultSizeEstimate ?? loadedCount;
  useEffect(() => {
    onCountChange?.(estimatedTotalCount, false);
  }, [estimatedTotalCount, onCountChange]);

  const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);
  const sentinelRef = useInfiniteScroll({
    hasNextPage: hasNextPage ?? false,
    isFetchingNextPage,
    fetchNextPage: () => void fetchNextPage(),
    root: scrollContainer,
  });

  const threads = useMemo(() => {
    const flat = data?.pages.flatMap((p) => p.threads) ?? [];
    if (!sortAsc) return flat;
    return [...flat].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [data, sortAsc]);

  if (!user) {
    return (
      <SectionEmpty source="gmail" message="Sign in to view email threads" />
    );
  }

  if (!googleAccount) {
    return (
      <SectionEmpty
        source="gmail"
        message="Connect your Google account to view email threads"
      />
    );
  }

  if (isLoading) {
    return <GmailSkeleton />;
  }

  if (isError) {
    return (
      <SectionEmpty
        source="gmail"
        message={error?.message ?? "Failed to load email threads"}
      />
    );
  }

  if (threads.length === 0) {
    return <SectionEmpty source="gmail" />;
  }

  return (
    <TooltipProvider>
    <div ref={setScrollContainer} className="max-h-[28rem] overflow-y-auto [&_[data-slot=table-container]]:overflow-visible">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-48 pl-3">From</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead className="hidden sm:table-cell" />
            <TableHead className="pr-3 text-right">Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {threads.map((thread) => (
            <GmailThreadRow
              key={thread.id}
              thread={thread}
              isSelected={selectedThreadId === thread.threadId}
              onClick={onSelectThread}
            />
          ))}
        </TableBody>
      </Table>

      {hasNextPage && <div ref={sentinelRef} className="h-1" />}

      {isFetchingNextPage && (
        <div className="flex justify-center py-2">
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
    </TooltipProvider>
  );
}
