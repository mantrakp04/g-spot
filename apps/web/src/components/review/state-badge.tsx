import { CircleCheck, CircleDot, CircleSlash, GitMerge, GitPullRequest, GitPullRequestDraft } from "lucide-react";

type State = "open" | "closed" | "merged" | "draft" | "completed" | "not_planned";

const CONFIG: Record<State, { label: string; color: string; icon: typeof CircleDot }> = {
  open: { label: "Open", color: "#34c486", icon: CircleDot },
  draft: { label: "Draft", color: "#7a7a85", icon: GitPullRequestDraft },
  closed: { label: "Closed", color: "#e66d75", icon: CircleSlash },
  merged: { label: "Merged", color: "#8957e5", icon: GitMerge },
  completed: { label: "Completed", color: "#8957e5", icon: CircleCheck },
  not_planned: { label: "Not planned", color: "#7a7a85", icon: CircleSlash },
};

export function StateBadge({
  kind,
  state,
  stateReason,
}: {
  kind: "pr" | "issue";
  state: "open" | "closed";
  stateReason?: string | null;
  draft?: boolean;
  merged?: boolean;
}) {
  let key: State = state;
  if (kind === "issue" && state === "closed") {
    if (stateReason === "not_planned") key = "not_planned";
    else key = "completed";
  }
  const { label, color, icon: Icon } = CONFIG[key];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium"
      style={{ background: `${color}22`, color }}
    >
      <Icon className="size-3.5" />
      {label}
    </span>
  );
}

export function PRStateBadge({
  state,
  isDraft,
  merged,
}: {
  state: "open" | "closed";
  isDraft: boolean;
  merged: boolean;
}) {
  let key: State = "open";
  if (merged) key = "merged";
  else if (isDraft) key = "draft";
  else if (state === "closed") key = "closed";
  const { label, color, icon: Icon } = CONFIG[key];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium"
      style={{ background: `${color}22`, color }}
    >
      <Icon className="size-3.5" />
      {label}
    </span>
  );
}

// Ensure icons referenced to avoid unused warning
export const _icons = { GitPullRequest };
