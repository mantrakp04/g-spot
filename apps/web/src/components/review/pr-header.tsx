import { ArrowLeft, ExternalLink, GitPullRequest } from "lucide-react";
import { Link } from "@tanstack/react-router";

import type { StackNode } from "@/hooks/use-github-detail";

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
};

/** Full PR title header: repo/number, title, meta row, and stack viz. */
export function PRFullHeader(props: PRHeaderProps) {
  return (
    <header className="pb-6 pt-2">
      <div className="mb-1 flex items-center gap-2">
        <Link
          to="/"
          className="flex size-6 items-center justify-center rounded-sm text-muted-foreground/70 hover:bg-muted hover:text-foreground"
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
          <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground">
            {props.headBranch}
          </code>
          <span className="text-muted-foreground/70">→</span>
          <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground">
            {props.baseBranch}
          </code>
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
        <div className="mt-5 rounded-lg border border-border/50 bg-card p-4">
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
          className="flex size-6 items-center justify-center rounded-sm text-muted-foreground/70 hover:bg-muted hover:text-foreground"
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
      <span className="size-4 rounded-full bg-emerald-500" />
      <span className="text-muted-foreground/70">#{number}</span>
      <span className="truncate font-medium">{title}</span>
    </div>
  );
}
