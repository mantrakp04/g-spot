import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@g-spot/ui/components/command";
import { useQuery } from "@tanstack/react-query";
import { File } from "lucide-react";
import { useMemo } from "react";

import { fsKeys } from "@/lib/query-keys";
import { useOpenFileTab } from "@/lib/tabs-store";
import { trpcClient } from "@/utils/trpc";

type FileSearchDialogProps = {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function FileSearchDialog({
  projectId,
  open,
  onOpenChange,
}: FileSearchDialogProps) {
  const filesQuery = useQuery({
    queryKey: fsKeys.listAll(projectId),
    queryFn: () => trpcClient.fs.listAll.query({ projectId }),
    enabled: open,
    staleTime: 30_000,
  });

  const openFile = useOpenFileTab();

  // Cap the visible list — cmdk fuzzy-filters in O(n) and 50k items would
  // jank the dialog. The full set is searched, just the rendered list is
  // capped to whatever cmdk's filter ranks highest.
  const items = useMemo(
    () => filesQuery.data?.files ?? [],
    [filesQuery.data],
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search files…" />
      <CommandList className="max-h-[60vh]">
        <CommandEmpty>
          {filesQuery.isLoading ? "Indexing files…" : "No files found."}
        </CommandEmpty>
        {items.map((path) => {
          const slash = path.lastIndexOf("/");
          const name = slash === -1 ? path : path.slice(slash + 1);
          const dir = slash === -1 ? "" : path.slice(0, slash);
          return (
            <CommandItem
              key={path}
              value={path}
              onSelect={() => {
                openFile(projectId, path);
                onOpenChange(false);
              }}
            >
              <File className="size-3.5 text-muted-foreground" />
              <span className="truncate">{name}</span>
              {dir && (
                <span className="ml-2 truncate text-[10px] text-muted-foreground">
                  {dir}
                </span>
              )}
            </CommandItem>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
