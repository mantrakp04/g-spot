import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@g-spot/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@g-spot/ui/components/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@g-spot/ui/components/popover";
import { cn } from "@g-spot/ui/lib/utils";
import { ChevronDownIcon, GitBranchIcon, PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { trpc, trpcClient } from "@/utils/trpc";

type ChatBranchSelectProps = {
  projectId: string;
  value: string | null;
  onValueChange: (value: string | null) => void;
  className?: string;
};

function stripRemotePrefix(branch: string) {
  const [, ...rest] = branch.split("/");
  return rest.length > 0 ? rest.join("/") : branch;
}

export function ChatBranchSelect({
  projectId,
  value,
  onValueChange,
  className,
}: ChatBranchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const queryClient = useQueryClient();

  const branchesQuery = useQuery({
    ...trpc.git.listBranches.queryOptions({ projectId }),
    enabled: !!projectId,
  });

  const data = branchesQuery.data;
  const localBranches = data?.local ?? [];
  const remoteBranches = data?.remote ?? [];
  const currentBranch = data?.current ?? null;
  const uncommittedCount = data?.uncommittedCount ?? 0;
  const isGitRepo =
    localBranches.length > 0 || remoteBranches.length > 0 || currentBranch !== null;

  const createBranchMutation = useMutation({
    mutationFn: (name: string) =>
      trpcClient.git.createBranch.mutate({ projectId, name, checkout: true }),
    onSuccess: (result) => {
      toast.success(`Created and checked out ${result.name}`);
      setQuery("");
      setOpen(false);
      onValueChange(result.name);
      void queryClient.invalidateQueries({
        queryKey: trpc.git.listBranches.queryKey({ projectId }),
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create branch");
    },
  });

  const branches = useMemo(() => {
    const set = new Set<string>();
    const ordered: string[] = [];
    for (const branch of localBranches) {
      if (!set.has(branch)) {
        set.add(branch);
        ordered.push(branch);
      }
    }
    for (const remote of remoteBranches) {
      const normalized = stripRemotePrefix(remote);
      if (!set.has(normalized)) {
        set.add(normalized);
        ordered.push(normalized);
      }
    }
    if (currentBranch) {
      const existingIdx = ordered.indexOf(currentBranch);
      if (existingIdx > 0) {
        ordered.splice(existingIdx, 1);
        ordered.unshift(currentBranch);
      } else if (existingIdx === -1) {
        ordered.unshift(currentBranch);
      }
    }
    return ordered;
  }, [currentBranch, localBranches, remoteBranches]);

  const trimmedQuery = query.trim();
  const canCreate =
    trimmedQuery.length > 0 && !branches.includes(trimmedQuery) && isGitRepo;

  const selectedLabel = value ?? currentBranch ?? (isGitRepo ? "Repo HEAD" : "Not a git repo");

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "text-muted-foreground hover:text-foreground",
              className,
            )}
            disabled={!projectId}
          />
        }
      >
        <GitBranchIcon />
        <span className="max-w-[12rem] truncate">{selectedLabel}</span>
        <ChevronDownIcon className="opacity-60" />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-[min(22rem,calc(100vw-2rem))] overflow-hidden p-0"
        sideOffset={6}
      >
        <Command className="bg-transparent">
          <CommandInput
            placeholder="Search branches"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-72">
            <CommandEmpty>
              {isGitRepo ? "No branches match." : "Not a git repo"}
            </CommandEmpty>

            {branches.length > 0 ? (
              <CommandGroup heading="Branches" className="p-1">
                {branches.map((branch) => {
                  const isSelected = value === branch || (value === null && branch === currentBranch);
                  const isCurrent = branch === currentBranch;
                  return (
                    <CommandItem
                      key={branch}
                      value={branch}
                      keywords={[branch]}
                      data-checked={isSelected}
                      onSelect={() => {
                        onValueChange(branch === currentBranch ? null : branch);
                        setOpen(false);
                      }}
                      className="items-start gap-2 py-2"
                    >
                      <GitBranchIcon className="mt-0.5 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-xs">{branch}</div>
                        {isCurrent && uncommittedCount > 0 ? (
                          <div className="truncate text-[11px] text-muted-foreground">
                            Uncommitted: {uncommittedCount}{" "}
                            {uncommittedCount === 1 ? "file" : "files"}
                          </div>
                        ) : null}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>

        {isGitRepo ? (
          <div className="border-t border-border p-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground hover:text-foreground"
              disabled={!canCreate || createBranchMutation.isPending}
              onClick={() => {
                if (!canCreate) return;
                createBranchMutation.mutate(trimmedQuery);
              }}
            >
              <PlusIcon />
              <span className="truncate">
                {canCreate
                  ? `Create and checkout “${trimmedQuery}”`
                  : "Create and checkout new branch…"}
              </span>
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
