import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";

import type { ComposeFormState, ComposeMode } from "@/lib/gmail/types";

export type ComposeAttachment = {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
};

export type DraftEntry = {
  id: string;
  mode: ComposeMode;
  form: ComposeFormState;
  quotedContent: string | null;
  gmailDraftId: string | null;
  windowState: "minimized" | "open";
  label: string;
  accountId: string | null;
  attachments: ComposeAttachment[];
};

type DraftsState = {
  drafts: DraftEntry[];
  /** Draft ID currently rendered inline in thread detail (not in dock) */
  inlineDraftId: string | null;
};

type DraftsAction =
  | { type: "ADD"; entry: DraftEntry }
  | { type: "REMOVE"; id: string }
  | { type: "MINIMIZE"; id: string }
  | { type: "EXPAND"; id: string }
  | { type: "UPDATE_FIELD"; id: string; field: keyof ComposeFormState; value: string }
  | { type: "SET_GMAIL_DRAFT_ID"; id: string; gmailDraftId: string }
  | { type: "SET_INLINE"; id: string | null }
  | { type: "UPDATE_LABEL"; id: string; label: string }
  | { type: "ADD_ATTACHMENTS"; id: string; attachments: ComposeAttachment[] }
  | { type: "REMOVE_ATTACHMENT"; id: string; attachmentId: string };

function reducer(state: DraftsState, action: DraftsAction): DraftsState {
  switch (action.type) {
    case "ADD":
      return { ...state, drafts: [...state.drafts, action.entry] };
    case "REMOVE":
      return {
        ...state,
        drafts: state.drafts.filter((d) => d.id !== action.id),
        inlineDraftId:
          state.inlineDraftId === action.id ? null : state.inlineDraftId,
      };
    case "MINIMIZE":
      return {
        ...state,
        drafts: state.drafts.map((d) =>
          d.id === action.id ? { ...d, windowState: "minimized" as const } : d,
        ),
      };
    case "EXPAND":
      return {
        ...state,
        drafts: state.drafts.map((d) =>
          d.id === action.id ? { ...d, windowState: "open" as const } : d,
        ),
      };
    case "UPDATE_FIELD":
      return {
        ...state,
        drafts: state.drafts.map((d) =>
          d.id === action.id
            ? { ...d, form: { ...d.form, [action.field]: action.value } }
            : d,
        ),
      };
    case "SET_GMAIL_DRAFT_ID":
      return {
        ...state,
        drafts: state.drafts.map((d) =>
          d.id === action.id
            ? { ...d, gmailDraftId: action.gmailDraftId }
            : d,
        ),
      };
    case "SET_INLINE":
      return { ...state, inlineDraftId: action.id };
    case "UPDATE_LABEL":
      return {
        ...state,
        drafts: state.drafts.map((d) =>
          d.id === action.id ? { ...d, label: action.label } : d,
        ),
      };
    case "ADD_ATTACHMENTS":
      return {
        ...state,
        drafts: state.drafts.map((d) =>
          d.id === action.id
            ? { ...d, attachments: [...d.attachments, ...action.attachments] }
            : d,
        ),
      };
    case "REMOVE_ATTACHMENT":
      return {
        ...state,
        drafts: state.drafts.map((d) =>
          d.id === action.id
            ? { ...d, attachments: d.attachments.filter((a) => a.id !== action.attachmentId) }
            : d,
        ),
      };
    default:
      return state;
  }
}

let nextId = 0;
function generateDraftId(): string {
  nextId += 1;
  return `draft-${Date.now()}-${nextId}`;
}

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

export type OpenDraftOptions = {
  mode: ComposeMode;
  form?: Partial<ComposeFormState>;
  quotedContent?: string | null;
  gmailDraftId?: string | null;
  label?: string;
  accountId?: string | null;
  inline?: boolean;
};

type DraftsContextValue = {
  drafts: DraftEntry[];
  inlineDraftId: string | null;
  openDraft: (opts: OpenDraftOptions) => string;
  openDraftWithForm: (
    gmailDraftId: string,
    form: ComposeFormState,
    quotedContent: string | null,
    accountId: string | null,
    inline?: boolean,
  ) => string;
  closeDraft: (id: string) => void;
  minimizeDraft: (id: string) => void;
  expandDraft: (id: string) => void;
  updateField: (id: string, field: keyof ComposeFormState, value: string) => void;
  setGmailDraftId: (id: string, gmailDraftId: string) => void;
  setInlineDraft: (id: string | null) => void;
  getDraft: (id: string) => DraftEntry | undefined;
  getDraftForThread: (threadId: string) => DraftEntry | undefined;
  addAttachments: (id: string, files: File[]) => void;
  removeAttachment: (id: string, attachmentId: string) => void;
  dockDrafts: DraftEntry[];
};

