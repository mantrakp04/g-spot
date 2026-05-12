import { Button } from "@g-spot/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@g-spot/ui/components/tooltip";
import { ArrowDownToLine, ArrowUpFromLine, Check, GitBranch } from "lucide-react";
import { type ReactNode } from "react";

import { trpcClient } from "@/utils/trpc";

import type { GitMutations } from "./use-git-mutations";

type RepoState = Awaited<ReturnType<typeof trpcClient.git.repoState.query>>;
type CurrentBranchInfo = Awaited<
  ReturnType<typeof trpcClient.git.currentBranch.query>
>;

type Props = {
  message: string;
  branch: CurrentBranchInfo | undefined;
  repoState: RepoState | undefined;
  mutations: GitMutations;
  onCommitted: () => void;
};

type ButtonSpec = {
  label: ReactNode;
  disabled?: boolean;
  tooltip?: string;
  onClick?: () => void;
};

export function ActionButton({
  message,
  branch,
  repoState,
  mutations,
  onCommitted,
}: Props) {
  const spec = pickAction({ message, branch, repoState, mutations, onCommitted });
  const isPending =
    mutations.commit.isPending ||
    mutations.sync.isPending ||
    mutations.publishBranch.isPending;

  const button = (
    <Button
      type="button"
      variant="default"
      size="sm"
      className="h-8 w-full"
      disabled={spec.disabled || isPending}
      onClick={spec.onClick}
    >
      {spec.label}
    </Button>
  );

  if (!spec.tooltip) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="contents">{button}</span>} />
      <TooltipContent>{spec.tooltip}</TooltipContent>
    </Tooltip>
  );
}

function pickAction({
  message,
  branch,
  repoState,
  mutations,
  onCommitted,
}: Props): ButtonSpec {
  const trimmed = message.trim();
  const commitNow = () => {
    mutations.commit.mutate(
      { message: trimmed },
      { onSuccess: () => onCommitted() },
    );
  };

  if (repoState) {
    if (
      repoState.state === "merging" ||
      repoState.state === "cherry-picking" ||
      repoState.state === "reverting"
    ) {
      if (repoState.conflicted) {
        return { label: "Resolve Conflicts", disabled: true };
      }
      const stateLabel = stateName(repoState.state);
      return {
        label: (
          <>
            <Check />
            <span>Continue {stateLabel}</span>
          </>
        ),
        disabled: !trimmed,
        tooltip: trimmed ? undefined : "Enter a message",
        onClick: commitNow,
      };
    }
    if (repoState.state === "rebasing") {
      return {
        label: "Continue Rebase",
        disabled: true,
        tooltip: "Open terminal to continue rebase",
      };
    }
  }

  const hasStaged = repoState?.hasStaged ?? false;

  if (hasStaged) {
    return {
      label: (
        <>
          <Check />
          <span>Commit</span>
        </>
      ),
      disabled: !trimmed,
      tooltip: trimmed ? undefined : "Enter a message",
      onClick: commitNow,
    };
  }

  if (branch?.branch && !branch.upstream) {
    return {
      label: (
        <>
          <GitBranch />
          <span>Publish Branch</span>
        </>
      ),
      onClick: () => mutations.publishBranch.mutate(),
    };
  }

  if (branch && (branch.ahead > 0 || branch.behind > 0)) {
    return {
      label: (
        <span className="flex items-center gap-1.5">
          Sync Changes
          {branch.behind > 0 && (
            <span className="flex items-center gap-0.5 font-mono text-[10px]">
              <ArrowDownToLine className="size-3" />
              {branch.behind}
            </span>
          )}
          {branch.ahead > 0 && (
            <span className="flex items-center gap-0.5 font-mono text-[10px]">
              <ArrowUpFromLine className="size-3" />
              {branch.ahead}
            </span>
          )}
        </span>
      ),
      onClick: () => mutations.sync.mutate(),
    };
  }

  return {
    label: (
      <>
        <Check />
        <span>Commit</span>
      </>
    ),
    disabled: true,
    tooltip: "No staged changes",
  };
}

function stateName(s: RepoState["state"]): string {
  switch (s) {
    case "merging":
      return "Merge";
    case "cherry-picking":
      return "Cherry-pick";
    case "reverting":
      return "Revert";
    case "rebasing":
      return "Rebase";
    default:
      return "";
  }
}
