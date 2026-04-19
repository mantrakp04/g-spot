import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@g-spot/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@g-spot/ui/components/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@g-spot/ui/components/dropdown-menu";
import { Input } from "@g-spot/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@g-spot/ui/components/popover";
import { cn } from "@g-spot/ui/lib/utils";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  GitBranchIcon,
  PlusIcon,
  SquareSplitHorizontalIcon,
  Trash2Icon,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { trpc, trpcClient } from "@/utils/trpc";

type ChatBranchSelectProps = {
  projectId: string;
  value: string | null;
  onValueChange: (value: string | null) => Promise<void> | void;
  className?: string;
};

export function ChatBranchSelect({
  projectId,
  value,
  onValueChange,
  className,
}: ChatBranchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [nestedMenuCount, setNestedMenuCount] = useState(0);
  const newBranchInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  function handleNestedMenuOpen(next: boolean) {
    setNestedMenuCount((c) => Math.max(0, c + (next ? 1 : -1)));
  }

  const workspacesQuery = useQuery({
    ...trpc.git.listWorkspaces.queryOptions({ projectId }),
    enabled: !!projectId,
  });

  const createBranchMutation = useMutation({
    mutationFn: (args: { name: string; startPoint: string | null }) =>
      trpcClient.git.createBranch.mutate({
        projectId,
        name: args.name,
        startPoint: args.startPoint,
        checkout: true,
      }),
  });

  const deleteBranchMutation = useMutation({
    mutationFn: (name: string) =>
      trpcClient.git.deleteBranch.mutate({ projectId, name }),
  });

  const createWorktreeMutation = useMutation({
    mutationFn: (baseBranch: string | null) =>
      trpcClient.git.createWorktree.mutate({ projectId, baseBranch }),
  });

  const deleteWorktreeMutation = useMutation({
    mutationFn: (name: string) =>
      trpcClient.git.deleteWorktree.mutate({ projectId, name }),
  });

  const data = workspacesQuery.data;
  const workspaces = data?.workspaces ?? [];
  const branches = useMemo(
    () => workspaces.filter((w) => w.kind === "branch"),
    [workspaces],
  );
  const worktrees = useMemo(
    () => workspaces.filter((w) => w.kind === "worktree"),
    [workspaces],
  );
  const isGitRepo = workspaces.length > 0 || (data?.remote.length ?? 0) > 0;

  const currentBranchName = useMemo(
    () =>
      branches.find((b) => b.kind === "branch" && b.isCurrent)?.name ?? null,
    [branches],
  );

  const attached = useMemo(
    () => workspaces.find((w) => w.name === value) ?? null,
    [workspaces, value],
  );
  const attachedKind = attached?.kind ?? null;
  const triggerLabel =
    value ??
    currentBranchName ??
    (isGitRepo ? "Repo HEAD" : "Not a git repo");

  // Base branch for new-branch creation: the attached row, or current.
  const newBranchBase = value ?? currentBranchName ?? null;
  const trimmedNewBranch = newBranchName.trim();
  const branchNames = useMemo(() => branches.map((b) => b.name), [branches]);
  const canSubmitNewBranch =
    trimmedNewBranch.length > 0 &&
    !branchNames.includes(trimmedNewBranch) &&
    !createBranchMutation.isPending;

  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: trpc.git.listWorkspaces.queryKey({ projectId }),
    });
  }

  async function attach(name: string | null) {
    try {
      await onValueChange(name);
      setOpen(false);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to attach workspace",
      );
    }
  }

  async function createWorktreeFrom(baseBranch: string | null) {
    try {
      const result = await createWorktreeMutation.mutateAsync(baseBranch);
      await onValueChange(result.name);
      setOpen(false);
      await refresh();
      toast.success(`Worktree ${result.name} created`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create worktree",
      );
    }
  }

  async function deleteBranchByName(name: string) {
    try {
      await deleteBranchMutation.mutateAsync(name);
      if (value === name) {
        await onValueChange(null);
      }
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `Failed to delete ${name}`,
      );
    }
  }

  async function deleteWorktreeByName(name: string) {
    try {
      await deleteWorktreeMutation.mutateAsync(name);
      if (value === name) {
        await onValueChange(null);
      }
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `Failed to delete ${name}`,
      );
    }
  }

  async function submitNewBranch() {
    if (!canSubmitNewBranch) return;
    try {
      const result = await createBranchMutation.mutateAsync({
        name: trimmedNewBranch,
        startPoint: newBranchBase,
      });
      await onValueChange(result.name);
      resetCreateBranch();
      setOpen(false);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create branch",
      );
    }
  }

  function resetCreateBranch() {
    setCreatingBranch(false);
    setNewBranchName("");
  }

  function startCreateBranch() {
    setNewBranchName("");
    setCreatingBranch(true);
  }

  useEffect(() => {
    if (creatingBranch) {
      const id = window.setTimeout(() => newBranchInputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    return;
  }, [creatingBranch]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      resetCreateBranch();
    }
  }, [open]);

  function handleNewBranchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void submitNewBranch();
    } else if (event.key === "Escape") {
      event.preventDefault();
      resetCreateBranch();
    }
  }

  return (
    <Popover
      onOpenChange={(next) => {
        if (!next && nestedMenuCount > 0) return;
        setOpen(next);
      }}
      open={open}
    >
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
        {attachedKind === "worktree" ? (
          <SquareSplitHorizontalIcon />
        ) : (
          <GitBranchIcon />
        )}
        <span className="max-w-[12rem] truncate">{triggerLabel}</span>
        <ChevronDownIcon className="opacity-60" />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-[min(24rem,calc(100vw-2rem))] gap-0 overflow-hidden p-0"
        sideOffset={6}
      >
        <Command className="bg-transparent">
          {!creatingBranch ? (
            <CommandInput
              placeholder="Search workspaces"
              value={query}
              onValueChange={setQuery}
            />
          ) : null}

          <CommandList className="max-h-80">
            {!creatingBranch ? (
              <>
                <CommandEmpty>
                  {isGitRepo ? "No matches." : "Not a git repo"}
                </CommandEmpty>

                <div className="p-1">
                  {branches.map((branch) => {
                    if (branch.kind !== "branch") return null;
                    const isSelected = branch.name === value;
                    const branchWorktrees = worktrees.filter(
                      (w) => w.kind === "worktree" && w.baseBranch === branch.name,
                    );
                    const subtitleParts: string[] = [];
                    if (branch.isProtected) subtitleParts.push("Base");
                    if (branch.isCurrent && !branch.isProtected) {
                      subtitleParts.push("Checked out");
                    }
                    if (branch.uncommittedCount > 0) {
                      subtitleParts.push(
                        `${branch.uncommittedCount} uncommitted`,
                      );
                    }
                    const canDelete = !branch.isProtected && !branch.isCurrent;

                    return (
                      <CommandItem
                        key={`branch:${branch.name}`}
                        value={branch.name}
                        keywords={[branch.name]}
                        data-checked={isSelected}
                        onSelect={() => {
                          if (isSelected) {
                            setOpen(false);
                            return;
                          }
                          void attach(branch.name);
                        }}
                        className="items-center gap-2 py-1.5 [&>svg:last-child]:hidden"
                      >
                        <GitBranchIcon className="text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-xs">
                            {branch.name}
                          </div>
                          {subtitleParts.length > 0 ? (
                            <div className="truncate text-[11px] text-muted-foreground">
                              {subtitleParts.join(" · ")}
                            </div>
                          ) : null}
                        </div>

                        <div className="ml-auto flex shrink-0 items-center gap-0.5 self-center">
                          {isSelected ? (
                            <CheckIcon className="size-3.5 text-foreground" />
                          ) : null}
                          <DropdownMenu onOpenChange={handleNestedMenuOpen}>
                            <DropdownMenuTrigger
                              openOnHover
                              render={
                                <button
                                  type="button"
                                  aria-label={`Actions for ${branch.name}`}
                                  className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:text-foreground"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                  }}
                                  onPointerDown={(event) => {
                                    event.stopPropagation();
                                  }}
                                />
                              }
                            >
                              <ChevronRightIcon className="size-3.5" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="start"
                              side="right"
                              sideOffset={4}
                            >
                              {branchWorktrees.length > 0 ? (
                                <>
                                  {branchWorktrees.map((worktree) => {
                                    if (worktree.kind !== "worktree") return null;
                                    const isAttached = worktree.name === value;
                                    const isDeletingWorktree =
                                      deleteWorktreeMutation.isPending &&
                                      deleteWorktreeMutation.variables === worktree.name;
                                    return (
                                      <DropdownMenuItem
                                        key={worktree.name}
                                        onClick={() => void attach(worktree.name)}
                                        className="group/worktree-item pr-1"
                                      >
                                        <SquareSplitHorizontalIcon />
                                        <span className="flex-1 truncate">
                                          {worktree.name}
                                        </span>
                                        {worktree.uncommittedCount > 0 ? (
                                          <span className="text-[10px] text-muted-foreground">
                                            {worktree.uncommittedCount}
                                          </span>
                                        ) : null}
                                        {isAttached ? (
                                          <CheckIcon className="size-3" />
                                        ) : null}
                                        <button
                                          type="button"
                                          aria-label={`Delete ${worktree.name}`}
                                          disabled={isDeletingWorktree}
                                          className="ml-1 rounded p-0.5 text-muted-foreground opacity-0 transition hover:text-destructive focus-visible:text-destructive focus-visible:opacity-100 group-hover/worktree-item:opacity-100 group-focus/dropdown-menu-item:opacity-100 disabled:opacity-50"
                                          onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            void deleteWorktreeByName(worktree.name);
                                          }}
                                          onPointerDown={(event) => {
                                            event.stopPropagation();
                                          }}
                                        >
                                          <Trash2Icon className="size-3" />
                                        </button>
                                      </DropdownMenuItem>
                                    );
                                  })}
                                  <DropdownMenuSeparator />
                                </>
                              ) : null}
                              <DropdownMenuItem
                                disabled={createWorktreeMutation.isPending}
                                onClick={() => void createWorktreeFrom(branch.name)}
                              >
                                <PlusIcon />
                                New worktree from {branch.name}
                              </DropdownMenuItem>
                              {canDelete ? (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    variant="destructive"
                                    disabled={
                                      deleteBranchMutation.isPending &&
                                      deleteBranchMutation.variables === branch.name
                                    }
                                    onClick={() => void deleteBranchByName(branch.name)}
                                  >
                                    <Trash2Icon />
                                    Delete branch
                                  </DropdownMenuItem>
                                </>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </CommandItem>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="space-y-2 p-3">
                <div className="space-y-1">
                  <div className="text-[11px] font-medium text-muted-foreground">
                    New branch
                  </div>
                  <Input
                    ref={newBranchInputRef}
                    value={newBranchName}
                    placeholder="feature/my-branch"
                    onChange={(event) => setNewBranchName(event.target.value)}
                    onKeyDown={handleNewBranchKeyDown}
                    className="h-8 text-xs"
                  />
                  <div className="text-[11px] text-muted-foreground">
                    {newBranchBase ? (
                      <>
                        From{" "}
                        <span className="text-foreground/80">{newBranchBase}</span>
                      </>
                    ) : (
                      "Pick a base branch first"
                    )}
                  </div>
                </div>
                <div className="flex justify-end gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={resetCreateBranch}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!canSubmitNewBranch}
                    onClick={() => void submitNewBranch()}
                  >
                    Create
                  </Button>
                </div>
              </div>
            )}
          </CommandList>
        </Command>

        {isGitRepo && !creatingBranch ? (
          <div className="border-t border-border p-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground hover:text-foreground"
              onClick={startCreateBranch}
            >
              <PlusIcon />
              <span className="truncate">
                {newBranchBase
                  ? `New branch from ${newBranchBase}`
                  : "New branch"}
              </span>
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
