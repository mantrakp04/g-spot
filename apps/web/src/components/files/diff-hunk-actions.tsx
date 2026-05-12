import { Button } from "@g-spot/ui/components/button";
import { Spinner } from "@g-spot/ui/components/spinner";
import { useState } from "react";

import type { DiffMode } from "./diff-patch";
import { actionsForMode } from "./diff-patch";

const ACTION_LABEL: Record<"stage" | "unstage" | "revert", string> = {
  stage: "Stage",
  unstage: "Unstage",
  revert: "Revert",
};

type Props = {
  mode: DiffMode;
  hasSelection: boolean;
  onAction: (action: "stage" | "unstage" | "revert") => Promise<void>;
};

export function DiffHunkActions({ mode, hasSelection, onAction }: Props) {
  const [pending, setPending] = useState<"stage" | "unstage" | "revert" | null>(
    null,
  );
  const actions = actionsForMode(mode);

  const handle = async (a: "stage" | "unstage" | "revert") => {
    if (pending) return;
    setPending(a);
    try {
      await onAction(a);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="pointer-events-auto inline-flex items-center gap-1 rounded-md border border-border/70 bg-popover/95 px-1 py-0.5 shadow-sm backdrop-blur-sm">
      {actions.map((a) => {
        const label = hasSelection
          ? `${ACTION_LABEL[a]} Selected Ranges`
          : `${ACTION_LABEL[a]} Hunk`;
        const isPending = pending === a;
        return (
          <Button
            key={a}
            type="button"
            size="xs"
            variant="ghost"
            disabled={pending !== null}
            onClick={() => void handle(a)}
            className="h-5 px-2 text-[10px]"
          >
            {isPending ? <Spinner className="size-2.5" /> : null}
            {label}
          </Button>
        );
      })}
    </div>
  );
}
