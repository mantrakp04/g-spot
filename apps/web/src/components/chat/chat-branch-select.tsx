import {
  type UseMutationResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
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
import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { trpc, trpcClient } from "@/utils/trpc";

type Workspace = Awaited<
  ReturnType<typeof trpcClient.git.listWorkspaces.query>
>["workspaces"][number];

type BranchWorkspace = Extract<Workspace, { kind: "branch" }>;
type WorktreeWorkspace = Extract<Workspace, { kind: "worktree" }>;

type ChatBranchSelectProps = {
  projectId: string;
  value: string | null;
  onValueChange: (value: string | null) => Promise<void> | void;
  className?: string;
};

function useChatWorkspaces(
  projectId: string,
  onValueChange: ChatBranchSelectProps["onValueChange"],
  value: string | null,
  onClose: () => void,
) {
  const queryClient = useQueryClient();

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

  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: trpc.git.listWorkspaces.queryKey({ projectId }),
    });
  }

  function run<A extends unknown[]>(
    fallback: string,
    fn: (...args: A) => Promise<void>,
  ) {
    return async (...args: A) => {
      try {
        await fn(...args);
        await refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : fallback);
      }
    };
  }

  const attach = run("Failed to attach workspace", async (name: string | null) => {
    await onValueChange(name);
    onClose();
  });

  const createWorktreeFrom = run(
    "Failed to create worktree",
    async (baseBranch: string | null) => {
      const result = await createWorktreeMutation.mutateAsync(baseBranch);
      await onValueChange(result.name);
      onClose();
      toast.success(`Worktree ${result.name} created`);
    },
  );

  const deleteBranchByName = run("Failed to delete branch", async (name: string) => {
    await deleteBranchMutation.mutateAsync(name);
    if (value === name) {
      await onValueChange(null);
    }
  });

  const deleteWorktreeByName = run(
    "Failed to delete worktree",
    async (name: string) => {
      await deleteWorktreeMutation.mutateAsync(name);
      if (value === name) {
        await onValueChange(null);
      }
    },
  );

  const createBranch = run(
    "Failed to create branch",
    async (args: { name: string; startPoint: string | null }) => {
      const result = await createBranchMutation.mutateAsync(args);
      await onValueChange(result.name);
      onClose();
    },
  );

  return {
    workspacesQuery,
    createBranchMutation,
    deleteBranchMutation,
    createWorktreeMutation,
    deleteWorktreeMutation,
    attach,
    createWorktreeFrom,
    deleteBranchByName,
    deleteWorktreeByName,
    createBranch,
  };
}

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

  function handleNestedMenuOpen(next: boolean) {
    setNestedMenuCount((c) => Math.max(0, c + (next ? 1 : -1)));
  }

  const {
    workspacesQuery,
    createBranchMutation,
    deleteBranchMutation,
    createWorktreeMutation,
    deleteWorktreeMutation,
    attach,
    createWorktreeFrom,
    deleteBranchByName,
    deleteWorktreeByName,
    createBranch,
  } = useChatWorkspaces(projectId, onValueChange, value, () =>
    setOpen(false),
  );

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

  async function submitNewBranch() {
    if (!canSubmitNewBranch) return;
    await createBranch({ name: trimmedNewBranch, startPoint: newBranchBase });
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
                    const branchWorktrees = worktrees.filter(
                      (w): w is WorktreeWorkspace =>
                        w.kind === "worktree" && w.baseBranch === branch.name,
                    );
                    return (
                      <BranchRow
                        key={`branch:${branch.name}`}
                        branch={branch}
                        worktrees={branchWorktrees}
                        value={value}
                        deleteBranchMutation={deleteBranchMutation}
                        deleteWorktreeMutation={deleteWorktreeMutation}
                        createWorktreeMutation={createWorktreeMutation}
                        onNestedMenuOpen={handleNestedMenuOpen}
                        onSelectBranch={() => {
                          if (branch.name === value) {
                            setOpen(false);
                            return;
                          }
                          void attach(branch.name);
                        }}
                        onAttach={(name) => void attach(name)}
                        onCreateWorktree={() =>
                          void createWorktreeFrom(branch.name)
                        }
                        onDeleteBranch={() => void deleteBranchByName(branch.name)}
                        onDeleteWorktree={(name) =>
                          void deleteWorktreeByName(name)
                        }
                      />
                    );
                  })}
                </div>
              </>
            ) : (
              <CreateBranchForm
                inputRef={newBranchInputRef}
                value={newBranchName}
                base={newBranchBase}
                canSubmit={canSubmitNewBranch}
                onChange={setNewBranchName}
                onKeyDown={handleNewBranchKeyDown}
                onCancel={resetCreateBranch}
                onSubmit={() => void submitNewBranch()}
              />
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

type BranchRowProps = {
  branch: BranchWorkspace;
  worktrees: WorktreeWorkspace[];
  value: string | null;
  deleteBranchMutation: UseMutationResult<unknown, unknown, string, unknown>;
  deleteWorktreeMutation: UseMutationResult<unknown, unknown, string, unknown>;
  createWorktreeMutation: UseMutationResult<
    unknown,
    unknown,
    string | null,
    unknown
  >;
  onNestedMenuOpen: (next: boolean) => void;
  onSelectBranch: () => void;
  onAttach: (name: string) => void;
  onCreateWorktree: () => void;
  onDeleteBranch: () => void;
  onDeleteWorktree: (name: string) => void;
};

function BranchRow({
  branch,
  worktrees,
  value,
  deleteBranchMutation,
  deleteWorktreeMutation,
  createWorktreeMutation,
  onNestedMenuOpen,
  onSelectBranch,
  onAttach,
  onCreateWorktree,
  onDeleteBranch,
  onDeleteWorktree,
}: BranchRowProps) {
  const isSelected = branch.name === value;
  const subtitleParts: string[] = [];
  if (branch.isProtected) subtitleParts.push("Base");
  if (branch.isCurrent && !branch.isProtected) {
    subtitleParts.push("Checked out");
  }
  if (branch.uncommittedCount > 0) {
    subtitleParts.push(`${branch.uncommittedCount} uncommitted`);
  }
  const canDelete = !branch.isProtected && !branch.isCurrent;

  return (
    <CommandItem
      value={branch.name}
      keywords={[branch.name]}
      data-checked={isSelected}
      onSelect={onSelectBranch}
      className="items-center gap-2 py-1.5 [&>svg:last-child]:hidden"
    >
      <GitBranchIcon className="text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-xs">{branch.name}</div>
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
        <DropdownMenu onOpenChange={onNestedMenuOpen}>
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
          <DropdownMenuContent align="start" side="right" sideOffset={4}>
            {worktrees.length > 0 ? (
              <>
                {worktrees.map((worktree) => {
                  const isAttached = worktree.name === value;
                  const isDeletingWorktree =
                    deleteWorktreeMutation.isPending &&
                    deleteWorktreeMutation.variables === worktree.name;
                  return (
                    <DropdownMenuItem
                      key={worktree.name}
                      onClick={() => onAttach(worktree.name)}
                      className="group/worktree-item pr-1"
                    >
                      <SquareSplitHorizontalIcon />
                      <span className="flex-1 truncate">{worktree.name}</span>
                      {worktree.uncommittedCount > 0 ? (
                        <span className="text-[10px] text-muted-foreground">
                          {worktree.uncommittedCount}
                        </span>
                      ) : null}
                      {isAttached ? <CheckIcon className="size-3" /> : null}
                      <button
                        type="button"
                        aria-label={`Delete ${worktree.name}`}
                        disabled={isDeletingWorktree}
                        className="ml-1 rounded p-0.5 text-muted-foreground opacity-0 transition hover:text-destructive focus-visible:text-destructive focus-visible:opacity-100 group-hover/worktree-item:opacity-100 group-focus/dropdown-menu-item:opacity-100 disabled:opacity-50"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onDeleteWorktree(worktree.name);
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
              onClick={onCreateWorktree}
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
                  onClick={onDeleteBranch}
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
}

type CreateBranchFormProps = {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  base: string | null;
  canSubmit: boolean;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

function CreateBranchForm({
  inputRef,
  value,
  base,
  canSubmit,
  onChange,
  onKeyDown,
  onCancel,
  onSubmit,
}: CreateBranchFormProps) {
  return (
    <div className="space-y-2 p-3">
      <div className="space-y-1">
        <div className="text-[11px] font-medium text-muted-foreground">
          New branch
        </div>
        <Input
          ref={inputRef}
          value={value}
          placeholder="feature/my-branch"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          className="h-8 text-xs"
        />
        <div className="text-[11px] text-muted-foreground">
          {base ? (
            <>
              From <span className="text-foreground/80">{base}</span>
            </>
          ) : (
            "Pick a base branch first"
          )}
        </div>
      </div>
      <div className="flex justify-end gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={!canSubmit} onClick={onSubmit}>
          Create
        </Button>
      </div>
    </div>
  );
}
