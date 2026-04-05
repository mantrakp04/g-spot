import { useState, useCallback, useRef, type KeyboardEvent } from "react";

import { Button } from "@g-spot/ui/components/button";
import { Input } from "@g-spot/ui/components/input";
import { Separator } from "@g-spot/ui/components/separator";
import { Textarea } from "@g-spot/ui/components/textarea";
import type { OAuthConnection } from "@stackframe/react";
import { Loader2, Send, Trash2, ChevronDown, Paperclip, X as XIcon } from "lucide-react";

import type { ComposeAttachment } from "@/contexts/drafts-context";
import type { ComposeMode, ComposeFormState } from "@/lib/gmail/types";
import { RecipientInput } from "./recipient-input";

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
  compact?: boolean;
  attachments?: ComposeAttachment[];
  onAddAttachments?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  googleAccount?: OAuthConnection | null;
};

function formatSavedAt(date: Date): string {
  return `Draft saved at ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  compact,
  attachments,
  onAddAttachments,
  onRemoveAttachment,
  googleAccount,
}: ComposeFormProps) {
  const [showCcBcc, setShowCcBcc] = useState(!!form.cc || !!form.bcc);
  const showSubject = mode === "new" || mode === "forward";
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      <div className="flex items-start gap-2">
        <span className="mt-1.5 w-12 shrink-0 text-xs text-muted-foreground">To</span>
        <RecipientInput
          value={form.to}
          onChange={(v) => onUpdateField("to", v)}
          placeholder="recipient@example.com"
          googleAccount={googleAccount ?? null}
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
        <div className="flex items-start gap-2">
          <span className="mt-1.5 w-12 shrink-0 text-xs text-muted-foreground">Cc</span>
          <RecipientInput
            value={form.cc}
            onChange={(v) => onUpdateField("cc", v)}
            placeholder="cc@example.com"
            googleAccount={googleAccount ?? null}
          />
        </div>
      )}

      {/* Bcc */}
      {showCcBcc && (
        <div className="flex items-start gap-2">
          <span className="mt-1.5 w-12 shrink-0 text-xs text-muted-foreground">Bcc</span>
          <RecipientInput
            value={form.bcc}
            onChange={(v) => onUpdateField("bcc", v)}
            placeholder="bcc@example.com"
            googleAccount={googleAccount ?? null}
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
        className={compact ? "min-h-24 resize-y text-sm" : "min-h-32 resize-y text-sm"}
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

      {/* Attachments */}
      {attachments && attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-xs"
            >
              <Paperclip className="size-3 shrink-0 text-muted-foreground" />
              <span className="max-w-[140px] truncate">{att.name}</span>
              <span className="shrink-0 text-muted-foreground">
                ({formatFileSize(att.size)})
              </span>
              {onRemoveAttachment && (
                <button
                  type="button"
                  className="ml-0.5 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => onRemoveAttachment(att.id)}
                >
                  <XIcon className="size-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Hidden file input */}
      {onAddAttachments && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) onAddAttachments(files);
            e.target.value = "";
          }}
        />
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
          {onAddAttachments && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSending}
            >
              <Paperclip className="size-3.5" />
            </Button>
          )}
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
