import { useState, useCallback, useEffect, useRef, useMemo, useTransition, startTransition as reactStartTransition, memo, type Dispatch, type SetStateAction } from "react";

import type { FilterRule, SectionSource, ColumnConfig } from "@g-spot/types/filters";
import { normalizeFilterRule } from "@g-spot/types/filters";
import { Button, buttonVariants } from "@g-spot/ui/components/button";
import { Skeleton } from "@g-spot/ui/components/skeleton";
import type { OAuthConnection } from "@stackframe/react";
import { useUser } from "@stackframe/react";
import { useHotkeys } from "@tanstack/react-hotkeys";
import { useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Bot,
  Inbox,
  NotebookText,
  PanelsTopLeft,
  PlugZap,
  Sparkles,
} from "lucide-react";

import { SectionsSidebar } from "@/components/sections/sections-sidebar";
import { AppLayout } from "@/components/shell/app-layout";
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
import { useEmailDrawerWidth } from "@/lib/inbox/inbox-preferences";
import { gmailKeys, githubKeys } from "@/lib/query-keys";

type InboxSearch = {
  gmailThreadId?: string;
  providerAccountId?: string;
  q?: string;
};

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): InboxSearch => ({
    gmailThreadId: typeof search.gmailThreadId === "string" ? search.gmailThreadId : undefined,
    providerAccountId: typeof search.providerAccountId === "string" ? search.providerAccountId : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  component: InboxPage,
});

