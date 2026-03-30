import { useState, useCallback, type KeyboardEvent } from "react";

import { Button } from "@g-spot/ui/components/button";
import { Input } from "@g-spot/ui/components/input";
import { Separator } from "@g-spot/ui/components/separator";
import { Textarea } from "@g-spot/ui/components/textarea";
import { Loader2, Send, Trash2, ChevronDown } from "lucide-react";

import type { ComposeMode, ComposeFormState } from "@/lib/gmail/types";

type ComposeFormProps = {
  mode: ComposeMode;
  form: ComposeFormState;
  onUpdateField: (field: keyof ComposeFormState, value: string) => void;
  onSend: () => void;
  onDiscard: () => void;
  onClose: () => void;
  isSaving: boolean;
  isSending: boolean;
  lastSavedAt: Date | null;
  quotedContent: string | null;
};

function formatSavedAt(date: Date): string {
  return `Draft saved at ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

export function ComposeForm({
  mode,
  form,
  onUpdateField,
  onSend,
  onDiscard,
  isSaving,
  isSending,
  lastSavedAt,
  quotedContent,
}: ComposeFormProps) {
  const [showCcBcc, setShowCcBcc] = useState(!!form.cc || !!form.bcc);
  const showSubject = mode === "new" || mode === "forward";

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        onSend();
      }
    },
    [onSend],
  );

  return (
    <div className="flex flex-col gap-2">
      {/* To */}
      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0 text-xs text-muted-foreground">To</span>
        <Input
          value={form.to}
          onChange={(e) => onUpdateField("to", e.target.value)}
          placeholder="recipient@example.com"
          className="h-7 text-sm"
        />
        {!showCcBcc && (
          <Button
            variant="ghost"
            size="xs"
            className="shrink-0 text-xs text-muted-foreground"
            onClick={() => setShowCcBcc(true)}
          >
            Cc/Bcc
          </Button>
        )}
      </div>

      {/* Cc */}
      {showCcBcc && (
        <div className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-xs text-muted-foreground">Cc</span>
          <Input
            value={form.cc}
            onChange={(e) => onUpdateField("cc", e.target.value)}
            placeholder="cc@example.com"
            className="h-7 text-sm"
          />
        </div>
      )}

      {/* Bcc */}
      {showCcBcc && (
        <div className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-xs text-muted-foreground">Bcc</span>
          <Input
            value={form.bcc}
            onChange={(e) => onUpdateField("bcc", e.target.value)}
            placeholder="bcc@example.com"
            className="h-7 text-sm"
          />
        </div>
      )}

      {/* Subject */}
      {showSubject && (
        <>
          <Separator />
          <div className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-xs text-muted-foreground">Subject</span>
            <Input
              value={form.subject}
              onChange={(e) => onUpdateField("subject", e.target.value)}
              placeholder="Subject"
              className="h-7 text-sm"
            />
          </div>
        </>
      )}

      <Separator />

      {/* Body */}
      <Textarea
        value={form.body}
        onChange={(e) => onUpdateField("body", e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Write your message..."
        className="min-h-32 resize-y text-sm"
      />

      {/* Quoted content */}
      {quotedContent && (
        <details className="group text-xs text-muted-foreground">
          <summary className="flex cursor-pointer items-center gap-1">
            <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
            <span>Original message</span>
          </summary>
          <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded border bg-muted/30 p-2 font-sans text-xs">
            {quotedContent}
          </pre>
        </details>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1">
        <span className="text-xs text-muted-foreground">
          {isSaving
            ? "Saving draft..."
            : lastSavedAt
              ? formatSavedAt(lastSavedAt)
              : ""}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onDiscard}
            disabled={isSending}
          >
            <Trash2 className="size-3.5" />
            Discard
          </Button>
          <Button
            size="sm"
            onClick={onSend}
            disabled={isSending || !form.to.trim()}
          >
            {isSending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
