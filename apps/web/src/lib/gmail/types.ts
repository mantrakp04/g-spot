export type GmailThread = {
  id: string;
  threadId: string;
  subject: string;
  from: { name: string; email: string };
  snippet: string;
  date: string;
  isUnread: boolean;
  labels: string[];
  hasAttachment: boolean;
  /** Brand logo URL derived from sender domain (BIMI-like), null for personal email providers */
  avatarUrl: string | null;
};

export type GmailThreadPage = {
  threads: GmailThread[];
  nextPageToken: string | null;
  resultSizeEstimate: number;
};

/** A single message within a full thread detail */
export type GmailFullMessage = {
  id: string;
  from: { name: string; email: string };
  to: string;
  cc: string;
  date: string;
  subject: string;
  messageId: string;
  inReplyTo: string;
  references: string;
  bodyHtml: string | null;
  bodyText: string | null;
};

/** Full thread detail with all messages */
export type GmailThreadDetail = {
  id: string;
  subject: string;
  messages: GmailFullMessage[];
};

/** Compose mode for the email compose UI */
export type ComposeMode = "new" | "reply" | "reply-all" | "forward";

/** State for the compose form fields */
export type ComposeFormState = {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  inReplyTo: string;
  references: string;
  threadId: string | null;
};

/** Gmail draft resource */
export type GmailDraft = {
  id: string;
  message: { id: string; threadId: string };
};
