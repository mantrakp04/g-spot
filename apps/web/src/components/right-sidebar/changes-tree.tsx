import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@g-spot/ui/components/select";
import { cn } from "@g-spot/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, RefreshCw } from "lucide-react";
import {
  FileIcon,
  FolderIcon,
  OpenFolderIcon,
} from "react-files-icons";
import { useMemo, useState } from "react";

import { gitKeys } from "@/lib/query-keys";
import type { DiffMode } from "@/lib/tabs-store";
import { trpcClient } from "@/utils/trpc";

type ChangesTreeProps = {
  projectId: string;
  onChangeClick: (path: string, mode: DiffMode) => void;
};

const MODE_LABEL: Record<DiffMode, string> = {
  uncommitted: "Uncommitted",
  staged: "Staged",
  unstaged: "Unstaged",
};

type ChangeEntry = Awaited<
  ReturnType<typeof trpcClient.git.changes.query>
>["changes"][number];

const ZERO_STAT = { additions: 0, deletions: 0 } as const;

function statsFor(change: ChangeEntry, mode: DiffMode) {
  return change.stats?.[mode] ?? ZERO_STAT;
}

type TreeNode = {
  name: string;
  path: string;
  kind: "directory" | "file";
  children: TreeNode[];
  change?: ChangeEntry;
};

function buildTree(changes: ChangeEntry[]): TreeNode {
  const root: TreeNode = { name: "", path: "", kind: "directory", children: [] };
  for (const change of changes) {
    const segments = change.path.split("/");
    let cursor = root;
    let acc = "";
    segments.forEach((segment, i) => {
      acc = acc ? `${acc}/${segment}` : segment;
      const isLast = i === segments.length - 1;
      let next = cursor.children.find((c) => c.name === segment);
      if (!next) {
        next = {
          name: segment,
          path: acc,
          kind: isLast ? "file" : "directory",
          children: [],
          change: isLast ? change : undefined,
        };
        cursor.children.push(next);
      }
      cursor = next;
    });
  }
  // Sort: directories first, then files.
  const sortRecursive = (node: TreeNode) => {
    node.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortRecursive);
  };
  sortRecursive(root);
  return root;
}

const STATUS_BADGE: Record<
  string,
  { label: string; className: string; title: string }
> = {
  modified: {
    label: "M",
    className: "text-yellow-500",
    title: "Modified",
  },
  added: { label: "A", className: "text-emerald-500", title: "Added" },
  deleted: { label: "D", className: "text-red-500", title: "Deleted" },
  renamed: { label: "R", className: "text-blue-400", title: "Renamed" },
  copied: { label: "C", className: "text-blue-400", title: "Copied" },
  untracked: { label: "U", className: "text-emerald-400", title: "Untracked" },
  conflicted: { label: "!", className: "text-red-400", title: "Conflicted" },
  typeChanged: {
    label: "T",
    className: "text-yellow-500",
    title: "Type changed",
  },
};

function badgeFor(change: ChangeEntry) {
  // Prefer the unstaged status, fall back to staged.
  const code =
    change.unstaged !== "unknown" && change.unstaged !== "ignored"
      ? change.unstaged
      : change.staged;
  return STATUS_BADGE[code] ?? null;
}

function isInMode(
  change: ChangeEntry,
  mode: DiffMode,
): boolean {
  const hasStaged =
    change.staged !== "unknown" && change.staged !== "ignored";
  const hasUnstaged =
    change.unstaged !== "unknown" && change.unstaged !== "ignored";
  if (mode === "staged") return hasStaged;
  if (mode === "unstaged") return hasUnstaged;
  // uncommitted = anything that differs from HEAD
  return hasStaged || hasUnstaged;
}

