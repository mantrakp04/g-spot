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
  avatarUrl: string | null;
};

export type GmailThreadPage = {
  threads: GmailThread[];
  nextPageToken: string | null;
  /** Threads in the local store matching filters (same basis as `getThreadCount`). */
  totalMatchingThreads: number;
};

export type GmailThreadDraft = {
  draftId: string;
  messageId: string;
  threadId: string;
};

export type GmailFullMessage = {
  id: string;
  isDraft: boolean;
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

export type GmailThreadDetail = {
  id: string;
  subject: string;
  messages: GmailFullMessage[];
};

export type ComposeMode = "new" | "reply" | "reply-all" | "forward";

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

export type GmailDraft = {
  id: string;
  message: { id: string; threadId: string };
};
