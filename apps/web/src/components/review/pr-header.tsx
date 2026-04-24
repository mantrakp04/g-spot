import { useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronsUpDown, Copy, ExternalLink, GitPullRequest } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { OAuthConnection } from "@stackframe/react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@g-spot/ui/components/alert-dialog";
import {
  Command,
  CommandEmpty,
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

import type { ReviewTarget, StackNode } from "@/hooks/use-github-detail";
import {
  useGitHubRepoBranches,
  useUpdatePRBaseMutation,
} from "@/hooks/use-github-detail";

import { StackViz } from "./stack-viz";

type PRHeaderProps = {
  repoLabel: string;
  number: number;
  title: string;
  url: string;
  author: { login: string; avatarUrl: string } | null;
  headBranch: string;
  baseBranch: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  updatedAgo: string;
  stack: StackNode[];
  target: ReviewTarget;
  account: OAuthConnection | null;
  canChangeBase: boolean;
};

function BranchChip({ name }: { name: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(name);
      toast.success("Branch name copied");
    } catch {
      toast.error("Failed to copy branch name");
    }
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5">
      <code className="font-mono text-[12px] text-foreground">{name}</code>
      <button
        type="button"
        onClick={copy}
        className="text-muted-foreground/70 hover:text-foreground"
        aria-label={`Copy ${name}`}
        title="Copy branch name"
      >
        <Copy className="size-3" />
      </button>
    </span>
  );
}

