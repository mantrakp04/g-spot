import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  CircleDot,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Users,
  XCircle,
} from "lucide-react";
import type { OAuthConnection } from "@stackframe/react";

import { Avatar, AvatarFallback, AvatarImage } from "@g-spot/ui/components/avatar";
import { Button } from "@g-spot/ui/components/button";
import { Checkbox } from "@g-spot/ui/components/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@g-spot/ui/components/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@g-spot/ui/components/popover";

import type {
  DeploymentSummary,
  ReviewTarget,
  useGitHubIssueDetail,
  useGitHubPRDetail,
} from "@/hooks/use-github-detail";
import { ReviewForm, type ReviewEvent } from "./review-drawer";
import {
  useGitHubPRDeployments,
  useGitHubRepoAssignees,
  useGitHubRepoLabels,
  useGitHubRepoMilestones,
  useIssueAssigneesMutation,
  useIssueLabelsMutation,
  useIssueMilestoneMutation,
  useIssueStateMutation,
  useRequestReviewersMutation,
} from "@/hooks/use-github-detail";

type PR = NonNullable<ReturnType<typeof useGitHubPRDetail>["data"]>;
type Issue = NonNullable<ReturnType<typeof useGitHubIssueDetail>["data"]>;

type Labelable = {
  labels: ReadonlyArray<string | { name?: string | null; color?: string | null }>;
  assignees?: ReadonlyArray<{ login: string; avatar_url: string; id: number }> | null;
  milestone?: { id: number; number: number; title: string } | null;
  state: string;
  state_reason?: string | null;
};

function copy(text: string) {
  void navigator.clipboard.writeText(text);
}

function ActionButton({
  children,
  onClick,
  variant = "outline",
  "aria-label": ariaLabel,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "outline" | "primary" | "ghost";
  "aria-label"?: string;
}) {
  const mapped = variant === "primary" ? "default" : variant;
  return (
    <Button
      type="button"
      variant={mapped}
      size="default"
      onClick={onClick}
      aria-label={ariaLabel}
    >
      {children}
    </Button>
  );
}

function stateDotClass(state: string) {
  if (state === "success") return "bg-emerald-500";
  if (state === "failure" || state === "error") return "bg-rose-500";
  if (state === "in_progress" || state === "pending" || state === "queued")
    return "bg-amber-500";
  if (state === "inactive") return "bg-muted-foreground/50";
  return "bg-muted-foreground/70";
}

function groupDeployments(deps: DeploymentSummary[]) {
  const preview: DeploymentSummary[] = [];
  const production: DeploymentSummary[] = [];
  const others: DeploymentSummary[] = [];
  for (const d of deps) {
    const env = d.environment.toLowerCase();
    if (env.includes("prod")) production.push(d);
    else if (env.includes("preview") || env.includes("staging")) preview.push(d);
    else others.push(d);
  }
  return { preview, production, others };
}

