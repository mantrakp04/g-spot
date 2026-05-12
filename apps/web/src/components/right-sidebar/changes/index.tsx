import { useQueryClient } from "@tanstack/react-query";
import { TooltipProvider } from "@g-spot/ui/components/tooltip";
import { GitBranch, Minus, Plus, Undo2 } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useConfirmDialog } from "@/contexts/confirm-dialog-context";
import { gitKeys } from "@/lib/query-keys";
import type { DiffMode } from "@/lib/tabs-store";

import { ActionButton } from "./action-button";
import { CommitBox } from "./commit-box";
import { HeaderToolbar } from "./header-toolbar";
import { ResourceGroup } from "./resource-group";
import { ResourceTree } from "./resource-tree";
import { StatusBar } from "./status-bar";
import {
  type GroupId,
  useExpandedGroups,
  useSelection,
  useViewMode,
} from "./use-changes";
import {
  useChangesQuery,
  useCommitDraftQuery,
  useCurrentBranchQuery,
  useRepoStateQuery,
  useStashListQuery,
} from "./use-changes-data";
import { type ChangeEntry, useGitMutations } from "./use-git-mutations";

type ChangeClickOpts = { openFile?: boolean };

type Props = {
  projectId: string;
  onChangeClick: (path: string, mode: DiffMode, opts?: ChangeClickOpts) => void;
};

const GROUP_DIFF_MODE: Record<GroupId, DiffMode> = {
  merge: "uncommitted",
  staged: "staged",
  changes: "unstaged",
};

const GROUP_TITLES: Record<GroupId, string> = {
  merge: "Merge Changes",
  staged: "Staged Changes",
  changes: "Changes",
};

const GROUP_ORDER: GroupId[] = ["merge", "staged", "changes"];

function classifyGroups(changes: ChangeEntry[]): Record<GroupId, ChangeEntry[]> {
  const merge: ChangeEntry[] = [];
  const staged: ChangeEntry[] = [];
  const changesG: ChangeEntry[] = [];

  for (const c of changes) {
    const conflicted =
      c.unstaged === "conflicted" || c.staged === "conflicted";
    if (conflicted) {
      merge.push(c);
      continue;
    }
    const hasStaged = c.staged !== "unknown" && c.staged !== "ignored";
    if (hasStaged) staged.push(c);

    if (c.unstaged !== "unknown" && c.unstaged !== "ignored") {
      changesG.push(c);
    }
  }
  return { merge, staged, changes: changesG };
}

