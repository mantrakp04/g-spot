import { Link, useNavigate } from "@tanstack/react-router";
import { useHotkeys } from "@tanstack/react-hotkeys";

import type { StackNode } from "@/hooks/use-github-detail";

function parseUrl(url: string) {
  const m = /github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/.exec(url);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]!, number: m[3]! };
}

/**
 * Graphite-style stack visualization: a vertical column of dots joined by
 * a line, one row per PR in the stack. Current PR is highlighted.
 * Supports `[` / `]` to navigate up/down the stack.
 */
export function StackViz({ nodes }: { nodes: StackNode[] }) {
  const navigate = useNavigate();
  const currentIdx = nodes.findIndex((n) => n.isCurrent);

  const jumpStack = (direction: -1 | 1) => {
    if (currentIdx < 0) return;
    const nextIdx =
      direction === 1
        ? Math.min(nodes.length - 1, currentIdx + 1)
        : Math.max(0, currentIdx - 1);
    const next = nodes[nextIdx];
    if (!next || next.isCurrent) return;
    const parsed = parseUrl(next.url);
    if (!parsed) return;
    void navigate({
      to: "/review/$kind/$owner/$repo/$number",
      params: {
        kind: "pr",
        owner: parsed.owner,
        repo: parsed.repo,
        number: parsed.number,
      },
    });
  };

  useHotkeys(
    [
      {
        hotkey: "[",
        callback: () => jumpStack(-1),
        options: { meta: { name: "Previous PR in stack" } },
      },
      {
        hotkey: "]",
        callback: () => jumpStack(1),
        options: { meta: { name: "Next PR in stack" } },
      },
    ],
    { enabled: nodes.length > 1 },
  );

  if (nodes.length <= 1) return null;
  return (
    <div className="space-y-0.5">
      <div className="mb-2 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
        <span>Stack</span>
        <span className="font-normal normal-case text-muted-foreground/50">
          <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">
            [
          </kbd>{" "}
          /{" "}
          <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">
            ]
          </kbd>
        </span>
      </div>
      <ol className="relative">
        {nodes.map((node, i) => {
          const parsed = parseUrl(node.url);
          const content = (
            <>
              <span className="text-muted-foreground/70">#{node.number}</span>{" "}
              <span className="line-clamp-1">{node.title}</span>
            </>
          );
          const cls = `flex-1 rounded-md px-1.5 py-1 text-[12px] leading-tight hover:bg-muted ${
            node.isCurrent
              ? "bg-muted/50 font-medium text-foreground"
              : "text-muted-foreground"
          }`;
          return (
            <li key={node.number} className="flex items-start gap-3">
              <StackDot
                state={node.state}
                isCurrent={node.isCurrent}
                isFirst={i === 0}
                isLast={i === nodes.length - 1}
              />
              {parsed && !node.isCurrent ? (
                <Link
                  to="/review/$kind/$owner/$repo/$number"
                  params={{
                    kind: "pr",
                    owner: parsed.owner,
                    repo: parsed.repo,
                    number: parsed.number,
                  }}
                  className={cls}
                >
                  {content}
                </Link>
              ) : (
                <div className={cls}>{content}</div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StackDot({
  state,
  isCurrent,
  isFirst,
  isLast,
}: {
  state: "open" | "closed" | "merged";
  isCurrent: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
  const color =
    state === "merged"
      ? "#8957e5"
      : state === "closed"
      ? "#e66d75"
      : "#34c486";
  return (
    <div className="relative flex w-3 shrink-0 flex-col items-center self-stretch">
      <div
        className={`w-px flex-1 ${isFirst ? "invisible" : ""}`}
        style={{ background: "var(--border)" }}
      />
      <div
        className="shrink-0 rounded-md"
        style={{
          width: isCurrent ? 10 : 7,
          height: isCurrent ? 10 : 7,
          background: color,
          boxShadow: isCurrent ? `0 0 0 2px var(--card)` : undefined,
          border: isCurrent ? `2px solid ${color}` : undefined,
        }}
      />
      <div
        className={`w-px flex-1 ${isLast ? "invisible" : ""}`}
        style={{ background: "var(--border)" }}
      />
    </div>
  );
}
