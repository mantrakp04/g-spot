import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@g-spot/ui/components/button";
import { cn } from "@g-spot/ui/lib/utils";
import type { OAuthConnection } from "@stackframe/react";
import { Minus, X, Reply, ReplyAll, Forward, Mail } from "lucide-react";
import { toast } from "sonner";

import { useAutoSaveDraft } from "@/hooks/use-auto-save-draft";
import {
  useDeleteGmailDraftMutation,
  useSendGmailMessageMutation,
} from "@/hooks/use-gmail-actions";
import { useGoogleProfile } from "@/hooks/use-gmail-options";
import { buildRfc2822Message, encodeRfc2822ToBase64Url, readFileAsBase64 } from "@/lib/gmail/rfc2822";
import type { DraftEntry } from "@/contexts/drafts-context";
import type { ComposeFormState } from "@/lib/gmail/types";
import { ComposeForm } from "./compose-form";

const MODE_COLORS: Record<string, string> = {
  new: "bg-primary",
  reply: "bg-emerald-500",
  "reply-all": "bg-sky-500",
  forward: "bg-amber-500",
};

const MODE_ICONS: Record<string, typeof Mail> = {
  new: Mail,
  reply: Reply,
  "reply-all": ReplyAll,
  forward: Forward,
};

type DraftPanelProps = {
  draft: DraftEntry;
  googleAccount: OAuthConnection | null;
  accounts?: OAuthConnection[];
  onUpdateField: (id: string, field: keyof ComposeFormState, value: string) => void;
  onSetGmailDraftId: (id: string, gmailDraftId: string) => void;
  onSetAccountId: (id: string, accountId: string | null) => void;
  onMinimize: (id: string) => void;
  onExpand: (id: string) => void;
  onClose: (id: string) => void;
  onAddAttachments: (id: string, files: File[]) => void;
  onRemoveAttachment: (id: string, attachmentId: string) => void;
};

