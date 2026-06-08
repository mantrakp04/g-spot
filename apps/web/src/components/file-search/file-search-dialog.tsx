import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@g-spot/ui/components/command";
import { useQuery } from "@tanstack/react-query";
import { File } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

import { fsKeys } from "@/lib/query-keys";
import { useOpenFileTab } from "@/lib/tabs-store";
import { trpcClient } from "@/utils/trpc";

type FileSearchDialogProps = {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const INITIAL_RESULT_LIMIT = 60;
const SEARCH_RESULT_LIMIT = 80;

type IndexedFile = {
  path: string;
  name: string;
  dir: string;
  lowerPath: string;
  lowerName: string;
};

function getFileParts(path: string) {
  const slash = path.lastIndexOf("/");
  return {
    name: slash === -1 ? path : path.slice(slash + 1),
    dir: slash === -1 ? "" : path.slice(0, slash),
  };
}

function containsLiteralText(haystack: string, needle: string) {
  const limit = haystack.length - needle.length;
  for (let start = 0; start <= limit; start++) {
    let matched = true;
    for (let index = 0; index < needle.length; index++) {
      if (haystack.charCodeAt(start + index) !== needle.charCodeAt(index)) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

function scoreFile(file: IndexedFile, terms: string[]) {
  let score = 0;
  for (const term of terms) {
    if (file.lowerName === term) {
      score += 80;
      continue;
    }
    if (file.lowerName.startsWith(term)) {
      score += 50;
      continue;
    }
    if (containsLiteralText(file.lowerName, term)) {
      score += 30;
      continue;
    }
    if (containsLiteralText(file.lowerPath, term)) {
      score += 10;
      continue;
    }
    return 0;
  }
  return score - file.path.length / 1000;
}

export function FileSearchDialog({
  projectId,
  open,
  onOpenChange,
}: FileSearchDialogProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const filesQuery = useQuery({
    queryKey: fsKeys.listAll(projectId),
    queryFn: () => trpcClient.fs.listAll.query({ projectId }),
    enabled: open,
    staleTime: 30_000,
  });

  const openFile = useOpenFileTab();

  const index = useMemo<IndexedFile[]>(() => {
    return (filesQuery.data?.files ?? []).map((path) => {
      const { name, dir } = getFileParts(path);
      return {
        path,
        name,
        dir,
        lowerPath: path.toLowerCase(),
        lowerName: name.toLowerCase(),
      };
    });
  }, [filesQuery.data?.files]);

  const items = useMemo(() => {
    const text = deferredQuery.trim().toLowerCase();
    if (!text) {
      return index.slice(0, INITIAL_RESULT_LIMIT);
    }
    const terms: string[] = [];
    for (const term of text.split(/\s+/)) {
      if (!term) continue;
      terms.push(term);
    }
    const scored: { file: IndexedFile; score: number }[] = [];
    for (const file of index) {
      const score = scoreFile(file, terms);
      if (score > 0) scored.push({ file, score });
    }
    scored.sort((a, b) => b.score - a.score || a.file.path.length - b.file.path.length);
    return scored.slice(0, SEARCH_RESULT_LIMIT).map(({ file }) => file);
  }, [deferredQuery, index]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) setQuery("");
      }}
      commandProps={{ shouldFilter: false }}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search files…"
      />
      <CommandList className="max-h-[60vh]">
        <CommandEmpty>
          {filesQuery.isLoading ? "Indexing files…" : "No files found."}
        </CommandEmpty>
        {items.map((file) => (
          <CommandItem
            key={file.path}
            value={file.path}
            onSelect={() => {
              openFile(projectId, file.path);
              onOpenChange(false);
            }}
          >
            <File className="size-3.5 text-muted-foreground" />
            <span className="truncate">{file.name}</span>
            {file.dir && (
              <span className="ml-2 truncate text-[10px] text-muted-foreground">
                {file.dir}
              </span>
            )}
          </CommandItem>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