function BaseBranchSelector({
  target,
  account,
  baseBranch,
  disabled,
}: {
  target: ReviewTarget;
  account: OAuthConnection | null;
  baseBranch: string;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const branches = useGitHubRepoBranches(target, account, open);
  const updateBase = useUpdatePRBaseMutation(target, account);

  const items = useMemo(() => branches.data ?? [], [branches.data]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(baseBranch);
      toast.success("Branch name copied");
    } catch {
      toast.error("Failed to copy branch name");
    }
  }

  async function confirmChange() {
    if (!pending) return;
    const next = pending;
    setPending(null);
    try {
      await updateBase.mutateAsync(next);
      toast.success(`Base branch changed to ${next}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to change base";
      toast.error(message);
    }
  }

  return (
    <>
      <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5">
        <code className="font-mono text-[12px] text-foreground">{baseBranch}</code>
        <button
          type="button"
          onClick={copy}
          className="text-muted-foreground/70 hover:text-foreground"
          aria-label={`Copy ${baseBranch}`}
          title="Copy branch name"
        >
          <Copy className="size-3" />
        </button>
        {!disabled ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  className="text-muted-foreground/70 hover:text-foreground"
                  aria-label="Change base branch"
                  title="Change base branch"
                />
              }
            >
              <ChevronsUpDown className="size-3" />
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="start">
              <Command>
                <CommandInput placeholder="Search branches..." />
                <CommandList>
                  <CommandEmpty>
                    {branches.isLoading ? "Loading..." : "No branches found."}
                  </CommandEmpty>
                  {items.map((b) => (
                    <CommandItem
                      key={b.name}
                      value={b.name}
                      onSelect={() => {
                        setOpen(false);
                        if (b.name !== baseBranch) setPending(b.name);
                      }}
                    >
                      {b.name === baseBranch ? (
                        <Check className="mr-2 size-3.5" />
                      ) : null}
                      <span className="truncate font-mono text-[12px]">{b.name}</span>
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        ) : null}
      </span>

      <AlertDialog open={!!pending} onOpenChange={(o) => { if (!o) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change base branch?</AlertDialogTitle>
            <AlertDialogDescription>
              This will update the pull request on GitHub to target{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">{pending}</code>{" "}
              instead of{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">{baseBranch}</code>.
              The diff and CI checks will re-run against the new base.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={updateBase.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={updateBase.isPending}
              onClick={(e) => {
                e.preventDefault();
                void confirmChange();
              }}
            >
              {updateBase.isPending ? "Updating..." : "Change base"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Full PR title header: repo/number, title, meta row, and stack viz. */
export function PRFullHeader(props: PRHeaderProps) {
  return (
    <header className="pb-6 pt-2">
      <div className="mb-1 flex items-center gap-2">
        <Link
          to="/"
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-muted hover:text-foreground"
          aria-label="Back to inbox"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="text-[13px] text-muted-foreground/70">
          {props.repoLabel}{" "}
          <span className="text-muted-foreground">#{props.number}</span>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <h1 className="flex-1 text-[24px] font-medium leading-tight tracking-tight">
          {props.title}
        </h1>
        <a
          href={props.url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 text-muted-foreground/70 hover:text-muted-foreground"
          aria-label="Open on GitHub"
        >
          <ExternalLink className="size-4" />
        </a>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted-foreground">
        {props.author ? (
          <span className="inline-flex items-center gap-1.5">
            {props.author.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={props.author.avatarUrl}
                alt=""
                className="size-5 rounded-full"
              />
            ) : null}
            <span className="text-foreground">
              {props.author.login}
            </span>
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1.5">
          <BaseBranchSelector
            target={props.target}
            account={props.account}
            baseBranch={props.baseBranch}
            disabled={!props.canChangeBase}
          />
          <span className="text-muted-foreground/70">←</span>
          <BranchChip name={props.headBranch} />
        </span>
        <span className="ml-auto flex items-center gap-3 text-[12px]">
          <span>{props.filesChanged} files</span>
          <span className="font-mono text-emerald-500">
            +{props.additions.toLocaleString()}
          </span>
          <span className="font-mono text-rose-500">
            −{props.deletions.toLocaleString()}
          </span>
          <span>Updated {props.updatedAgo}</span>
        </span>
      </div>

      {props.stack.length > 1 ? (
        <div className="mt-5 rounded-md border border-border/50 bg-card p-4">
          <StackViz nodes={props.stack} />
        </div>
      ) : null}
    </header>
  );
}

/** Scroll-condensed top bar: small PR title + number next to a PR glyph. */
export function PRCondensedHeader({
  number,
  title,
}: {
  number: number;
  title: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-[13px]">
      <GitPullRequest className="size-4 text-primary" />
      <span className="text-muted-foreground/70">#{number}</span>
      <span className="truncate font-medium">{title}</span>
    </div>
  );
}

export function IssueFullHeader({
  repoLabel,
  number,
  title,
  url,
  author,
  createdAgo,
}: {
  repoLabel: string;
  number: number;
  title: string;
  url: string;
  author: { login: string; avatarUrl: string } | null;
  createdAgo: string;
}) {
  return (
    <header className="pb-6 pt-2">
      <div className="mb-1 flex items-center gap-2">
        <Link
          to="/"
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-muted hover:text-foreground"
          aria-label="Back to inbox"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="text-[13px] text-muted-foreground/70">
          {repoLabel}{" "}
          <span className="text-muted-foreground">#{number}</span>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <h1 className="flex-1 text-[24px] font-medium leading-tight tracking-tight">
          {title}
        </h1>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 text-muted-foreground/70 hover:text-muted-foreground"
          aria-label="Open on GitHub"
        >
          <ExternalLink className="size-4" />
        </a>
      </div>
      <div className="mt-3 flex items-center gap-2 text-[13px] text-muted-foreground">
        {author ? (
          <>
            {author.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={author.avatarUrl} alt="" className="size-5 rounded-full" />
            ) : null}
            <span className="text-foreground">{author.login}</span>
            <span className="text-muted-foreground/70">opened</span>
          </>
        ) : null}
        <span className="text-muted-foreground/70">{createdAgo}</span>
      </div>
    </header>
  );
}

export function IssueCondensedHeader({
  number,
  title,
}: {
  number: number;
  title: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-[13px]">
      <span className="size-4 rounded-md bg-emerald-500" />
      <span className="text-muted-foreground/70">#{number}</span>
      <span className="truncate font-medium">{title}</span>
    </div>
  );
}
