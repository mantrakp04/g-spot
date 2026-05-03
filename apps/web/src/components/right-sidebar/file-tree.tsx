import { cn } from "@g-spot/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, File, Folder } from "lucide-react";
import { type ReactNode, useState } from "react";

import { fsKeys } from "@/lib/query-keys";
import { trpcClient } from "@/utils/trpc";

type FileTreeProps = {
  projectId: string;
  onFileClick: (path: string) => void;
  /** Optional renderer for trailing badges/icons on files (e.g. status). */
  renderFileSuffix?: (path: string) => ReactNode;
};

/**
 * Lazy-loaded directory tree. Each folder fetches its own children on first
 * expand. Reused by the All Files tab.
 */
export function FileTree({
  projectId,
  onFileClick,
  renderFileSuffix,
}: FileTreeProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1 text-xs">
      <DirectoryNode
        projectId={projectId}
        path=""
        depth={0}
        defaultOpen
        onFileClick={onFileClick}
        renderFileSuffix={renderFileSuffix}
      />
    </div>
  );
}

type DirectoryNodeProps = {
  projectId: string;
  path: string;
  depth: number;
  defaultOpen?: boolean;
  onFileClick: (path: string) => void;
  renderFileSuffix?: (path: string) => ReactNode;
};

function DirectoryNode({
  projectId,
  path,
  depth,
  defaultOpen = false,
  onFileClick,
  renderFileSuffix,
}: DirectoryNodeProps) {
  const [open, setOpen] = useState(defaultOpen);
  const name = path === "" ? "" : path.split("/").pop()!;

  const childrenQuery = useQuery({
    queryKey: fsKeys.list(projectId, path),
    queryFn: () => trpcClient.fs.list.query({ projectId, path }),
    enabled: open,
    staleTime: 10_000,
  });

  return (
    <>
      {path !== "" && (
        <TreeRow
          depth={depth}
          onClick={() => setOpen((v) => !v)}
          icon={
            <>
              <ChevronRight
                className={cn(
                  "size-3 shrink-0 text-muted-foreground transition-transform",
                  open && "rotate-90",
                )}
              />
              <Folder className="size-3.5 shrink-0 text-muted-foreground" />
            </>
          }
          label={name}
        />
      )}
      {open && childrenQuery.data && (
        <>
          {childrenQuery.data.map((entry) =>
            entry.kind === "directory" ? (
              <DirectoryNode
                key={entry.path}
                projectId={projectId}
                path={entry.path}
                depth={path === "" ? depth : depth + 1}
                onFileClick={onFileClick}
                renderFileSuffix={renderFileSuffix}
              />
            ) : (
              <TreeRow
                key={entry.path}
                depth={path === "" ? depth : depth + 1}
                onClick={() => onFileClick(entry.path)}
                icon={
                  <>
                    <span className="size-3 shrink-0" />
                    <File className="size-3.5 shrink-0 text-muted-foreground/70" />
                  </>
                }
                label={entry.name}
                suffix={renderFileSuffix?.(entry.path)}
              />
            ),
          )}
        </>
      )}
    </>
  );
}

type TreeRowProps = {
  depth: number;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  suffix?: ReactNode;
};

function TreeRow({ depth, onClick, icon, label, suffix }: TreeRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-6 min-w-0 items-center gap-1.5 px-2 text-left",
        "hover:bg-muted/50",
      )}
      style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {suffix && <span className="shrink-0">{suffix}</span>}
    </button>
  );
}
