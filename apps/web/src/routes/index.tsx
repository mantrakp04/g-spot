import { useState, useCallback } from "react";

import type { FilterCondition } from "@g-spot/api/schemas/section-filters";
import type { SectionSource } from "@g-spot/api/schemas/section-filters";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Inbox } from "lucide-react";

import { GitHubPRTable } from "@/components/inbox/github-pr-table";
import { GmailMailView } from "@/components/inbox/gmail-mail-view";
import { InboxSection } from "@/components/inbox/inbox-section";
import { SectionBuilder } from "@/components/inbox/section-builder";
import { trpc, trpcClient } from "@/utils/trpc";

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

function InboxPage() {
  const { data: sections, isLoading } = useQuery(
    trpc.sections.list.queryOptions(),
  );

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

  // Per-section item counts from data queries
  const [sectionCounts, setSectionCounts] = useState<Record<string, number>>({});
  const [sectionHasMore, setSectionHasMore] = useState<Record<string, boolean>>({});

  const handleCountChange = useCallback((sectionId: string, count: number, hasMore?: boolean) => {
    setSectionCounts((prev) => {
      if (prev[sectionId] === count) return prev;
      return { ...prev, [sectionId]: count };
    });
    if (hasMore !== undefined) {
      setSectionHasMore((prev) => {
        if (prev[sectionId] === hasMore) return prev;
        return { ...prev, [sectionId]: hasMore };
      });
    }
  }, []);

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
                  // Fire-and-forget DB persist
                  trpcClient.sections.update.mutate({
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
                {section.source === "github_pr" ? (
                  <GitHubPRTable
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
  );
}
