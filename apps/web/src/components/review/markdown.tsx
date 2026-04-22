import { createContext, memo, useContext, useState } from "react";
import { Streamdown } from "streamdown";
import { Check, Loader2 } from "lucide-react";
import type { OAuthConnection } from "@stackframe/react";

import { cn } from "@g-spot/ui/lib/utils";
import { useApplySuggestionMutation } from "@/hooks/use-github-detail";

export type SuggestionAnchor = {
  path: string;
  side: "LEFT" | "RIGHT";
  line: number;
  startLine: number | null;
  prHeadRef: string;
  baseRepoFull: string;
  account: OAuthConnection;
};

/**
 * Provided by inline-thread so nested markdown renderers know which file/range
 * a `suggestion` fenced block refers to, and can call the apply mutation.
 */
export const SuggestionContext = createContext<SuggestionAnchor | null>(null);

function SuggestionBlock({ code }: { code: string }) {
  const anchor = useContext(SuggestionContext);
  const [owner, repo] = (anchor?.baseRepoFull ?? "").split("/");
  const mutate = useApplySuggestionMutation(
    owner && repo ? { owner, repo } : { owner: "", repo: "" },
    anchor?.account ?? null,
  );
  const [applied, setApplied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canApply = !!anchor && !!owner && !!repo;
  return (
    <div className="my-3 overflow-hidden rounded-md border border-emerald-500/40 bg-emerald-500/5">
      <div className="flex items-center justify-between border-b border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
        Suggested change
        {canApply ? (
          <button
            type="button"
            disabled={mutate.isPending || applied}
            onClick={() => {
              if (!anchor) return;
              const startLine = anchor.startLine ?? anchor.line;
              setErr(null);
              mutate.mutate(
                {
                  path: anchor.path,
                  branch: anchor.prHeadRef,
                  startLine,
                  endLine: anchor.line,
                  replacement: code.replace(/\n$/, ""),
                },
                {
                  onSuccess: () => setApplied(true),
                  onError: (e) =>
                    setErr(e instanceof Error ? e.message : "Failed to apply"),
                },
              );
            }}
            className="inline-flex h-6 items-center gap-1 rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-2 text-[11px] font-medium text-emerald-700 hover:bg-emerald-500/20 disabled:opacity-60 dark:text-emerald-300"
          >
            {mutate.isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : applied ? (
              <Check className="size-3" />
            ) : null}
            {applied ? "Applied" : "Apply suggestion"}
          </button>
        ) : null}
      </div>
      <pre className="m-0 overflow-x-auto bg-transparent px-3 py-2 font-mono text-[12px] leading-relaxed">
        <code>{code}</code>
      </pre>
      {err ? (
        <div className="border-t border-border/50 bg-muted px-3 py-1.5 text-[11px] text-destructive">
          {err}
        </div>
      ) : null}
    </div>
  );
}

// Streamdown's default `a` renders a `<button>` with click-through, and its
// default `img` wraps in `<div data-streamdown="image-wrapper">` with a hover
// overlay. Both explode in review markdown (`[![img](…)](…)` and `<img>`
// inside `<p>`), so render plain elements instead.
const components = {
  a: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} target="_blank" rel="noreferrer" {...rest}>
      {children}
    </a>
  ),
  img: ({ src, alt, ...rest }: React.ImgHTMLAttributes<HTMLImageElement>) => (
    <img src={src} alt={alt ?? ""} loading="lazy" {...rest} />
  ),
  pre: (props: React.HTMLAttributes<HTMLPreElement>) => {
    // Detect fenced ```suggestion blocks and render a distinct apply UI.
    const child = (props as { children?: React.ReactNode }).children;
    if (child && typeof child === "object" && "props" in (child as object)) {
      const codeEl = child as React.ReactElement<{
        className?: string;
        children?: React.ReactNode;
      }>;
      const lang = codeEl.props.className ?? "";
      if (lang.includes("language-suggestion")) {
        const text = String(codeEl.props.children ?? "");
        return <SuggestionBlock code={text} />;
      }
    }
    return <pre {...props} />;
  },
} as const;

/**
 * GitHub-flavored markdown renderer for PR/issue bodies and comments.
 * Thin wrapper over Streamdown with typography tuned for the Graphite scope.
 */
export const Markdown = memo(
  ({ children, className }: { children: string; className?: string }) => (
    <Streamdown
      components={components}
      className={cn(
        "prose prose-invert max-w-none text-[14px] leading-relaxed",
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        "[&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_pre]:my-3",
        "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:my-1",
        "[&_a]:text-primary [&_a]:no-underline hover:[&_a]:underline",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[13px]",
        "[&_pre]:rounded-md [&_pre]:border [&_pre]:border-border/50 [&_pre]:bg-muted",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_h1]:text-[20px] [&_h2]:text-[17px] [&_h3]:text-[15px] [&_h1]:font-medium [&_h2]:font-medium [&_h3]:font-medium",
        "[&_table]:border-collapse [&_th]:border [&_th]:border-border/50 [&_th]:px-2 [&_th]:py-1",
        "[&_td]:border [&_td]:border-border/50 [&_td]:px-2 [&_td]:py-1",
        className,
      )}
    >
      {children}
    </Streamdown>
  ),
  (a, b) => a.children === b.children,
);
Markdown.displayName = "Markdown";