export function DraftPanel({
  draft,
  googleAccount,
  accounts,
  onUpdateField,
  onSetGmailDraftId,
  onSetAccountId,
  onMinimize,
  onExpand,
  onClose,
  onAddAttachments,
  onRemoveAttachment,
}: DraftPanelProps) {
  const { data: profile } = useGoogleProfile(googleAccount);
  const userEmail = profile?.email ?? "";
  const deleteDraftMutation = useDeleteGmailDraftMutation(googleAccount);
  const sendMessageMutation = useSendGmailMessageMutation(googleAccount);
  const closedRef = useRef(false);

  const handleDraftIdChange = useCallback(
    (gmailDraftId: string) => {
      if (!closedRef.current) {
        onSetGmailDraftId(draft.id, gmailDraftId);
      }
    },
    [draft.id, onSetGmailDraftId],
  );

  const { draftId, isSaving, lastSavedAt, cancelPendingSave } = useAutoSaveDraft({
    form: draft.form,
    fromEmail: userEmail,
    draftId: draft.gmailDraftId,
    googleAccount,
    enabled: !!userEmail,
    onDraftIdChange: handleDraftIdChange,
  });

  useEffect(() => {
    return () => {
      closedRef.current = true;
    };
  }, []);

  const handleDiscard = useCallback(async () => {
    cancelPendingSave();
    if (draftId) {
      try {
        await deleteDraftMutation.mutateAsync({
          draftId,
          threadId: draft.form.threadId,
        });
      } catch {
        // Best effort
      }
    }
    onClose(draft.id);
  }, [draftId, draft.form.threadId, draft.id, deleteDraftMutation, cancelPendingSave, onClose]);

  const handleSend = useCallback(async () => {
    cancelPendingSave();
    try {
      let fullBody = draft.form.body.replace(/\n/g, "<br>");
      if (draft.quotedContent && (draft.mode === "reply" || draft.mode === "reply-all")) {
        fullBody += `<br><br><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${draft.quotedContent.replace(/\n/g, "<br>")}</blockquote>`;
      }

      const messageAttachments = await Promise.all(
        draft.attachments.map(async (att) => ({
          name: att.name,
          type: att.type,
          data: await readFileAsBase64(att.file),
        })),
      );

      const raw = encodeRfc2822ToBase64Url(
        buildRfc2822Message({
          from: userEmail,
          to: draft.form.to,
          cc: draft.form.cc || undefined,
          bcc: draft.form.bcc || undefined,
          subject: draft.form.subject,
          body: fullBody,
          inReplyTo: draft.form.inReplyTo || undefined,
          references: draft.form.references || undefined,
          attachments: messageAttachments.length > 0 ? messageAttachments : undefined,
        }),
      );

      await sendMessageMutation.mutateAsync({
        draftId,
        raw,
        threadId: draft.form.threadId,
      });

      toast.success("Email sent");
      onClose(draft.id);
    } catch {
      toast.error("Failed to send email");
    }
  }, [
    draft,
    draftId,
    userEmail,
    sendMessageMutation,
    cancelPendingSave,
    onClose,
  ]);

  const handleClose = useCallback(() => {
    cancelPendingSave();
    onClose(draft.id);
  }, [cancelPendingSave, draft.id, onClose]);

  const handleUpdateField = useCallback(
    (field: keyof ComposeFormState, value: string) => {
      onUpdateField(draft.id, field, value);
    },
    [draft.id, onUpdateField],
  );

  const handleAccountIdChange = useCallback(
    (accountId: string) => {
      cancelPendingSave();
      onSetAccountId(draft.id, accountId);
    },
    [cancelPendingSave, draft.id, onSetAccountId],
  );

  const isMinimized = draft.windowState === "minimized";
  const ModeIcon = MODE_ICONS[draft.mode] ?? Mail;
  const accentColor = MODE_COLORS[draft.mode] ?? "bg-primary";

  const displayLabel = draft.form.subject || draft.label;

  const [bodyHeight, setBodyHeight] = useState(380);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = bodyHeight;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = startY - ev.clientY;
        setBodyHeight(Math.max(150, Math.min(700, startHeight + delta)));
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [bodyHeight],
  );

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-t-lg border border-b-0 bg-card shadow-lg",
        "transition-[width] duration-200 ease-out",
        isMinimized ? "w-64" : "w-96",
      )}
    >
      {/* Resize handle — visible when expanded */}
      {!isMinimized && (
        <div
          className="flex h-2 cursor-ns-resize items-center justify-center transition-colors hover:bg-muted/50"
          onMouseDown={handleResizeStart}
        >
          <div className="h-0.5 w-8 rounded-full bg-border" />
        </div>
      )}

      {/* Header bar */}
      <button
        type="button"
        className={cn(
          "flex h-10 shrink-0 cursor-pointer items-center gap-2 border-b px-3",
          "bg-muted/50 transition-colors hover:bg-muted",
        )}
        onClick={() => isMinimized ? onExpand(draft.id) : onMinimize(draft.id)}
      >
        <div className={cn("h-4 w-1 shrink-0 rounded-full", accentColor)} />
        <ModeIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-left text-xs font-medium">
          {displayLabel}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <span
            role="button"
            tabIndex={0}
            className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              isMinimized ? onExpand(draft.id) : onMinimize(draft.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                isMinimized ? onExpand(draft.id) : onMinimize(draft.id);
              }
            }}
          >
            <Minus className="size-3" />
          </span>
          <span
            role="button"
            tabIndex={0}
            className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              handleClose();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                handleClose();
              }
            }}
          >
            <X className="size-3" />
          </span>
        </div>
      </button>

      {/* Form body — collapsed when minimized */}
      {!isMinimized && (
        <div className="overflow-y-auto p-3" style={{ height: bodyHeight }}>
          <ComposeForm
            mode={draft.mode}
            form={draft.form}
            onUpdateField={handleUpdateField}
            accountId={draft.accountId}
            onAccountIdChange={handleAccountIdChange}
            onSend={handleSend}
            onDiscard={handleDiscard}
            onClose={handleClose}
            isSaving={isSaving}
            isSending={sendMessageMutation.isPending}
            lastSavedAt={lastSavedAt}
            quotedContent={draft.quotedContent}
            attachments={draft.attachments}
            onAddAttachments={(files) => onAddAttachments(draft.id, files)}
            onRemoveAttachment={(attId) => onRemoveAttachment(draft.id, attId)}
            googleAccount={googleAccount}
            accounts={accounts}
            compact
          />
        </div>
      )}
    </div>
  );
}
