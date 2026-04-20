import { useState } from "react";

import { Button } from "@g-spot/ui/components/button";
import { Textarea } from "@g-spot/ui/components/textarea";

export type { OnStartInlineComment } from "@/hooks/use-pending-comments";

export function InlineComposer({
  hasExistingDraft,
  onSubmit,
  onCancel,
}: {
  hasExistingDraft: boolean;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState("");

  const handleSubmit = () => {
    if (!body.trim()) return;
    onSubmit(body);
    setBody("");
  };

  return (
    <div className="space-y-2 border-y border-border/50 bg-muted px-3 py-3">
      <Textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Leave a comment..."
        className="min-h-[80px] resize-y bg-card text-[12px]"
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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 rounded-sm px-2.5 text-[12px]"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 rounded-sm px-2.5 text-[12px]"
          onClick={handleSubmit}
          disabled={!body.trim()}
        >
          {hasExistingDraft ? "Add to review" : "Start review"}
        </Button>
      </div>
    </div>
  );
}
