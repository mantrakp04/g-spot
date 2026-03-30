import { useState, useRef, useEffect, useCallback } from "react";

import type { ComposeFormState } from "@/lib/gmail/types";
import { buildRfc2822Message, encodeRfc2822ToBase64Url } from "@/lib/gmail/rfc2822";
import { createGmailDraft, updateGmailDraft } from "@/lib/gmail/api";

type UseAutoSaveDraftOptions = {
  form: ComposeFormState;
  fromEmail: string;
  draftId: string | null;
  getAccessToken: () => Promise<string>;
  enabled: boolean;
};

type UseAutoSaveDraftReturn = {
  draftId: string | null;
  isSaving: boolean;
  lastSavedAt: Date | null;
  cancelPendingSave: () => void;
};

function serializeForm(form: ComposeFormState): string {
  return `${form.to}|${form.cc}|${form.bcc}|${form.subject}|${form.body}`;
}

export function useAutoSaveDraft({
  form,
  fromEmail,
  draftId: initialDraftId,
  getAccessToken,
  enabled,
}: UseAutoSaveDraftOptions): UseAutoSaveDraftReturn {
  const [draftId, setDraftId] = useState<string | null>(initialDraftId);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastSavedRef = useRef<string>("");
  const draftIdRef = useRef<string | null>(initialDraftId);
  const dirtyRef = useRef(false);

  // Keep draftIdRef in sync
  useEffect(() => {
    draftIdRef.current = draftId;
  }, [draftId]);

  const cancelPendingSave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!enabled || !fromEmail) return;

    const serialized = serializeForm(form);

    // Mark dirty on first real change
    if (!dirtyRef.current) {
      lastSavedRef.current = serialized;
      dirtyRef.current = true;
      return;
    }

    // Skip if nothing changed since last save
    if (serialized === lastSavedRef.current) return;

    // Clear previous timer
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      // Abort any in-flight save
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const raw = encodeRfc2822ToBase64Url(
        buildRfc2822Message({
          from: fromEmail,
          to: form.to,
          cc: form.cc || undefined,
          bcc: form.bcc || undefined,
          subject: form.subject,
          body: form.body,
          inReplyTo: form.inReplyTo || undefined,
          references: form.references || undefined,
        }),
      );

      setIsSaving(true);
      try {
        const token = await getAccessToken();
        if (controller.signal.aborted) return;

        let result;
        if (draftIdRef.current) {
          result = await updateGmailDraft(token, draftIdRef.current, raw, form.threadId);
        } else {
          result = await createGmailDraft(token, raw, form.threadId);
        }

        if (controller.signal.aborted) return;

        setDraftId(result.id);
        draftIdRef.current = result.id;
        lastSavedRef.current = serialized;
        setLastSavedAt(new Date());
      } catch {
        // Silently fail — will retry on next change
      } finally {
        if (!controller.signal.aborted) {
          setIsSaving(false);
        }
      }
    }, 3000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [form.to, form.cc, form.bcc, form.subject, form.body, enabled, fromEmail, getAccessToken, form.inReplyTo, form.references, form.threadId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  return { draftId, isSaving, lastSavedAt, cancelPendingSave };
}
