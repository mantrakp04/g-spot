import { cn } from "@g-spot/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import { type MouseEvent, useState } from "react";
import { FolderIcon, OpenFolderIcon } from "react-files-icons";

import type { DiffMode } from "@/lib/tabs-store";

import { ResourceRow } from "./resource-row";
import type { GroupId, ViewMode } from "./use-changes";
import type { ChangeEntry, GitMutations } from "./use-git-mutations";

type TreeNode = {
  name: string;
  fullPath: string;
  kind: "directory" | "file";
  children: TreeNode[];
  change?: ChangeEntry;
};

function buildTree(changes: ChangeEntry[], compact: boolean): TreeNode {
  const root: TreeNode = {
    name: "",
    fullPath: "",
    kind: "directory",
    children: [],
  };
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
          fullPath: acc,
          kind: isLast ? "file" : "directory",
          children: [],
          change: isLast ? change : undefined,
        };
        cursor.children.push(next);
      }
      cursor = next;
    });
  }
  const sortRecursive = (node: TreeNode) => {
    node.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortRecursive);
  };
  sortRecursive(root);
  if (compact) compactFolders(root);
  return root;
}

function compactFolders(node: TreeNode): void {
  for (const child of node.children) {
    if (child.kind !== "directory") continue;
    while (
      child.children.length === 1 &&
      child.children[0]!.kind === "directory"
    ) {
      const only = child.children[0]!;
      child.name = `${child.name}/${only.name}`;
      child.fullPath = only.fullPath;
      child.children = only.children;
    }
    compactFolders(child);
  }
}

type Props = {
  changes: ChangeEntry[];
  group: GroupId;
  viewMode: ViewMode;
  selection: string[];
  mutations: GitMutations;
  onRowClick: (path: string, e: MouseEvent) => void;
  onRowDoubleClick: (path: string) => void;
  onOpenFile: (path: string) => void;
  onOpenDiff: (path: string, mode: DiffMode) => void;
};

export function ResourceTree({
  changes,
  group,
  viewMode,
  selection,
  mutations,
  onRowClick,
  onRowDoubleClick,
  onOpenFile,
  onOpenDiff,
}: Props) {
  if (viewMode === "list") {
    return (
      <>
        {changes.map((change) => (
          <ResourceRow
            key={`${group}:${change.path}`}
            change={change}
            group={group}
            selected={selection.includes(change.path)}
            selection={selection}
            paths={[change.path]}
            mutations={mutations}
            onClick={(e) => onRowClick(change.path, e)}
            onDoubleClick={() => onRowDoubleClick(change.path)}
            onOpenFile={onOpenFile}
            onOpenDiff={onOpenDiff}
          />
        ))}
      </>
    );
  }

  const tree = buildTree(changes, viewMode === "compact");

  return (
    <>
      {tree.children.map((child) => (
        <TreeNodeView
          key={child.fullPath}
          node={child}
          depth={0}
          group={group}
          selection={selection}
          mutations={mutations}
          onRowClick={onRowClick}
          onRowDoubleClick={onRowDoubleClick}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
        />
      ))}
    </>
  );
}

type NodeViewProps = {
  node: TreeNode;
  depth: number;
  group: GroupId;
  selection: string[];
  mutations: GitMutations;
  onRowClick: (path: string, e: MouseEvent) => void;
  onRowDoubleClick: (path: string) => void;
  onOpenFile: (path: string) => void;
  onOpenDiff: (path: string, mode: DiffMode) => void;
};

function TreeNodeView({
  node,
  depth,
  group,
  selection,
  mutations,
  onRowClick,
  onRowDoubleClick,
  onOpenFile,
  onOpenDiff,
}: NodeViewProps) {
  const [open, setOpen] = useState(true);

  if (node.kind === "file" && node.change) {
    return (
      <ResourceRow
        change={node.change}
        group={group}
        selected={selection.includes(node.change.path)}
        selection={selection}
        paths={[node.change.path]}
        showFullPath
        displayName={node.name}
        depth={depth}
        mutations={mutations}
        onClick={(e) => onRowClick(node.change!.path, e)}
        onDoubleClick={() => onRowDoubleClick(node.change!.path)}
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
      />
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-6 min-w-0 items-center gap-1.5 px-2 text-left text-xs hover:bg-muted/50"
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
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
          <TreeNodeView
            key={child.fullPath}
            node={child}
            depth={depth + 1}
            group={group}
            selection={selection}
            mutations={mutations}
            onRowClick={onRowClick}
            onRowDoubleClick={onRowDoubleClick}
            onOpenFile={onOpenFile}
            onOpenDiff={onOpenDiff}
          />
        ))}
    </>
  );
}
