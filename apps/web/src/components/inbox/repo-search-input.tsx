import { useState, useMemo } from "react";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@g-spot/ui/components/avatar";
import { Button } from "@g-spot/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@g-spot/ui/components/popover";
import { Search, Loader2, Lock, Plus } from "lucide-react";

import type { RepoOption } from "@/hooks/use-github-options";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";

type RepoSearchInputProps = {
  repoOptions: RepoOption[];
  isLoading: boolean;
  onSelect: (repo: string) => void;
  onSearchChange: (query: string) => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => void;
};

export function RepoSearchInput({
  repoOptions,
  isLoading,
  onSelect,
  onSearchChange,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: RepoSearchInputProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);

  const sentinelRef = useInfiniteScroll({
    hasNextPage: hasNextPage ?? false,
    isFetchingNextPage: isFetchingNextPage ?? false,
    fetchNextPage: fetchNextPage ?? (() => {}),
    root: scrollContainer,
  });

  const filtered = useMemo(() => {
    if (!search) return repoOptions;
    const lower = search.toLowerCase();
    return repoOptions.filter(
      (opt) =>
        opt.label.toLowerCase().includes(lower) ||
        opt.value.toLowerCase().includes(lower),
    );
  }, [repoOptions, search]);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setSearch("");
          onSearchChange("");
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-full justify-start gap-2 px-2.5 font-normal text-xs text-muted-foreground"
          />
        }
      >
        <Plus className="size-3 shrink-0" />
        <span>Search repositories...</span>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--anchor-width)] min-w-[300px] max-h-[var(--available-height,400px)] flex flex-col overflow-hidden p-0"
        align="start"
      >
        {/* Search bar — fixed */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 shrink-0">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              onSearchChange(e.target.value);
            }}
            placeholder='Search repos... try "org/" for all org repos'
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            autoFocus
          />
          {(isLoading || isFetchingNextPage) && (
            <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
          )}
        </div>

        {/* Results — scrollable */}
        <div
          ref={setScrollContainer}
          className="flex-1 min-h-0 overflow-y-auto p-1"
        >
          {!isLoading && filtered.length === 0 && !search && (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              Type to search repositories
            </div>
          )}

          {!isLoading && filtered.length === 0 && search && (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              No repositories found
            </div>
          )}

          {filtered.map((repo) => (
            <button
              key={repo.value}
              type="button"
              className="flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-accent"
              onClick={() => {
                onSelect(repo.value);
                setOpen(false);
                setSearch("");
                onSearchChange("");
              }}
            >
              <Avatar className="size-5 shrink-0">
                <AvatarImage src={repo.ownerAvatar} />
                <AvatarFallback className="text-[8px]">
                  {repo.value.split("/")[0]?.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-medium">
                    {repo.label}
                  </span>
                  {repo.isPrivate && (
                    <Lock className="size-2.5 shrink-0 text-muted-foreground" />
                  )}
                </div>
                {repo.description && (
                  <p className="truncate text-[11px] leading-tight text-muted-foreground">
                    {repo.description}
                  </p>
                )}
              </div>
            </button>
          ))}

          {/* Infinite scroll sentinel */}
          {hasNextPage && <div ref={sentinelRef} className="h-1" />}

          {isFetchingNextPage && (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Custom repo option */}
          {search && search.includes("/") && !filtered.some((r) => r.value === search) && (
            <>
              {filtered.length > 0 && (
                <div className="mx-1 my-1 border-t border-border" />
              )}
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => {
                  onSelect(search);
                  setOpen(false);
                  setSearch("");
                  onSearchChange("");
                }}
              >
                <Plus className="size-3.5 shrink-0" />
                Add &ldquo;{search}&rdquo;
              </button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
