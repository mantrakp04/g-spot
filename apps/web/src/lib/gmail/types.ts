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
