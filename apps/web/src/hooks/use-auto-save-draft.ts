import { useState, useRef, useEffect, useCallback, useMemo } from "react";

import type { OAuthConnection } from "@hexclave/react";

import type { ComposeFormState } from "@/lib/gmail/types";
import { buildRfc2822Message, encodeRfc2822ToBase64Url } from "@/lib/gmail/rfc2822";
import { useSaveGmailDraftMutation } from "@/hooks/use-gmail-actions";

type UseAutoSaveDraftOptions = {
  form: ComposeFormState;
  fromEmail: string;
  draftId: string | null;
  googleAccount: OAuthConnection | null;
  enabled: boolean;
  onDraftIdChange?: (draftId: string) => void;
};

type UseAutoSaveDraftReturn = {
  draftId: string | null;
  isSaving: boolean;
  lastSavedAt: Date | null;
  cancelPendingSave: () => void;
};

export function useAutoSaveDraft({
  form,
  fromEmail,
  draftId: initialDraftId,
  googleAccount,
  enabled,
  onDraftIdChange,
}: UseAutoSaveDraftOptions): UseAutoSaveDraftReturn {
  const [draftIdOverride, setDraftIdOverride] = useState<{
    initialDraftId: string | null;
    draftId: string | null;
  } | null>(null);
  const draftId =
    draftIdOverride?.initialDraftId === initialDraftId
      ? draftIdOverride.draftId
      : initialDraftId;
  const setDraftId = useCallback((nextDraftId: string | null) => {
    setDraftIdOverride({ initialDraftId, draftId: nextDraftId });
  }, [initialDraftId]);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastSavedRef = useRef<string>("");
  const draftIdRef = useRef<string | null>(initialDraftId);
  const dirtyRef = useRef(false);
  const prevInitialDraftIdRef = useRef<string | null>(initialDraftId);
  const saveDraftMutation = useSaveGmailDraftMutation(googleAccount);
  const serializedForm = useMemo(
    () => `${form.to}|${form.cc}|${form.bcc}|${form.subject}|${form.body}`,
    [form.to, form.cc, form.bcc, form.subject, form.body],
  );

  draftIdRef.current = draftId;

  useEffect(() => {
    if (prevInitialDraftIdRef.current === initialDraftId) return;

    prevInitialDraftIdRef.current = initialDraftId;
    draftIdRef.current = initialDraftId;
    dirtyRef.current = false;
    lastSavedRef.current = serializedForm;
  }, [initialDraftId, serializedForm]);

  const clearPendingSave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
  }, []);

  const cancelPendingSave = useCallback(() => {
    clearPendingSave();
    setIsSaving(false);
  }, [clearPendingSave]);

  useEffect(() => {
    if (enabled) return;

    dirtyRef.current = false;
    lastSavedRef.current = serializedForm;
  }, [enabled, serializedForm]);

  useEffect(() => {
    if (!enabled || !fromEmail) return;

    // Mark dirty on first real change
    if (!dirtyRef.current) {
      lastSavedRef.current = serializedForm;
      dirtyRef.current = true;
      return;
    }

    // Skip if nothing changed since last save
    if (serializedForm === lastSavedRef.current) return;

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
        const result = await saveDraftMutation.mutateAsync({
          draftId: draftIdRef.current,
          raw,
          threadId: form.threadId,
        });

        if (controller.signal.aborted) return;

        setDraftId(result.id);
        draftIdRef.current = result.id;
        lastSavedRef.current = serializedForm;
        setLastSavedAt(new Date());
        onDraftIdChange?.(result.id);
      } catch {
        // Silently fail — will retry on next change
      } finally {
        if (!controller.signal.aborted) {
          setIsSaving(false);
        }
      }
    }, 3000);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [form.to, form.cc, form.bcc, form.subject, form.body, enabled, fromEmail, saveDraftMutation, form.inReplyTo, form.references, form.threadId, serializedForm, setDraftId, onDraftIdChange]);

  // Cleanup on unmount
  useEffect(() => {
    return clearPendingSave;
  }, [clearPendingSave]);

  return { draftId, isSaving, lastSavedAt, cancelPendingSave };
}
