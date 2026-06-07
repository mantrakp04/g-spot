import { useState } from "react";

import { Button } from "@g-spot/ui/components/button";
import { Textarea } from "@g-spot/ui/components/textarea";
import { cn } from "@g-spot/ui/lib/utils";

export type { OnStartInlineComment } from "@/hooks/use-pending-comments";

export function InlineComposer({
  hasExistingDraft,
  onSubmit,
  onCancel,
  placement = "inline",
}: {
  hasExistingDraft: boolean;
  onSubmit: (body: string) => void;
  onCancel: () => void;
  placement?: "inline" | "side";
}) {
  const [body, setBody] = useState("");

  const handleSubmit = () => {
    if (!body.trim()) return;
    onSubmit(body);
    setBody("");
  };

  return (
    <div
      data-review-composer-placement={placement}
      className={cn(
        "space-y-2 px-3 py-3",
        placement === "side"
          ? "rounded-md border shadow-sm"
          : "border-y",
      )}
      style={{
        background: "var(--diffs-bg-buffer, var(--muted))",
        color: "var(--diffs-fg, var(--foreground))",
        borderColor: "var(--diffs-bg-separator, var(--border))",
        fontFamily: "var(--diffs-font-family, inherit)",
      }}
    >
      <Textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Leave a comment..."
        className="min-h-[80px] resize-y text-[12px]"
        style={{
          background: "var(--diffs-bg, var(--card))",
          color: "var(--diffs-fg, var(--foreground))",
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            handleSubmit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="flex items-center justify-end gap-1.5">
        <Button type="button" variant="ghost" size="default" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="default"
          onClick={handleSubmit}
          disabled={!body.trim()}
        >
          {hasExistingDraft ? "Add to review" : "Start review"}
        </Button>
      </div>
    </div>
  );
}
