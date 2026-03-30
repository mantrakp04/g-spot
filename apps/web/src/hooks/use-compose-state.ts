import { useState, useCallback } from "react";

import { useQueryClient } from "@tanstack/react-query";
import type { OAuthConnection } from "@stackframe/react";
import { toast } from "sonner";

import type {
  ComposeMode,
  ComposeFormState,
  GmailFullMessage,
  GmailThreadDetail,
} from "@/lib/gmail/types";
import { buildRfc2822Message, encodeRfc2822ToBase64Url } from "@/lib/gmail/rfc2822";
import {
  deleteGmailDraft,
  sendGmailDraft,
  sendGmailMessage,
  updateGmailDraft,
} from "@/lib/gmail/api";
import { useGoogleProfile } from "@/hooks/use-gmail-options";
import { useAutoSaveDraft } from "@/hooks/use-auto-save-draft";

const EMPTY_FORM: ComposeFormState = {
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  body: "",
  inReplyTo: "",
  references: "",
  threadId: null,
};

function stripHtmlTags(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent ?? "";
}

function buildQuotedText(msg: GmailFullMessage): string {
  const content = msg.bodyText ?? (msg.bodyHtml ? stripHtmlTags(msg.bodyHtml) : "");
  return content
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function buildForwardedBody(msg: GmailFullMessage): string {
  const header = [
    "---------- Forwarded message ----------",
    `From: ${msg.from.name} <${msg.from.email}>`,
    `Date: ${msg.date}`,
    `Subject: ${msg.subject}`,
    `To: ${msg.to}`,
    msg.cc ? `Cc: ${msg.cc}` : null,
    "",
  ]
    .filter(Boolean)
    .join("\n");

  const content = msg.bodyText ?? (msg.bodyHtml ? stripHtmlTags(msg.bodyHtml) : "");
  return `${header}\n${content}`;
}

function prefixSubject(subject: string, prefix: "Re" | "Fwd"): string {
  const re = new RegExp(`^${prefix}:\\s*`, "i");
  if (re.test(subject)) return subject;
  return `${prefix}: ${subject}`;
}

function filterOutEmail(addresses: string, exclude: string): string {
  return addresses
    .split(",")
    .map((a) => a.trim())
    .filter((a) => {
      const match = a.match(/<(.+?)>/);
      const email = match ? match[1] : a;
      return email.toLowerCase() !== exclude.toLowerCase();
    })
    .join(", ");
}

export type ComposeState = {
  isOpen: boolean;
  mode: ComposeMode;
  form: ComposeFormState;
  quotedContent: string | null;
  isSending: boolean;
  isSaving: boolean;
  lastSavedAt: Date | null;
  draftId: string | null;
  userEmail: string;
  openCompose: (
    mode: ComposeMode,
    detail?: GmailThreadDetail | null,
    message?: GmailFullMessage | null,
  ) => void;
  closeCompose: () => void;
  discardDraft: () => void;
  updateField: (field: keyof ComposeFormState, value: string) => void;
  send: () => Promise<void>;
  cancelPendingSave: () => void;
};

export function useComposeState(
  googleAccount: OAuthConnection | null,
): ComposeState {
  const queryClient = useQueryClient();
  const { data: profile } = useGoogleProfile(googleAccount);
  const userEmail = profile?.email ?? "";

  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<ComposeMode>("new");
  const [form, setForm] = useState<ComposeFormState>(EMPTY_FORM);
  const [quotedContent, setQuotedContent] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [externalDraftId, setExternalDraftId] = useState<string | null>(null);

  const getAccessToken = useCallback(async () => {
    if (!googleAccount) throw new Error("No Google account connected");
    const result = await googleAccount.getAccessToken();
    if (result.status === "error") throw new Error("Failed to get access token");
    return result.data.accessToken;
  }, [googleAccount]);

  const { draftId, isSaving, lastSavedAt, cancelPendingSave } = useAutoSaveDraft({
    form,
    fromEmail: userEmail,
    draftId: externalDraftId,
    getAccessToken,
    enabled: isOpen && !!userEmail,
  });

  const openCompose = useCallback(
    (
      newMode: ComposeMode,
      detail?: GmailThreadDetail | null,
      message?: GmailFullMessage | null,
    ) => {
      const msg = message ?? detail?.messages[detail.messages.length - 1];
      let newForm = { ...EMPTY_FORM };
      let quoted: string | null = null;

      if (newMode === "reply" && msg) {
        newForm.to = msg.from.email;
        newForm.subject = prefixSubject(detail?.subject ?? msg.subject, "Re");
        newForm.inReplyTo = msg.messageId;
        newForm.references = [msg.references, msg.messageId].filter(Boolean).join(" ");
        newForm.threadId = detail?.id ?? null;
        quoted = buildQuotedText(msg);
      } else if (newMode === "reply-all" && msg) {
        newForm.to = msg.from.email;
        const allCc = [msg.to, msg.cc].filter(Boolean).join(", ");
        newForm.cc = filterOutEmail(allCc, userEmail);
        newForm.subject = prefixSubject(detail?.subject ?? msg.subject, "Re");
        newForm.inReplyTo = msg.messageId;
        newForm.references = [msg.references, msg.messageId].filter(Boolean).join(" ");
        newForm.threadId = detail?.id ?? null;
        quoted = buildQuotedText(msg);
      } else if (newMode === "forward" && msg) {
        newForm.subject = prefixSubject(detail?.subject ?? msg.subject, "Fwd");
        newForm.body = buildForwardedBody(msg);
        newForm.threadId = null;
      }

      setForm(newForm);
      setQuotedContent(quoted);
      setMode(newMode);
      setExternalDraftId(null);
      setIsOpen(true);
    },
    [userEmail],
  );

  const closeCompose = useCallback(() => {
    cancelPendingSave();
    setIsOpen(false);
    setForm(EMPTY_FORM);
    setQuotedContent(null);
    setExternalDraftId(null);
  }, [cancelPendingSave]);

  const discardDraft = useCallback(async () => {
    cancelPendingSave();
    if (draftId) {
      try {
        const token = await getAccessToken();
        await deleteGmailDraft(token, draftId);
      } catch {
        // Best effort
      }
    }
    closeCompose();
  }, [draftId, getAccessToken, cancelPendingSave, closeCompose]);

  const updateField = useCallback(
    (field: keyof ComposeFormState, value: string) => {
      setForm((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const send = useCallback(async () => {
    setIsSending(true);
    cancelPendingSave();

    try {
      const token = await getAccessToken();

      // Build quoted content into the body for reply modes
      let fullBody = form.body.replace(/\n/g, "<br>");
      if (quotedContent && (mode === "reply" || mode === "reply-all")) {
        fullBody += `<br><br><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${quotedContent.replace(/\n/g, "<br>")}</blockquote>`;
      }

      const raw = encodeRfc2822ToBase64Url(
        buildRfc2822Message({
          from: userEmail,
          to: form.to,
          cc: form.cc || undefined,
          bcc: form.bcc || undefined,
          subject: form.subject,
          body: fullBody,
          inReplyTo: form.inReplyTo || undefined,
          references: form.references || undefined,
        }),
      );

      if (draftId) {
        await updateGmailDraft(token, draftId, raw, form.threadId);
        await sendGmailDraft(token, draftId);
      } else {
        await sendGmailMessage(token, raw);
      }

      toast.success("Email sent");
      await queryClient.invalidateQueries({ queryKey: ["gmail"] });
      closeCompose();
    } catch {
      toast.error("Failed to send email");
    } finally {
      setIsSending(false);
    }
  }, [
    form,
    quotedContent,
    mode,
    draftId,
    userEmail,
    getAccessToken,
    queryClient,
    cancelPendingSave,
    closeCompose,
  ]);

  return {
    isOpen,
    mode,
    form,
    quotedContent,
    isSending,
    isSaving,
    lastSavedAt,
    draftId,
    userEmail,
    openCompose,
    closeCompose,
    discardDraft,
    updateField,
    send,
    cancelPendingSave,
  };
}