export function ChangesPanel({ projectId, onChangeClick }: Props) {
  const queryClient = useQueryClient();
  const confirm = useConfirmDialog();

  const changesQuery = useChangesQuery(projectId);
  const repoState = useRepoStateQuery(projectId);
  const branch = useCurrentBranchQuery(projectId);
  const stashes = useStashListQuery(projectId);
  const draft = useCommitDraftQuery(projectId);

  const mutations = useGitMutations(projectId);
  const [viewMode] = useViewMode();
  const [expanded, setExpanded] = useExpandedGroups();
  const [selection, setSelection] = useSelection();

  const [message, setMessage] = useState("");
  const seededDraftRef = useRef(false);
  const draftSavedValueRef = useRef<string>("");
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Seed message from server-side draft (once).
  useEffect(() => {
    if (seededDraftRef.current) return;
    if (draft.data) {
      const initial = draft.data.draft ?? "";
      if (initial) setMessage(initial);
      draftSavedValueRef.current = initial;
      seededDraftRef.current = true;
    }
  }, [draft.data]);

  // Debounced draft auto-save.
  useEffect(() => {
    if (!seededDraftRef.current) return;
    if (message === draftSavedValueRef.current) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      draftSavedValueRef.current = message;
      mutations.setDraft.mutate(message);
    }, 500);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [message, mutations.setDraft]);

  const groups = useMemo(
    () => classifyGroups(changesQuery.data?.changes ?? []),
    [changesQuery.data],
  );

  // Drop stale selection entries when their group empties.
  useEffect(() => {
    setSelection((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const g of GROUP_ORDER) {
        const groupPaths = new Set(groups[g].map((c) => c.path));
        const filtered = prev[g].filter((p) => groupPaths.has(p));
        if (filtered.length !== prev[g].length) {
          next[g] = filtered;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [groups, setSelection]);

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: gitKeys.changes(projectId) });
    queryClient.invalidateQueries({ queryKey: gitKeys.repoState(projectId) });
    queryClient.invalidateQueries({ queryKey: gitKeys.currentBranch(projectId) });
    queryClient.invalidateQueries({ queryKey: gitKeys.stashList(projectId) });
  }, [projectId, queryClient]);

  const handleCommit = useCallback(() => {
    const trimmed = message.trim();
    if (!trimmed || !repoState.data?.hasStaged) return;
    mutations.commit.mutate(
      { message: trimmed },
      {
        onSuccess: () => {
          setMessage("");
          draftSavedValueRef.current = "";
          mutations.setDraft.mutate("");
        },
      },
    );
  }, [message, mutations, repoState.data?.hasStaged]);

  const lastClickedRef = useRef<Record<GroupId, string | null>>({
    merge: null,
    staged: null,
    changes: null,
  });

  const handleRowClick = useCallback(
    (group: GroupId, path: string, e: MouseEvent) => {
      const additive = e.metaKey || e.ctrlKey;
      const range = e.shiftKey;
      const groupPaths = groups[group].map((c) => c.path);

      if (additive) {
        e.preventDefault();
        setSelection((prev) => {
          const set = new Set(prev[group]);
          if (set.has(path)) set.delete(path);
          else set.add(path);
          return { ...prev, [group]: [...set] };
        });
        lastClickedRef.current[group] = path;
        return;
      }
      if (range && lastClickedRef.current[group]) {
        e.preventDefault();
        const a = groupPaths.indexOf(lastClickedRef.current[group]!);
        const b = groupPaths.indexOf(path);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          const range = groupPaths.slice(lo, hi + 1);
          setSelection((prev) => ({ ...prev, [group]: range }));
        }
        return;
      }

      // Plain click — select single + open diff.
      setSelection((prev) => ({ ...prev, [group]: [path] }));
      lastClickedRef.current[group] = path;
      onChangeClick(path, GROUP_DIFF_MODE[group]);
    },
    [groups, onChangeClick, setSelection],
  );

  const handleRowDoubleClick = useCallback(
    (group: GroupId, path: string) => {
      onChangeClick(path, GROUP_DIFF_MODE[group], { openFile: true });
    },
    [onChangeClick],
  );

  const handleOpenFile = useCallback(
    (path: string) => {
      onChangeClick(path, "uncommitted", { openFile: true });
    },
    [onChangeClick],
  );

  const handleOpenDiff = useCallback(
    (path: string, mode: DiffMode) => {
      onChangeClick(path, mode);
    },
    [onChangeClick],
  );

  const handlePanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Avoid hijacking input/textarea.
    const target = e.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    ) {
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      // Select all in any group with current selection.
      const group = GROUP_ORDER.find((g) => selection[g].length > 0) ?? null;
      if (group) {
        e.preventDefault();
        setSelection((prev) => ({
          ...prev,
          [group]: groups[group].map((c) => c.path),
        }));
      }
      return;
    }

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const flat: Array<{ group: GroupId; path: string }> = [];
      for (const g of GROUP_ORDER) {
        if (!expanded[g]) continue;
        for (const c of groups[g]) flat.push({ group: g, path: c.path });
      }
      if (flat.length === 0) return;
      // Find the currently active row from any group's last selected.
      let idx = -1;
      for (let i = 0; i < flat.length; i++) {
        const g = flat[i]!.group;
        if (selection[g].includes(flat[i]!.path)) idx = i;
      }
      const next = idx === -1
        ? 0
        : Math.max(0, Math.min(flat.length - 1, idx + (e.key === "ArrowDown" ? 1 : -1)));
      const target = flat[next]!;
      setSelection((prev) => {
        const cleared: Record<GroupId, string[]> = {
          merge: [],
          staged: [],
          changes: [],
        };
        return { ...cleared, [target.group]: [target.path] };
      });
      lastClickedRef.current[target.group] = target.path;
      return;
    }

    if (e.key === "Enter") {
      const active = activeRow(groups, selection);
      if (active) {
        e.preventDefault();
        onChangeClick(active.path, GROUP_DIFF_MODE[active.group]);
      }
      return;
    }

    if (e.key === " ") {
      const active = activeRow(groups, selection);
      if (active) {
        e.preventDefault();
        const paths = selection[active.group].length > 1
          ? selection[active.group]
          : [active.path];
        if (active.group === "staged") {
          mutations.unstage.mutate({ paths });
        } else {
          mutations.stage.mutate({ paths });
        }
      }
    }
  };

  const totalChanges =
    groups.merge.length + groups.staged.length + groups.changes.length;

  // Detect "not a git repo" — repoState query errors out in that case.
  const notARepo =
    repoState.isError && totalChanges === 0 && !changesQuery.data?.changes.length;

  const toggleGroup = (g: GroupId) =>
    setExpanded((prev) => ({ ...prev, [g]: !prev[g] }));

  const clearSelection = (g: GroupId) =>
    setSelection((prev) => ({ ...prev, [g]: [] }));

  return (
    <TooltipProvider>
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden"
        tabIndex={-1}
        onKeyDown={handlePanelKeyDown}
      >
        <HeaderToolbar
          isFetching={changesQuery.isFetching}
          onRefresh={handleRefresh}
          mutations={mutations}
          stashes={stashes.data?.stashes}
        />

        <div className="min-w-0 border-b border-border p-2">
          <CommitBox
            value={message}
            onChange={setMessage}
            onSubmit={handleCommit}
            branch={branch.data?.branch}
            disabled={mutations.commit.isPending}
          />
          <div className="mt-2">
            <ActionButton
              message={message}
              branch={branch.data}
              repoState={repoState.data}
              mutations={mutations}
              onCommitted={() => {
                setMessage("");
                draftSavedValueRef.current = "";
                mutations.setDraft.mutate("");
              }}
            />
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
          {notARepo ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center text-xs text-muted-foreground">
              <GitBranch className="size-5 opacity-40" />
              <span>Not a git repository</span>
            </div>
          ) : totalChanges === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center text-xs text-muted-foreground">
              <GitBranch className="size-5 opacity-40" />
              <span>No changes</span>
            </div>
          ) : (
            GROUP_ORDER.map((g) => {
              const list = groups[g];
              if (list.length === 0) return null;
              return (
                <ResourceGroup
                  key={g}
                  title={GROUP_TITLES[g]}
                  count={list.length}
                  expanded={expanded[g]}
                  onToggle={() => toggleGroup(g)}
                  actions={groupActions(g, mutations, list, confirm)}
                  selectedCount={selection[g].length}
                  onClearSelection={() => clearSelection(g)}
                  selectionActions={selectionActions(g, selection[g], list, mutations)}
                >
                  <ResourceTree
                    changes={list}
                    group={g}
                    viewMode={viewMode}
                    selection={selection[g]}
                    mutations={mutations}
                    onRowClick={(path, e) => handleRowClick(g, path, e)}
                    onRowDoubleClick={(path) => handleRowDoubleClick(g, path)}
                    onOpenFile={handleOpenFile}
                    onOpenDiff={handleOpenDiff}
                  />
                </ResourceGroup>
              );
            })
          )}
        </div>

        <StatusBar branch={branch.data} stashes={stashes.data?.stashes} />
      </div>
    </TooltipProvider>
  );
}

