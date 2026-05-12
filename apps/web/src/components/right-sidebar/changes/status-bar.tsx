import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@g-spot/ui/components/tooltip";
import { ArrowDownToLine, ArrowUpFromLine, Archive, GitBranch } from "lucide-react";

import { trpcClient } from "@/utils/trpc";

type Branch = Awaited<ReturnType<typeof trpcClient.git.currentBranch.query>>;
type Stash = Awaited<
  ReturnType<typeof trpcClient.git.stashList.query>
>["stashes"][number];

type Props = {
  branch: Branch | undefined;
  stashes: Stash[] | undefined;
};

export function StatusBar({ branch, stashes }: Props) {
  const ahead = branch?.ahead ?? 0;
  const behind = branch?.behind ?? 0;
  const stashCount = stashes?.length ?? 0;

  return (
    <div className="flex h-[22px] shrink-0 items-center gap-2 border-t border-border px-2 text-[10px] text-muted-foreground">
      {branch?.branch && (
        <span className="flex items-center gap-1">
          <GitBranch className="size-3" />
          <span className="truncate">{branch.branch}</span>
        </span>
      )}
      {(behind > 0 || ahead > 0) && (
        <span className="flex items-center gap-1 font-mono">
          {behind > 0 && (
            <span className="flex items-center gap-0.5">
              <ArrowDownToLine className="size-3" />
              {behind}
            </span>
          )}
          {ahead > 0 && (
            <span className="flex items-center gap-0.5">
              <ArrowUpFromLine className="size-3" />
              {ahead}
            </span>
          )}
        </span>
      )}
      <div className="flex-1" />
      {stashCount > 0 && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="flex items-center gap-1">
                <Archive className="size-3" />
                {stashCount}
              </span>
            }
          />
          <TooltipContent>{stashCount} stashed</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