function PreviewDeploysDropdown({
  target,
  account,
  headSha,
}: {
  target: ReviewTarget;
  account: OAuthConnection;
  headSha: string;
}) {
  const q = useGitHubPRDeployments(target, account, headSha);
  const deployments = q.data ?? [];
  const groups = groupDeployments(deployments);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <ActionButton>
            Preview... <ChevronDown className="size-3" />
          </ActionButton>
        }
      />
      <DropdownMenuContent align="end" className="min-w-[280px]">
        {q.isLoading ? (
          <div className="flex items-center gap-2 px-2 py-3 text-[12px] text-muted-foreground/70">
            <Loader2 className="size-3 animate-spin" /> Loading deployments...
          </div>
        ) : deployments.length === 0 ? (
          <div className="px-2 py-3 text-[12px] text-muted-foreground/70">
            No deployments available.
          </div>
        ) : (
          <>
            <DeployGroup title="Preview" items={groups.preview} />
            <DeployGroup title="Production" items={groups.production} />
            <DeployGroup title="Other" items={groups.others} />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DeployGroup({
  title,
  items,
}: {
  title: string;
  items: DeploymentSummary[];
}) {
  if (items.length === 0) return null;
  return (
    <>
      <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground/70">
        {title}
      </div>
      {items.map((d) => {
        const url = d.url ?? d.logUrl;
        return (
          <DropdownMenuItem
            key={d.id}
            onClick={() =>
              url ? window.open(url, "_blank", "noopener,noreferrer") : undefined
            }
            className="flex items-start gap-2"
          >
            <span
              className={`mt-1 size-2 shrink-0 rounded-md ${stateDotClass(d.state)}`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
                {d.environment}
                <span className="text-muted-foreground/70">· {d.state}</span>
              </div>
              {url ? (
                <div className="truncate text-[11px] text-muted-foreground/70">
                  {url}
                </div>
              ) : null}
              <div className="text-[10px] text-muted-foreground/60">
                {new Date(d.updatedAt).toLocaleString()}
              </div>
            </div>
            {url ? (
              <ExternalLink className="mt-1 size-3 shrink-0 opacity-60" />
            ) : null}
          </DropdownMenuItem>
        );
      })}
      <DropdownMenuSeparator />
    </>
  );
}

export function PRActionBar({
  pr,
  account,
  target,
  pendingReviewCount = 0,
}: {
  pr: PR;
  account?: OAuthConnection | null;
  target?: ReviewTarget;
  pendingReviewCount?: number;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const branchName = pr.head.ref;
  const repoFull = pr.base.repo.full_name;
  const checkoutCmd = `gh pr checkout ${pr.number} --repo ${repoFull}`;

  return (
    <div className="flex items-center gap-1.5">
      {account && target ? (
        <>
          <LabelEditor target={target} account={account} item={pr} />
          <AssigneePicker target={target} account={account} item={pr} />
          <ReviewersPicker target={target} account={account} pr={pr} />
          <MilestonePicker target={target} account={account} item={pr} />
          <CloseReopenButton
            target={target}
            account={account}
            state={pr.state as "open" | "closed"}
            stateReason={null}
          />
        </>
      ) : null}
      {account && target ? (
        <PreviewDeploysDropdown
          target={target}
          account={account}
          headSha={pr.head.sha}
        />
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <ActionButton>
                Preview... <ChevronDown className="size-3" />
              </ActionButton>
            }
          />
          <DropdownMenuContent align="end" className="min-w-[220px]">
            <div className="px-2 py-3 text-[12px] text-muted-foreground/70">
              No deployments available.
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {account && target ? (
        <Popover open={reviewOpen} onOpenChange={setReviewOpen}>
          <PopoverTrigger
            render={
              <ActionButton variant="primary">
                <span className="inline-flex size-4 items-center justify-center rounded-md bg-white/20 text-[10px] font-semibold">
                  {pendingReviewCount}
                </span>
                Finish review
                <ChevronDown className="size-3" />
              </ActionButton>
            }
          />
          <PopoverContent align="end" className="w-auto p-4">
            <ReviewForm
              target={target}
              account={account}
              onSubmitted={() => setReviewOpen(false)}
            />
          </PopoverContent>
        </Popover>
      ) : (
        <ActionButton variant="primary">
          <span className="inline-flex size-4 items-center justify-center rounded-md bg-white/20 text-[10px] font-semibold">
            {pendingReviewCount}
          </span>
          Finish review
        </ActionButton>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="More actions"
            >
              <MoreHorizontal />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-[240px]">
          <DropdownMenuItem onClick={() => copy(pr.html_url)}>
            Copy link to PR
            <DropdownMenuShortcut>C L</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => copy(branchName)}>
            Copy PR branch name
            <DropdownMenuShortcut>C B</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => copy(checkoutCmd)}>
            Copy CLI checkout command
            <DropdownMenuShortcut>C C</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => window.open(pr.html_url, "_blank", "noopener,noreferrer")}
          >
            Open on GitHub
            <ExternalLink className="ml-auto size-3.5 opacity-60" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button type="button" variant="outline" size="default">
        Agent
        <ChevronDown />
      </Button>
    </div>
  );
}

function ReviewersPicker({
  target,
  account,
  pr,
}: {
  target: ReviewTarget;
  account: OAuthConnection;
  pr: PR;
}) {
  const candidates = useGitHubRepoAssignees(target, account);
  const mutate = useRequestReviewersMutation(target, account);
  const reviewers = (pr.requested_reviewers ?? []) as Array<{
    login: string;
    avatar_url: string;
  }>;
  const current = new Set(reviewers.map((r) => r.login));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <ActionButton>
            <Users className="size-3" />
            {reviewers.length > 0 ? reviewers.length : null}
            <ChevronDown className="size-3" />
          </ActionButton>
        }
      />
      <DropdownMenuContent align="end" className="min-w-[240px]">
        <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground/70">
          Reviewers
        </div>
        {candidates.isLoading ? (
          <div className="px-2 py-2 text-[12px] text-muted-foreground/70">
            Loading...
          </div>
        ) : (candidates.data ?? []).length === 0 ? (
          <div className="px-2 py-2 text-[12px] text-muted-foreground/70">
            No suggestions
          </div>
        ) : (
          (candidates.data ?? []).map((a) => {
            const active = current.has(a.login);
            return (
              <DropdownMenuItem
                key={a.id}
                onClick={(e) => {
                  e.preventDefault();
                  mutate.mutate({ login: a.login, enabled: !active });
                }}
                className="flex items-center gap-2"
              >
                <Checkbox checked={active} />
                <Avatar className="size-5">
                  <AvatarImage src={a.avatar_url} alt={a.login} />
                  <AvatarFallback>{a.login.slice(0, 1)}</AvatarFallback>
                </Avatar>
                <span className="truncate text-[12px]">{a.login}</span>
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LabelEditor({
  target,
  account,
  item,
}: {
  target: ReviewTarget;
  account: OAuthConnection;
  item: Labelable;
}) {
  const labels = useGitHubRepoLabels(target, account);
  const mutate = useIssueLabelsMutation(target, account);
  const current = new Set(
    item.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))),
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <ActionButton>
            Labels <ChevronDown className="size-3" />
          </ActionButton>
        }
      />
      <DropdownMenuContent align="end" className="min-w-[240px]">
        <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground/70">
          Labels
        </div>
        {labels.isLoading ? (
          <div className="px-2 py-2 text-[12px] text-muted-foreground/70">
            Loading...
          </div>
        ) : (labels.data ?? []).length === 0 ? (
          <div className="px-2 py-2 text-[12px] text-muted-foreground/70">
            No labels
          </div>
        ) : (
          (labels.data ?? []).map((l) => {
            const active = current.has(l.name);
            return (
              <DropdownMenuItem
                key={l.id}
                onClick={(e) => {
                  e.preventDefault();
                  mutate.mutate({ name: l.name, enabled: !active });
                }}
                className="flex items-center gap-2"
              >
                <Checkbox checked={active} />
                <span
                  className="size-2 rounded-md"
                  style={{ background: `#${l.color}` }}
                />
                <span className="truncate text-[12px]">{l.name}</span>
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AssigneePicker({
  target,
  account,
  item,
}: {
  target: ReviewTarget;
  account: OAuthConnection;
  item: Labelable;
}) {
  const assignees = useGitHubRepoAssignees(target, account);
  const mutate = useIssueAssigneesMutation(target, account);
  const current = new Set((item.assignees ?? []).map((a) => a.login));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <ActionButton>
            Assignees <ChevronDown className="size-3" />
          </ActionButton>
        }
      />
      <DropdownMenuContent align="end" className="min-w-[240px]">
        <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground/70">
          Assign up to 10 users
        </div>
        {assignees.isLoading ? (
          <div className="px-2 py-2 text-[12px] text-muted-foreground/70">
            Loading...
          </div>
        ) : (assignees.data ?? []).length === 0 ? (
          <div className="px-2 py-2 text-[12px] text-muted-foreground/70">
            No suggested assignees
          </div>
        ) : (
          (assignees.data ?? []).map((a) => {
            const active = current.has(a.login);
            return (
              <DropdownMenuItem
                key={a.id}
                onClick={(e) => {
                  e.preventDefault();
                  mutate.mutate({ login: a.login, enabled: !active });
                }}
                className="flex items-center gap-2"
              >
                <Checkbox checked={active} />
                <Avatar className="size-5">
                  <AvatarImage src={a.avatar_url} alt={a.login} />
                  <AvatarFallback>{a.login.slice(0, 1)}</AvatarFallback>
                </Avatar>
                <span className="truncate text-[12px]">{a.login}</span>
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MilestonePicker({
  target,
  account,
  item,
}: {
  target: ReviewTarget;
  account: OAuthConnection;
  item: Labelable;
}) {
  const milestones = useGitHubRepoMilestones(target, account);
  const mutate = useIssueMilestoneMutation(target, account);
  const currentId = item.milestone?.id ?? null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <ActionButton>
            Milestone <ChevronDown className="size-3" />
          </ActionButton>
        }
      />
      <DropdownMenuContent align="end" className="min-w-[240px]">
        <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground/70">
          Milestone
        </div>
        <DropdownMenuItem
          onClick={() => mutate.mutate({ milestone: null })}
          className="text-[12px]"
        >
          {currentId == null ? "✓ " : ""}None
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {milestones.isLoading ? (
          <div className="px-2 py-2 text-[12px] text-muted-foreground/70">
            Loading...
          </div>
        ) : (
          (milestones.data ?? []).map((m) => (
            <DropdownMenuItem
              key={m.id}
              onClick={() => mutate.mutate({ milestone: m.number })}
              className="text-[12px]"
            >
              {currentId === m.id ? "✓ " : ""}
              {m.title}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CloseReopenButton({
  target,
  account,
  state,
  stateReason,
}: {
  target: ReviewTarget;
  account: OAuthConnection;
  state: "open" | "closed";
  stateReason?: string | null;
}) {
  const mutate = useIssueStateMutation(target, account);
  const [pending, setPending] = useState(false);
  const next = state === "open" ? "closed" : "open";
  const Icon =
    state === "open"
      ? XCircle
      : stateReason === "completed"
        ? CheckCircle2
        : CircleDot;
  return (
    <ActionButton
      onClick={() => {
        setPending(true);
        mutate.mutate(
          { state: next },
          { onSettled: () => setPending(false) },
        );
      }}
    >
      {pending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Icon className="size-3" />
      )}
      {state === "open" ? "Close" : "Reopen"}
    </ActionButton>
  );
}

export function IssueActionBar({
  issue,
  target,
  account,
}: {
  issue: Issue;
  target: ReviewTarget;
  account: OAuthConnection;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <LabelEditor target={target} account={account} item={issue} />
      <AssigneePicker target={target} account={account} item={issue} />
      <MilestonePicker target={target} account={account} item={issue} />
      <CloseReopenButton
        target={target}
        account={account}
        state={issue.state as "open" | "closed"}
        stateReason={issue.state_reason ?? null}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="More actions"
            >
              <MoreHorizontal />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-[220px]">
          <DropdownMenuItem onClick={() => copy(issue.html_url)}>
            Copy link
            <DropdownMenuShortcut>C L</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => window.open(issue.html_url, "_blank", "noopener,noreferrer")}
          >
            Open on GitHub
            <ExternalLink className="ml-auto size-3.5 opacity-60" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
