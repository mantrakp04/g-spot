import { useState, useCallback } from "react";

import type { FilterCondition, SectionSource } from "@g-spot/types/filters";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@g-spot/ui/components/resizable";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import { useUser } from "@stackframe/react";
import { createFileRoute } from "@tanstack/react-router";
import { Inbox } from "lucide-react";

import { GitHubTable } from "@/components/inbox/github-table";
import { GmailMailView } from "@/components/inbox/gmail-mail-view";
import {
  GmailThreadDetail,
} from "@/components/inbox/gmail-thread-detail";
import { InboxSection } from "@/components/inbox/inbox-section";
import { SectionBuilder } from "@/components/inbox/section-builder";
import { useMarkGmailThreadReadMutation } from "@/hooks/use-gmail-actions";
import { useGmailThread } from "@/hooks/use-gmail-thread";
import { useSections, useUpdateSectionMutation } from "@/hooks/use-sections";
import { useSectionCounts } from "@/contexts/section-counts-context";
import type { GmailThread } from "@/lib/gmail/types";

export const Route = createFileRoute("/")({
  component: InboxPage,
});

function parseFilters(filtersJson: string): FilterCondition[] {
  try {
    return JSON.parse(filtersJson) as FilterCondition[];
  } catch {
    return [];
  }
}

function parseJson<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

type SelectedThreadState = {
  thread: GmailThread;
  accountId: string | null;
} | null;

function InboxPage() {
  const { data: sections, isLoading } = useSections();

  const [editingSection, setEditingSection] = useState<{
    id: string;
    name: string;
    source: SectionSource;
    filters: string;
    repos: string;
    accountId: string | null;
    showBadge: boolean;
  } | null>(null);

  // Per-section collapse overrides (optimistic, local-first)
  const [collapseState, setCollapseState] = useState<Record<string, boolean>>({});

  // Per-section sort direction (ascending = oldest first)
  const [sortState, setSortState] = useState<Record<string, boolean>>({});

  // Per-section item counts from data queries (shared with sidebar via context)
  const { counts: sectionCounts, setCount } = useSectionCounts();
  const [sectionHasMore, setSectionHasMore] = useState<Record<string, boolean>>({});

  const handleCountChange = useCallback((sectionId: string, count: number, hasMore?: boolean) => {
    setCount(sectionId, count);
    if (hasMore !== undefined) {
      setSectionHasMore((prev) => {
        if (prev[sectionId] === hasMore) return prev;
        return { ...prev, [sectionId]: hasMore };
      });
    }
  }, [setCount]);

  // Lifted selected thread state for the right detail panel
  const [selectedThread, setSelectedThread] = useState<SelectedThreadState>(null);
  const updateSectionMutation = useUpdateSectionMutation();
  const markThreadReadMutation = useMarkGmailThreadReadMutation();

  // Resolve Google account for the detail panel
  const user = useUser();
  const accounts = user?.useConnectedAccounts();

  const handleSelectThread = useCallback((thread: GmailThread, accountId: string | null) => {
    setSelectedThread({ thread: { ...thread, isUnread: false }, accountId });

    if (thread.isUnread) {
      const account = accountId
        ? accounts?.find((a) => a.providerAccountId === accountId)
        : accounts?.find((a) => a.provider === "google");

      if (account) {
        markThreadReadMutation.mutate({
          account,
          threadId: thread.threadId,
        });
      }
    }
  }, [accounts, markThreadReadMutation]);

  const handleCloseThread = useCallback(() => {
    setSelectedThread(null);
  }, []);
  const googleAccount = selectedThread?.accountId
    ? accounts?.find((a) => a.providerAccountId === selectedThread.accountId) ?? null
    : selectedThread
      ? accounts?.find((a) => a.provider === "google") ?? null
      : null;

  const { data: threadDetail, isLoading: isDetailLoading } = useGmailThread(
    selectedThread?.thread.threadId ?? null,
    googleAccount ?? null,
  );

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-3 p-4">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-48 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (!sections || sections.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Inbox className="size-10" strokeWidth={1.25} />
        <p className="text-sm">Create your first section to get started</p>
      </div>
    );
  }

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      {/* Sections list */}
      <ResizablePanel defaultSize={selectedThread ? 55 : 100} minSize={30}>
        <div className="h-full overflow-y-auto">
          <div className="mx-auto max-w-5xl space-y-3 p-4">
            {sections.map((section) => {
              const filters = parseFilters(section.filters);
              const isSortAsc = sortState[section.id] ?? false;
              const collapsed =
                collapseState[section.id] ?? section.collapsed;

              return (
                <div key={section.id} id={`section-${section.id}`}>
                  <InboxSection
                    section={{
                      id: section.id,
                      name: section.name,
                      source: section.source as SectionSource,
                      filters: section.filters,
                      collapsed,
                      showBadge: section.showBadge,
                    }}
                    itemCount={sectionCounts[section.id] ?? 0}
                    hasMoreItems={sectionHasMore[section.id] ?? false}
                    sortAsc={isSortAsc}
                    onToggleSort={() =>
                      setSortState((prev) => ({
                        ...prev,
                        [section.id]: !prev[section.id],
                      }))
                    }
                    onToggle={() => {
                      const newCollapsed = !collapsed;
                      setCollapseState((prev) => ({
                        ...prev,
                        [section.id]: newCollapsed,
                      }));
                      updateSectionMutation.mutate({
                        id: section.id,
                        collapsed: newCollapsed,
                      });
                    }}
                    onEdit={() =>
                      setEditingSection({
                        id: section.id,
                        name: section.name,
                        source: section.source as SectionSource,
                        filters: section.filters,
                        repos: section.repos,
                        accountId: section.accountId,
                        showBadge: section.showBadge,
                      })
                    }
                  >
                    {section.source === "github_pr" || section.source === "github_issue" ? (
                      <GitHubTable
                        source={section.source}
                        sectionId={section.id}
                        filters={filters}
                        repos={parseJson<string[]>(section.repos, [])}
                        accountId={section.accountId}
                        sortAsc={isSortAsc}
                        onCountChange={(count) => handleCountChange(section.id, count)}
                      />
                    ) : (
                      <GmailMailView
                        sectionId={section.id}
                        filters={filters}
                        accountId={section.accountId}
                        sortAsc={isSortAsc}
                        onCountChange={(count, hasMore) => handleCountChange(section.id, count, hasMore)}
                        selectedThreadId={selectedThread?.thread.threadId}
                        onSelectThread={handleSelectThread}
                      />
                    )}
                  </InboxSection>
                </div>
              );
            })}
          </div>

          {/* Section editor dialog */}
          <SectionBuilder
            open={editingSection !== null}
            onOpenChange={(open) => {
              if (!open) setEditingSection(null);
            }}
            section={editingSection ?? undefined}
          />
        </div>
      </ResizablePanel>

      {/* Detail panel — shown when a thread is selected */}
      {selectedThread && (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={45} minSize={30}>
            <GmailThreadDetail
              key={selectedThread.thread.threadId}
              thread={selectedThread.thread}
              detail={threadDetail}
              isLoading={isDetailLoading}
              googleAccount={googleAccount ?? null}
              onClose={handleCloseThread}
            />
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
}
