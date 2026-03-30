import { useState } from "react";

import type { FilterCondition } from "@g-spot/api/schemas/section-filters";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@g-spot/ui/components/resizable";
import { useUser } from "@stackframe/react";

import type { GmailThread } from "@/lib/gmail/types";
import { GmailThreadTable } from "./gmail-thread-table";
import {
  GmailThreadDetail,
  GmailThreadDetailEmpty,
} from "./gmail-thread-detail";
import { useGmailThread } from "@/hooks/use-gmail-thread";

type GmailMailViewProps = {
  sectionId: string;
  filters: FilterCondition[];
  accountId?: string | null;
  sortAsc?: boolean;
  onCountChange?: (count: number, hasMore: boolean) => void;
};

export function GmailMailView({
  sectionId,
  filters,
  accountId,
  sortAsc,
  onCountChange,
}: GmailMailViewProps) {
  const [selectedThread, setSelectedThread] = useState<GmailThread | null>(null);

  const user = useUser();
  const accounts = user?.useConnectedAccounts();
  const googleAccount = accountId
    ? accounts?.find((a) => a.providerAccountId === accountId) ?? null
    : accounts?.find((a) => a.provider === "google") ?? null;

  const { data: threadDetail, isLoading: isDetailLoading } = useGmailThread(
    selectedThread?.threadId ?? null,
    googleAccount,
  );

  return (
    <ResizablePanelGroup
      direction="horizontal"
      className="min-h-[28rem] max-h-[36rem]"
    >
      {/* Thread list panel */}
      <ResizablePanel defaultSize={selectedThread ? 45 : 100} minSize={30}>
        <GmailThreadTable
          sectionId={sectionId}
          filters={filters}
          accountId={accountId}
          sortAsc={sortAsc}
          onCountChange={onCountChange}
          selectedThreadId={selectedThread?.threadId}
          onSelectThread={setSelectedThread}
        />
      </ResizablePanel>

      {/* Detail panel - only shown when a thread is selected */}
      {selectedThread && (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={55} minSize={30}>
            <GmailThreadDetail
              thread={selectedThread}
              detail={threadDetail}
              isLoading={isDetailLoading}
              onClose={() => setSelectedThread(null)}
            />
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
}