export function ChangesTree({ projectId, onChangeClick }: ChangesTreeProps) {
  const [mode, setMode] = useState<DiffMode>("uncommitted");

  const changesQuery = useQuery({
    queryKey: gitKeys.changes(projectId),
    queryFn: () => trpcClient.git.changes.query({ projectId }),
    refetchInterval: 5_000,
  });

  const filtered = useMemo(
    () =>
      changesQuery.data?.changes.filter((c) => isInMode(c, mode)) ?? [],
    [changesQuery.data, mode],
  );

  const tree = useMemo(() => buildTree(filtered), [filtered]);
  const total = filtered.length;
  const totals = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const c of filtered) {
      const stats = statsFor(c, mode);
      additions += stats.additions;
      deletions += stats.deletions;
    }
    return { additions, deletions };
  }, [filtered, mode]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-1 text-[11px] text-muted-foreground">
        <Select value={mode} onValueChange={(v) => setMode(v as DiffMode)}>
          <SelectTrigger size="sm" className="flex-1 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(MODE_LABEL) as DiffMode[]).map((m) => (
              <SelectItem key={m} value={m} className="text-xs">
                {MODE_LABEL[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DiffStat additions={totals.additions} deletions={totals.deletions} />
        <button
          type="button"
          onClick={() => changesQuery.refetch()}
          className="grid size-6 shrink-0 place-items-center rounded hover:bg-muted"
          aria-label="Refresh changes"
        >
          <RefreshCw
            className={cn(
              "size-3",
              changesQuery.isFetching && "animate-spin",
            )}
          />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1 text-xs">
        {total > 0 ? (
          tree.children.map((child) => (
            <ChangeNode
              key={child.path}
              node={child}
              depth={0}
              mode={mode}
              onChangeClick={(path) => onChangeClick(path, mode)}
            />
          ))
        ) : changesQuery.isLoading ? (
          <p className="px-3 py-4 text-center text-muted-foreground">Loading…</p>
        ) : (
          <p className="px-3 py-4 text-center text-muted-foreground">
            No {MODE_LABEL[mode].toLowerCase()} changes
          </p>
        )}
      </div>
    </div>
  );
}

type ChangeNodeProps = {
  node: TreeNode;
  depth: number;
  mode: DiffMode;
  onChangeClick: (path: string) => void;
};

function ChangeNode({ node, depth, mode, onChangeClick }: ChangeNodeProps) {
  const [open, setOpen] = useState(true);
  const padLeft = `${0.5 + depth * 0.75}rem`;

  if (node.kind === "file") {
    const badge = node.change ? badgeFor(node.change) : null;
    const stats = node.change ? statsFor(node.change, mode) : null;
    return (
      <button
        type="button"
        onClick={() => onChangeClick(node.path)}
        className="flex h-6 min-w-0 items-center gap-1.5 px-2 text-left hover:bg-muted/50"
        style={{ paddingLeft: padLeft }}
      >
        <span className="size-3 shrink-0" />
        <FileIcon name={node.name} className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        {stats && (
          <DiffStat additions={stats.additions} deletions={stats.deletions} />
        )}
        {badge && (
          <span
            className={cn("font-mono text-[10px] font-bold", badge.className)}
            title={badge.title}
          >
            {badge.label}
          </span>
        )}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-6 min-w-0 items-center gap-1.5 px-2 text-left hover:bg-muted/50"
        style={{ paddingLeft: padLeft }}
      >
        <ChevronRight
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        {open ? (
          <OpenFolderIcon name={node.name} className="size-3.5 shrink-0" />
        ) : (
          <FolderIcon name={node.name} className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      </button>
      {open &&
        node.children.map((child) => (
          <ChangeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            mode={mode}
            onChangeClick={onChangeClick}
          />
        ))}
    </>
  );
}

function DiffStat({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  if (additions === 0 && deletions === 0) return null;
  return (
    <span className="shrink-0 font-mono text-[10px] tabular-nums">
      {additions > 0 && (
        <span className="text-emerald-500">+{additions}</span>
      )}
      {additions > 0 && deletions > 0 && " "}
      {deletions > 0 && <span className="text-red-500">-{deletions}</span>}
    </span>
  );
}
