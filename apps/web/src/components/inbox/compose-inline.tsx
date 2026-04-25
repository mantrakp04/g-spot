import { useCallback } from "react";

import { Separator } from "@g-spot/ui/components/separator";
import type { OAuthConnection } from "@stackframe/react";
import { toast } from "sonner";

import type { DraftEntry } from "@/contexts/drafts-context";
import { useDrafts } from "@/contexts/drafts-context";
import { useAutoSaveDraft } from "@/hooks/use-auto-save-draft";
import {
  useDeleteGmailDraftMutation,
  useSendGmailMessageMutation,
} from "@/hooks/use-gmail-actions";
import { useGoogleProfile } from "@/hooks/use-gmail-options";
import { buildRfc2822Message, encodeRfc2822ToBase64Url, readFileAsBase64 } from "@/lib/gmail/rfc2822";
import type { ComposeFormState } from "@/lib/gmail/types";
import { ComposeForm } from "./compose-form";

type ComposeInlineProps = {
  draft: DraftEntry;
  googleAccount: OAuthConnection | null;
  accounts?: OAuthConnection[];
};

export function ComposeInline({ draft, googleAccount, accounts }: ComposeInlineProps) {
  const { updateField, setGmailDraftId, setAccountId, closeDraft, setInlineDraft, addAttachments, removeAttachment } = useDrafts();
  const { data: profile } = useGoogleProfile(googleAccount);
  const userEmail = profile?.email ?? "";
  const deleteDraftMutation = useDeleteGmailDraftMutation(googleAccount);
  const sendMessageMutation = useSendGmailMessageMutation(googleAccount);

  const handleDraftIdChange = useCallback(
    (gmailDraftId: string) => {
      setGmailDraftId(draft.id, gmailDraftId);
    },
    [draft.id, setGmailDraftId],
  );

  const { draftId, isSaving, lastSavedAt, cancelPendingSave } = useAutoSaveDraft({
    form: draft.form,
    fromEmail: userEmail,
    draftId: draft.gmailDraftId,
    googleAccount,
    enabled: !!userEmail,
    onDraftIdChange: handleDraftIdChange,
  });

  const handleUpdateField = useCallback(
    (field: keyof ComposeFormState, value: string) => {
      updateField(draft.id, field, value);
    },
    [draft.id, updateField],
  );

  const handleAccountIdChange = useCallback(
    (accountId: string) => {
      cancelPendingSave();
      setAccountId(draft.id, accountId);
    },
    [cancelPendingSave, draft.id, setAccountId],
  );

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
    setInlineDraft(null);
    closeDraft(draft.id);
  }, [draftId, draft.form.threadId, draft.id, deleteDraftMutation, cancelPendingSave, closeDraft, setInlineDraft]);

  const handleClose = useCallback(() => {
    cancelPendingSave();
    setInlineDraft(null);
    closeDraft(draft.id);
  }, [cancelPendingSave, draft.id, closeDraft, setInlineDraft]);

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
      setInlineDraft(null);
      closeDraft(draft.id);
    } catch {
      toast.error("Failed to send email");
    }
  }, [
    draft,
    draftId,
    userEmail,
    sendMessageMutation,
    cancelPendingSave,
    closeDraft,
    setInlineDraft,
  ]);

  return (
    <>
      <Separator />
      <div className="px-6 py-4">
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
          onAddAttachments={(files) => addAttachments(draft.id, files)}
          onRemoveAttachment={(attId) => removeAttachment(draft.id, attId)}
          googleAccount={googleAccount}
          accounts={accounts}
        />
      </div>
    </>
  );
}
