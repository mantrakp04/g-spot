import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@g-spot/ui/components/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@g-spot/ui/components/tooltip";
import { cn } from "@g-spot/ui/lib/utils";
import {
  FolderTree,
  List,
  ListTree,
  MoreHorizontal,
  RefreshCw,
} from "lucide-react";

import { useConfirmDialog } from "@/contexts/confirm-dialog-context";

import { StashSubMenu } from "./stash-menu";
import {
  type ViewMode,
  useViewMode,
} from "./use-changes";
import type { GitMutations } from "./use-git-mutations";
import type { trpcClient } from "@/utils/trpc";

type Stash = Awaited<
  ReturnType<typeof trpcClient.git.stashList.query>
>["stashes"][number];

type Props = {
  isFetching: boolean;
  onRefresh: () => void;
  mutations: GitMutations;
  stashes: Stash[] | undefined;
};

const VIEW_ICON: Record<ViewMode, typeof List> = {
  list: List,
  tree: FolderTree,
  compact: ListTree,
};

const VIEW_LABEL: Record<ViewMode, string> = {
  list: "List",
  tree: "Tree",
  compact: "Compact",
};

const VIEW_ORDER: ViewMode[] = ["list", "tree", "compact"];

export function HeaderToolbar({
  isFetching,
  onRefresh,
  mutations,
  stashes,
}: Props) {
  const [viewMode, setViewMode] = useViewMode();
  const confirm = useConfirmDialog();
  const ViewIcon = VIEW_ICON[viewMode];

  const stashAll = async (includeUntracked: boolean) => {
    const message = window.prompt(
      includeUntracked
        ? "Stash message (incl. untracked):"
        : "Stash message:",
    );
    if (message === null) return;
    mutations.stashPush.mutate({ message: message || undefined, includeUntracked });
  };

  const confirmThen = async (
    title: string,
    description: string,
    fn: () => void,
    destructive = false,
  ) => {
    if (await confirm({ title, description, destructive })) fn();
  };

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-1">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={onRefresh}
              className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Refresh"
            >
              <RefreshCw className={cn("size-3", isFetching && "animate-spin")} />
            </button>
          }
        />
        <TooltipContent>Refresh</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`View: ${VIEW_LABEL[viewMode]}`}
              >
                <ViewIcon className="size-3" />
              </DropdownMenuTrigger>
            }
          />
          <TooltipContent>View: {VIEW_LABEL[viewMode]}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuGroup>
            <DropdownMenuLabel>View as</DropdownMenuLabel>
            {VIEW_ORDER.map((m) => {
              const Icon = VIEW_ICON[m];
              return (
                <DropdownMenuCheckboxItem
                  key={m}
                  checked={viewMode === m}
                  onCheckedChange={() => setViewMode(m)}
                >
                  <Icon className="mr-2 size-3.5" />
                  {VIEW_LABEL[m]}
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="flex-1" />
      <DropdownMenu>
        <DropdownMenuTrigger
          className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="More actions"
        >
          <MoreHorizontal className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => mutations.pull.mutate({})}>
            Pull
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => mutations.pull.mutate({ rebase: true })}
          >
            Pull (Rebase)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => mutations.push.mutate({})}>
            Push
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              confirmThen(
                "Force push?",
                "This force-pushes with --force-with-lease.",
                () => mutations.push.mutate({ force: true }),
                true,
              )
            }
          >
            Push (Force-with-lease)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => mutations.sync.mutate()}>
            Sync
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => mutations.fetchRemote.mutate({})}>
            Fetch
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => mutations.fetchRemote.mutate({ all: true })}
          >
            Fetch All
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => mutations.publishBranch.mutate()}>
            Publish Branch
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => stashAll(false)}>
            Stash All Changes
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => stashAll(true)}>
            Stash Including Untracked
          </DropdownMenuItem>
          <StashSubMenu
            label="Apply Stash"
            stashes={stashes}
            onSelect={(i) => mutations.stashApply.mutate(i)}
          />
          <StashSubMenu
            label="Pop Stash"
            stashes={stashes}
            onSelect={(i) => mutations.stashPop.mutate(i)}
          />
          <StashSubMenu
            label="Drop Stash"
            stashes={stashes}
            onSelect={(i) => mutations.stashDrop.mutate(i)}
          />
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() =>
              confirmThen(
                "Discard all changes?",
                "All uncommitted changes will be lost.",
                () => mutations.discardAll.mutate(),
                true,
              )
            }
          >
            Discard All Changes
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => mutations.reset.mutate({ mode: "soft" })}
          >
            Reset (soft)
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => mutations.reset.mutate({ mode: "mixed" })}
          >
            Reset (mixed)
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() =>
              confirmThen(
                "Hard reset HEAD?",
                "Working tree and index are reset. Uncommitted changes are lost.",
                () => mutations.reset.mutate({ mode: "hard", confirm: true }),
                true,
              )
            }
          >
            Reset (hard)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