const DraftsContext = createContext<DraftsContextValue | null>(null);

function modeLabel(mode: ComposeMode): string {
  switch (mode) {
    case "new": return "New Message";
    case "reply": return "Reply";
    case "reply-all": return "Reply All";
    case "forward": return "Forward";
  }
}

export function DraftsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    drafts: [],
    inlineDraftId: null,
  });

  const openDraft = useCallback((opts: OpenDraftOptions) => {
    const id = generateDraftId();
    const form = { ...EMPTY_FORM, ...opts.form };
    const label = opts.label ?? (form.subject ? `${modeLabel(opts.mode)}: ${form.subject}` : modeLabel(opts.mode));

    dispatch({
      type: "ADD",
      entry: {
        id,
        mode: opts.mode,
        form,
        quotedContent: opts.quotedContent ?? null,
        gmailDraftId: opts.gmailDraftId ?? null,
        windowState: "open",
        label,
        accountId: opts.accountId ?? null,
        attachments: [],
      },
    });

    if (opts.inline) {
      dispatch({ type: "SET_INLINE", id });
    }

    return id;
  }, []);

  const openDraftWithForm = useCallback(
    (
      gmailDraftId: string,
      form: ComposeFormState,
      quotedContent: string | null,
      accountId: string | null,
      inline?: boolean,
    ) => {
      const id = generateDraftId();
      const label = form.subject
        ? `Draft: ${form.subject}`
        : "Draft";

      dispatch({
        type: "ADD",
        entry: {
          id,
          mode: "new",
          form,
          quotedContent,
          gmailDraftId,
          windowState: "open",
          label,
          accountId,
          attachments: [],
        },
      });

      if (inline) {
        dispatch({ type: "SET_INLINE", id });
      }

      return id;
    },
    [],
  );

  const closeDraft = useCallback((id: string) => {
    dispatch({ type: "REMOVE", id });
  }, []);

  const minimizeDraft = useCallback((id: string) => {
    dispatch({ type: "MINIMIZE", id });
  }, []);

  const expandDraft = useCallback((id: string) => {
    dispatch({ type: "EXPAND", id });
  }, []);

  const updateField = useCallback(
    (id: string, field: keyof ComposeFormState, value: string) => {
      dispatch({ type: "UPDATE_FIELD", id, field, value });
    },
    [],
  );

  const setGmailDraftId = useCallback((id: string, gmailDraftId: string) => {
    dispatch({ type: "SET_GMAIL_DRAFT_ID", id, gmailDraftId });
  }, []);

  const addAttachments = useCallback((id: string, files: File[]) => {
    const attachments: ComposeAttachment[] = files.map((file) => ({
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
    }));
    dispatch({ type: "ADD_ATTACHMENTS", id, attachments });
  }, []);

  const removeAttachment = useCallback((id: string, attachmentId: string) => {
    dispatch({ type: "REMOVE_ATTACHMENT", id, attachmentId });
  }, []);

  const setInlineDraft = useCallback((id: string | null) => {
    dispatch({ type: "SET_INLINE", id });
  }, []);

  const getDraft = useCallback(
    (id: string) => state.drafts.find((d) => d.id === id),
    [state.drafts],
  );

  const getDraftForThread = useCallback(
    (threadId: string) =>
      state.drafts.find((d) => d.form.threadId === threadId),
    [state.drafts],
  );

  const dockDrafts = useMemo(
    () => state.drafts.filter((d) => d.id !== state.inlineDraftId),
    [state.drafts, state.inlineDraftId],
  );

  const value = useMemo<DraftsContextValue>(
    () => ({
      drafts: state.drafts,
      inlineDraftId: state.inlineDraftId,
      openDraft,
      openDraftWithForm,
      closeDraft,
      minimizeDraft,
      expandDraft,
      updateField,
      setGmailDraftId,
      setInlineDraft,
      getDraft,
      getDraftForThread,
      addAttachments,
      removeAttachment,
      dockDrafts,
    }),
    [
      state.drafts,
      state.inlineDraftId,
      openDraft,
      openDraftWithForm,
      closeDraft,
      minimizeDraft,
      expandDraft,
      updateField,
      setGmailDraftId,
      setInlineDraft,
      getDraft,
      getDraftForThread,
      addAttachments,
      removeAttachment,
      dockDrafts,
    ],
  );

  return (
    <DraftsContext.Provider value={value}>
      {children}
    </DraftsContext.Provider>
  );
}

export function useDrafts(): DraftsContextValue {
  const ctx = useContext(DraftsContext);
  if (!ctx) throw new Error("useDrafts must be used within DraftsProvider");
  return ctx;
}
