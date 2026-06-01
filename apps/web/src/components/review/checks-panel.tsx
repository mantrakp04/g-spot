import { useEffect, useState, type ReactNode } from "react";
import { RotateCw } from "lucide-react";
import type { OAuthConnection } from "@hexclave/react";
import { toast } from "sonner";

import { Button } from "@g-spot/ui/components/button";

import {
  isFailedPrCiCheck,
  isPassingPrCiCheck,
  PrCiCheckItem,
  summarizePrCiChecks,
} from "@/components/github/pr-ci-check-item";
import type { CheckItem, ReviewTarget } from "@/hooks/use-github-detail";
import { useRerunCheckMutation } from "@/hooks/use-github-detail";

export function ChecksPanel({
  checks,
  target,
  account,
  headSha,
}: {
  checks: CheckItem[];
  target?: ReviewTarget;
  account?: OAuthConnection | null;
  headSha?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const targetKey = target
    ? `${target.kind}:${target.owner}/${target.repo}#${target.number}:${headSha ?? ""}`
    : headSha ?? "";

  useEffect(() => {
    setShowAll(false);
  }, [targetKey]);

  if (checks.length === 0) {
    return (
      <div className="text-[12px] italic text-muted-foreground/70">
        No checks yet.
      </div>
    );
  }

  const rollup = summarizePrCiChecks(checks);
  const hasPassingChecks = rollup.passed > 0;
  const visible = showAll ? checks : checks.filter((c) => !isPassingPrCiCheck(c));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-muted-foreground/70">
          {rollup.passed} passed · {rollup.failed} failed · {rollup.pending} pending
        </span>
        {showAll && hasPassingChecks ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => setShowAll(false)}
            className="h-auto p-0 text-muted-foreground/70"
          >
            Hide passing
          </Button>
        ) : hasPassingChecks ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => setShowAll(true)}
            className="h-auto p-0"
          >
            View all
          </Button>
        ) : null}
      </div>
      {visible.length > 0 ? (
        target && account ? (
          <RerunnableChecksList
            checks={visible}
            target={target}
            account={account}
            headSha={headSha}
          />
        ) : (
          <ChecksList checks={visible} />
        )
      ) : (
        <div className="rounded-md px-2 py-1 text-[12px] text-muted-foreground/70">
          All checks passing.
        </div>
      )}
    </div>
  );
}

function ChecksList({
  checks,
  renderAction,
}: {
  checks: CheckItem[];
  renderAction?: (check: CheckItem) => ReactNode;
}) {
  return (
    <ul className="space-y-0.5">
      {checks.map((c) => (
        <li key={c.id}>
          <PrCiCheckItem check={c} action={renderAction?.(c) ?? null} />
        </li>
      ))}
    </ul>
  );
}

function RerunnableChecksList({
  checks,
  target,
  account,
  headSha,
}: {
  checks: CheckItem[];
  target: ReviewTarget;
  account: OAuthConnection;
  headSha?: string;
}) {
  const rerun = useRerunCheckMutation(target, account, headSha);

  return (
    <ChecksList
      checks={checks}
      renderAction={(c) =>
        isFailedPrCiCheck(c) ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Retry ${c.name}`}
            title="Retry"
            onClick={(e) => {
              e.preventDefault();
              rerun.mutate(
                { check: c },
                {
                  onSuccess: () => toast.success(`Retrying ${c.name}`),
                  onError: (err) =>
                    toast.error(
                      err instanceof Error
                        ? err.message
                        : "Failed to retry check",
                    ),
                },
              );
            }}
            className="opacity-0 transition-opacity group-hover/check:opacity-100 focus-visible:opacity-100"
          >
            <RotateCw />
          </Button>
        ) : null
      }
    />
  );
}