function activeRow(
  groups: Record<GroupId, ChangeEntry[]>,
  selection: Record<GroupId, string[]>,
): { group: GroupId; path: string } | null {
  for (const g of GROUP_ORDER) {
    const sel = selection[g];
    if (sel.length > 0) {
      const last = sel[sel.length - 1]!;
      if (groups[g].some((c) => c.path === last)) {
        return { group: g, path: last };
      }
    }
  }
  return null;
}

function groupActions(
  group: GroupId,
  mutations: ReturnType<typeof useGitMutations>,
  list: ChangeEntry[],
  confirm: ReturnType<typeof useConfirmDialog>,
) {
  const allPaths = list.map((c) => c.path);
  if (group === "staged") {
    return [
      {
        label: "Unstage All",
        icon: <Minus className="size-3" />,
        onClick: () => mutations.unstageAll.mutate(),
      },
    ];
  }
  if (group === "merge") {
    return [
      {
        label: "Stage All",
        icon: <Plus className="size-3" />,
        onClick: () => mutations.stage.mutate({ paths: allPaths }),
      },
    ];
  }
  // changes (includes untracked)
  return [
    {
      label: "Discard All",
      icon: <Undo2 className="size-3" />,
      destructive: true,
      onClick: async () => {
        const untrackedPaths = list
          .filter((c) => c.unstaged === "untracked")
          .map((c) => c.path);
        const trackedPaths = list
          .filter((c) => c.unstaged !== "untracked")
          .map((c) => c.path);
        const description =
          untrackedPaths.length > 0 && trackedPaths.length > 0
            ? "Tracked changes are reverted; untracked files removed."
            : untrackedPaths.length > 0
              ? "These untracked files will be deleted from disk."
              : "Tracked changes will be reverted.";
        if (
          await confirm({
            title: "Discard all changes?",
            description,
            destructive: true,
          })
        ) {
          if (trackedPaths.length > 0)
            mutations.discard.mutate({ paths: trackedPaths });
          if (untrackedPaths.length > 0)
            mutations.cleanUntracked.mutate({ paths: untrackedPaths });
        }
      },
    },
    {
      label: "Stage All",
      icon: <Plus className="size-3" />,
      onClick: () => mutations.stage.mutate({ paths: allPaths }),
    },
  ];
}

function selectionActions(
  group: GroupId,
  selected: string[],
  list: ChangeEntry[],
  mutations: ReturnType<typeof useGitMutations>,
) {
  if (selected.length === 0) return [];
  const isStaged = group === "staged";
  return [
    {
      label: isStaged ? "Unstage" : "Stage",
      icon: null,
      onClick: () => {
        if (isStaged) mutations.unstage.mutate({ paths: selected });
        else mutations.stage.mutate({ paths: selected });
      },
    },
    ...(isStaged
      ? []
      : [
          {
            label: "Discard",
            icon: null,
            destructive: true,
            onClick: () => {
              const selectedSet = new Set(selected);
              const untrackedPaths: string[] = [];
              const trackedPaths: string[] = [];
              for (const c of list) {
                if (!selectedSet.has(c.path)) continue;
                if (c.unstaged === "untracked") untrackedPaths.push(c.path);
                else trackedPaths.push(c.path);
              }
              if (trackedPaths.length > 0)
                mutations.discard.mutate({ paths: trackedPaths });
              if (untrackedPaths.length > 0)
                mutations.cleanUntracked.mutate({ paths: untrackedPaths });
            },
          },
        ]),
  ];
}