function parseFilters(filtersJson: string): FilterRule {
  try {
    return normalizeFilterRule(JSON.parse(filtersJson));
  } catch {
    return normalizeFilterRule(null);
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
  threads: GmailThread[];
} | null;

function dedupeThreadsByThreadId(threads: GmailThread[]): GmailThread[] {
  const seen = new Set<string>();
  const uniqueThreads: GmailThread[] = [];

  for (const thread of threads) {
    if (seen.has(thread.threadId)) continue;
    seen.add(thread.threadId);
    uniqueThreads.push(thread);
  }

  return uniqueThreads;
}

type SectionRowProps = {
  section: NonNullable<ReturnType<typeof useSections>["data"]>[number];
  collapsed: boolean;
  sortAsc: boolean;
  itemCount: number;
  countTotalPending: boolean;
  isRefreshing: boolean;
  selectedThreadId: string | null;
  onToggle: Dispatch<SetStateAction<Record<string, boolean>>>;
  onToggleSort: Dispatch<SetStateAction<Record<string, boolean>>>;
  onRefresh: (sectionId: string, source: string) => void;
  onEdit: (section: {
    id: string;
    name: string;
    source: SectionSource;
    filters: string;
    repos: string;
    columns: string;
    accountId: string | null;
    showBadge: boolean;
  }) => void;
  onCountChange: (sectionId: string, count: number, countTotalPending?: boolean) => void;
  onSelectThread: (thread: GmailThread, accountId: string | null, threads: GmailThread[]) => void;
  accounts: OAuthConnection[] | undefined;
};

const SectionRow = memo(function SectionRow({
  section,
  collapsed,
  sortAsc,
  itemCount,
  countTotalPending,
  isRefreshing,
  selectedThreadId,
  onToggle,
  onToggleSort,
  onRefresh,
  onEdit,
  onCountChange,
  onSelectThread,
  accounts,
}: SectionRowProps) {
  const filters = useMemo(() => parseFilters(section.filters), [section.filters]);
  const columns = useMemo(() => parseJson<ColumnConfig[]>(section.columns, []), [section.columns]);
  const repos = useMemo(() => parseJson<string[]>(section.repos, []), [section.repos]);
  const updateMutation = useUpdateSectionMutation();
  const [, startTransition] = useTransition();

  return (
    <div id={`section-${section.id}`}>
      <InboxSection
        section={{
          id: section.id,
          name: section.name,
          source: section.source as SectionSource,
          filters: section.filters,
          collapsed,
          showBadge: section.showBadge,
        }}
        itemCount={itemCount}
        countTotalPending={countTotalPending}
        sortAsc={sortAsc}
        onToggleSort={() =>
          onToggleSort((prev) => ({
            ...prev,
            [section.id]: !prev[section.id],
          }))
        }
        onToggle={() => {
          const newCollapsed = !collapsed;
          startTransition(() => {
            onToggle((prev) => ({
              ...prev,
              [section.id]: newCollapsed,
            }));
          });
          setTimeout(() => {
            updateMutation.mutate({
              id: section.id,
              collapsed: newCollapsed,
            });
          }, 0);
        }}
        onRefresh={() => onRefresh(section.id, section.source)}
        isRefreshing={isRefreshing}
        onEdit={() =>
          onEdit({
            id: section.id,
            name: section.name,
            source: section.source as SectionSource,
            filters: section.filters,
            repos: section.repos,
            columns: section.columns,
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
            repos={repos}
            accountId={section.accountId}
            sortAsc={sortAsc}
            onCountChange={(count) => onCountChange(section.id, count)}
            columns={columns}
            accounts={accounts}
          />
        ) : (
          <GmailMailView
            sectionId={section.id}
            filters={filters}
            accountId={section.accountId}
            sortAsc={sortAsc}
            onCountChange={(count, countTotalPending) =>
              onCountChange(section.id, count, countTotalPending)
            }
            selectedThreadId={selectedThreadId}
            onSelectThread={onSelectThread}
            columns={columns}
          />
        )}
      </InboxSection>
    </div>
  );
}, (prev, next) =>
  prev.section === next.section
  && prev.collapsed === next.collapsed
  && prev.sortAsc === next.sortAsc
  && prev.itemCount === next.itemCount
  && prev.countTotalPending === next.countTotalPending
  && prev.isRefreshing === next.isRefreshing
  && prev.selectedThreadId === next.selectedThreadId
  && prev.accounts === next.accounts,
);

function InboxPage() {
  const routeSearch = Route.useSearch();
  const user = useUser();

  return (
    <AppLayout sidebar={<SectionsSidebar />}>
      {user ? (
        <SignedInInboxPage user={user} routeSearch={routeSearch} />
      ) : (
        <InboxPageContent accounts={undefined} routeSearch={routeSearch} />
      )}
    </AppLayout>
  );
}

function SignedInInboxPage({
  user,
  routeSearch,
}: {
  user: { useConnectedAccounts: () => OAuthConnection[] | undefined };
  routeSearch: InboxSearch;
}) {
  const accounts = user.useConnectedAccounts();

  return <InboxPageContent accounts={accounts} routeSearch={routeSearch} />;
}

function InboxPageContent({
  accounts,
  routeSearch,
}: {
  accounts: OAuthConnection[] | undefined;
  routeSearch: InboxSearch;
}) {
  const queryClient = useQueryClient();
  const { data: sections, isLoading } = useSections();
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({});

  const [editingSection, setEditingSection] = useState<{
    id: string;
    name: string;
    source: SectionSource;
    filters: string;
    repos: string;
    columns: string;
    accountId: string | null;
    showBadge: boolean;
  } | null>(null);
  const [isCreatingSection, setIsCreatingSection] = useState(false);

  const [collapseState, setCollapseState] = useState<Record<string, boolean>>({});

  // Per-section sort direction (ascending = oldest first)
  const [sortState, setSortState] = useState<Record<string, boolean>>({});

  // Per-section item counts from data queries (shared with sidebar via context)
  const { counts: sectionCounts, setCount } = useSectionCounts();
  const [sectionCountTotalPending, setSectionCountTotalPending] = useState<
    Record<string, boolean>
  >({});

  const handleCountChange = useCallback(
    (sectionId: string, count: number, countTotalPending?: boolean) => {
      setCount(sectionId, count);
      if (countTotalPending !== undefined) {
        setSectionCountTotalPending((prev) => {
          if (prev[sectionId] === countTotalPending) return prev;
          return { ...prev, [sectionId]: countTotalPending };
        });
      }
    },
    [setCount],
  );

  // Lifted selected thread state for the right detail panel
  const [selectedThread, setSelectedThread] = useState<SelectedThreadState>(null);
  const markThreadReadMutation = useMarkGmailThreadReadMutation();
  const searchedThread = useGmailThread(
    routeSearch.gmailThreadId ?? null,
    routeSearch.providerAccountId ?? null,
  );

  useEffect(() => {
    const detail = searchedThread.data;
    if (!detail || !routeSearch.gmailThreadId || !routeSearch.providerAccountId) return;
    const firstMessage = detail.messages[0];
    setSelectedThread({
      thread: {
        id: detail.id,
        threadId: routeSearch.gmailThreadId,
        subject: detail.subject,
        from: firstMessage?.from ?? { name: "", email: "" },
        snippet: firstMessage?.bodyText?.slice(0, 180) ?? "",
        date: firstMessage?.date ?? "",
        isUnread: false,
        labels: [],
        hasAttachment: false,
        avatarUrl: null,
      },
      accountId: routeSearch.providerAccountId,
      threads: [],
    });
  }, [routeSearch.gmailThreadId, routeSearch.providerAccountId, searchedThread.data]);

  const handleSelectThread = useCallback((thread: GmailThread, accountId: string | null, threads: GmailThread[]) => {
    reactStartTransition(() => {
      setSelectedThread({
        thread: { ...thread, isUnread: false },
        accountId,
        threads: dedupeThreadsByThreadId(threads),
      });
    });

    // Defer mark-read so its optimistic cache update doesn't cause a
    // synchronous re-render of the thread table during the click handler.
    if (thread.isUnread) {
      queueMicrotask(() => {
        const account = accountId
          ? accounts?.find((a) => a.providerAccountId === accountId)
          : accounts?.find((a) => a.provider === "google");

        if (account) {
          markThreadReadMutation.mutate({
            account,
            threadId: thread.threadId,
          });
        }
      });
    }
  }, [accounts, markThreadReadMutation]);

  const handleRefresh = useCallback(async (sectionId: string, source: string) => {
    setRefreshing((prev) => ({ ...prev, [sectionId]: true }));
    try {
      const queryKey = source === "gmail"
        ? gmailKeys.threadsSection(sectionId)
        : source === "github_pr"
          ? githubKeys.prsSection(sectionId)
          : githubKeys.issuesSection(sectionId);
      await queryClient.refetchQueries({ queryKey });
    } finally {
      setRefreshing((prev) => ({ ...prev, [sectionId]: false }));
    }
  }, [queryClient]);

  const handleCloseThread = useCallback(() => {
    reactStartTransition(() => {
      setSelectedThread(null);
    });
  }, []);
  const googleAccount = selectedThread?.accountId
    ? accounts?.find((a) => a.providerAccountId === selectedThread.accountId) ?? null
    : selectedThread
      ? accounts?.find((a) => a.provider === "google") ?? null
      : null;

  // Thread navigation (prev/next)
  const currentIndex = useMemo(() => {
    if (!selectedThread) return -1;
    return selectedThread.threads.findIndex(
      (t) => t.threadId === selectedThread.thread.threadId,
    );
  }, [selectedThread]);

  const hasPrev = currentIndex > 0;
  const hasNext = selectedThread != null && currentIndex < selectedThread.threads.length - 1;

  const handleNavigateThread = useCallback(
    (direction: -1 | 1) => {
      if (!selectedThread) return;
      const nextIdx = currentIndex + direction;
      const nextThread = selectedThread.threads[nextIdx];
      if (!nextThread) return;
      handleSelectThread(nextThread, selectedThread.accountId, selectedThread.threads);
    },
    [selectedThread, currentIndex, handleSelectThread],
  );

  useHotkeys(
    [
      {
        hotkey: "J",
        callback: () => handleNavigateThread(1),
        options: { meta: { name: "Next thread" } },
      },
      {
        hotkey: "K",
        callback: () => handleNavigateThread(-1),
        options: { meta: { name: "Previous thread" } },
      },
    ],
    { enabled: selectedThread != null },
  );

  const { data: threadDetail, isLoading: isDetailLoading } = useGmailThread(
    selectedThread?.thread.threadId ?? null,
    selectedThread?.accountId ?? null,
  );

  const [drawerWidth, setDrawerWidth] = useEmailDrawerWidth();
  const drawerWidthRef = useRef(drawerWidth);
  drawerWidthRef.current = drawerWidth;

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startWidth = drawerWidthRef.current;

      const onPointerMove = (ev: PointerEvent) => {
        const deltaVw = ((startX - ev.clientX) / window.innerWidth) * 100;
        setDrawerWidth(Math.min(80, Math.max(25, startWidth + deltaVw)));
      };
      const onPointerUp = (ev: PointerEvent) => {
        el.releasePointerCapture(ev.pointerId);
        el.removeEventListener("pointermove", onPointerMove);
        el.removeEventListener("pointerup", onPointerUp);
      };

      el.addEventListener("pointermove", onPointerMove);
      el.addEventListener("pointerup", onPointerUp);
    },
    [],
  );

  // Keep stale content ref so the drawer doesn't flash empty during close animation
  const drawerThreadRef = useRef(selectedThread);
  if (selectedThread) drawerThreadRef.current = selectedThread;

  useEffect(() => {
    if (!selectedThread) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Element
        && !event.target.closest("[data-email-drawer-content]")
      ) {
        handleCloseThread();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, { capture: true });
    };
  }, [handleCloseThread, selectedThread]);

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
      <div className="h-full overflow-y-auto bg-background">
        <div className="mx-auto flex min-h-full max-w-6xl flex-col px-6 py-10">
          <div className="grid flex-1 items-center gap-10 lg:grid-cols-[minmax(0,1fr)_24rem]">
            <section className="max-w-3xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border bg-muted/35 px-3 py-1 text-xs font-medium text-muted-foreground">
                <Sparkles className="size-3.5 text-primary" />
                Inbox, notes, and Pi — running on your machine
              </div>
              <h1 className="text-balance text-4xl font-semibold tracking-tight text-foreground md:text-6xl">
                One workspace for the stuff that needs action.
              </h1>
              <p className="mt-5 max-w-2xl text-pretty text-base leading-7 text-muted-foreground md:text-lg">
                Slice Gmail, PRs, and issues into sections you actually read.
                Keep linked notes beside the work. Hand the repetitive parts to
                Pi.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button onClick={() => setIsCreatingSection(true)}>
                  <PanelsTopLeft className="size-4" />
                  Create section
                </Button>
                <Link
                  to="/notes"
                  className={buttonVariants({ variant: "outline" })}
                >
                  <NotebookText className="size-4" />
                  Open notes
                </Link>
                <Link
                  to="/settings/connections"
                  className={buttonVariants({ variant: "ghost" })}
                >
                  <PlugZap className="size-4" />
                  Connect accounts
                </Link>
              </div>
            </section>

            <section className="grid gap-3">
              {[
                {
                  icon: Inbox,
                  title: "Sections, not folders",
                  text: "Filter Gmail threads, pull requests, and issues into focused views. Sort, badge, and triage from one list.",
                },
                {
                  icon: Bot,
                  title: "Pi builds your filters",
                  text: "Describe the slice in plain English. Pi assembles the filter rules, accounts, and columns for you.",
                },
                {
                  icon: NotebookText,
                  title: "Notes that link back",
                  text: "Markdown editor with wikilinks, tags, math, Mermaid diagrams, and daily notes — all stored locally.",
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <article
                    key={item.title}
                    className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Icon className="size-4" />
                      </div>
                      <div>
                        <h2 className="text-sm font-semibold">{item.title}</h2>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                          {item.text}
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
          </div>
        </div>
        <SectionBuilder
          open={isCreatingSection}
          onOpenChange={setIsCreatingSection}
        />
      </div>
    );
  }

  return (
    <>
      {/* Sections list */}
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-3 p-4">
          {sections.map((section) => (
            <SectionRow
              key={section.id}
              section={section}
              collapsed={collapseState[section.id] ?? section.collapsed}
              sortAsc={sortState[section.id] ?? false}
              itemCount={sectionCounts[section.id] ?? 0}
              countTotalPending={sectionCountTotalPending[section.id] ?? false}
              isRefreshing={refreshing[section.id] ?? false}
              selectedThreadId={
                section.source === "gmail"
                  ? (selectedThread?.thread.threadId ?? null)
                  : null
              }
              onToggle={setCollapseState}
              onToggleSort={setSortState}
              onRefresh={handleRefresh}
              onEdit={setEditingSection}
              onCountChange={handleCountChange}
              onSelectThread={handleSelectThread}
              accounts={accounts}
            />
          ))}
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

      {/* Email detail drawer */}
      {selectedThread && (
        <aside
          aria-describedby="email-drawer-description"
          aria-labelledby="email-drawer-title"
          aria-modal="false"
          data-email-drawer-content
          role="dialog"
          style={{ width: `${drawerWidth}vw`, maxWidth: "none" }}
          className="fixed inset-y-0 right-0 z-50 flex h-full flex-col bg-transparent p-0 text-xs/relaxed text-popover-foreground outline-none before:absolute before:inset-0 before:-z-10 before:rounded-xl before:border before:border-border before:bg-popover"
        >
          <h2 id="email-drawer-title" className="sr-only">
            {(selectedThread ?? drawerThreadRef.current)?.thread.subject ?? "Email thread"}
          </h2>
          <p id="email-drawer-description" className="sr-only">
            Read an email thread, navigate between nearby threads, and take mailbox actions.
          </p>
          {/* Resize handle */}
          <div
            onPointerDown={handleResizePointerDown}
            className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize transition-colors hover:bg-border active:bg-border"
          />
          {(selectedThread ?? drawerThreadRef.current) && (
            <GmailThreadDetail
              key={(selectedThread ?? drawerThreadRef.current)!.thread.threadId}
              thread={(selectedThread ?? drawerThreadRef.current)!.thread}
              detail={threadDetail ?? undefined}
              isLoading={isDetailLoading}
              googleAccount={googleAccount ?? null}
              accounts={accounts}
              onClose={handleCloseThread}
              hasPrev={hasPrev}
              hasNext={hasNext}
              onPrev={() => handleNavigateThread(-1)}
              onNext={() => handleNavigateThread(1)}
            />
          )}
        </aside>
      )}
    </>
  );
}
