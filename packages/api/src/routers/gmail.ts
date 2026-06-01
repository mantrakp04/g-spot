import { z } from "zod";
import { sectionFiltersSchema } from "@g-spot/types/filters";

import {
  countFilteredThreads,
  getGmailAccount,
  getLabels,
  getThread as getStoredThread,
  getThreadDrafts as getStoredThreadDrafts,
  getThreadMessages,
  queryThreads,
  searchThreads as searchStoredThreads,
} from "@g-spot/db/gmail";
import type { ThreadListItem } from "@g-spot/db/gmail";
import type {
  GmailLabelRow,
  GmailMessageRow,
  GmailThreadRow,
} from "@g-spot/db/schema/gmail";

import { publicProcedure, router } from "../index";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INCLUDED_SYSTEM_LABELS = new Set([
  "INBOX",
  "SENT",
  "TRASH",
  "SPAM",
  "UNREAD",
  "STARRED",
  "IMPORTANT",
]);

const SYSTEM_LABEL_DISPLAY: Record<string, string> = {
  INBOX: "Inbox",
  SENT: "Sent",
  TRASH: "Trash",
  SPAM: "Spam",
  UNREAD: "Unread",
  STARRED: "Starred",
  IMPORTANT: "Important",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterSuggestionOption = {
  value: string;
  label: string;
};

type LabelCatalogEntry = {
  id: string;
  name: string;
  type: "system" | "user";
  label: string;
  color?: {
    textColor?: string;
    backgroundColor?: string;
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseLabelColor(value: string | null): LabelCatalogEntry["color"] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return undefined;

    const textColor =
      "textColor" in parsed && typeof parsed.textColor === "string"
        ? parsed.textColor
        : undefined;
    const backgroundColor =
      "backgroundColor" in parsed && typeof parsed.backgroundColor === "string"
        ? parsed.backgroundColor
        : undefined;

    if (!textColor && !backgroundColor) return undefined;
    return {
      ...(textColor ? { textColor } : {}),
      ...(backgroundColor ? { backgroundColor } : {}),
    };
  } catch {
    return undefined;
  }
}

function toLabelCatalogEntry(label: GmailLabelRow): LabelCatalogEntry {
  return {
    id: label.gmailId,
    name: label.name,
    type: label.type === "system" ? "system" : "user",
    label: label.type === "system"
      ? (SYSTEM_LABEL_DISPLAY[label.gmailId] ?? label.name)
      : label.name,
    color: parseLabelColor(label.color),
  };
}

function toLabelOption(label: LabelCatalogEntry): FilterSuggestionOption | null {
  if (label.type !== "user" && !INCLUDED_SYSTEM_LABELS.has(label.id)) return null;
  return { value: label.name, label: label.label };
}

function toThreadListItem(t: ThreadListItem) {
  return {
    id: t.id,
    threadId: t.gmailThreadId,
    subject: t.subject,
    from: { name: t.fromName, email: t.fromEmail },
    snippet: t.snippet,
    date: t.lastMessageAt ?? "",
    isUnread: t.labels.includes("UNREAD"),
    labels: t.labels,
    hasAttachment: t.hasAttachment,
    avatarUrl: null,
  };
}

function mapStoredThreadDetail(thread: GmailThreadRow, messages: GmailMessageRow[]) {
  return {
    id: thread.gmailThreadId,
    subject: thread.subject,
    messages: messages.map((message) => ({
      id: message.gmailMessageId,
      isDraft: message.isDraft,
      from: {
        name: message.fromName,
        email: message.fromEmail,
      },
      to: message.toHeader,
      cc: message.ccHeader,
      date: message.date,
      subject: message.subject,
      messageId: message.messageIdHeader ?? "",
      inReplyTo: message.inReplyTo ?? "",
      references: message.referencesHeader ?? "",
      bodyHtml: message.bodyHtml,
      bodyText: message.bodyText,
    })),
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const gmailRouter = router({
  getThreads: publicProcedure
    .input(
      z.object({
        providerAccountId: z.string(),
        filters: sectionFiltersSchema,
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.string().nullable().optional(),
      }),
    )
    .query(async ({ input }) => {
      const account = await getGmailAccount(input.providerAccountId);
      if (!account) {
        return { threads: [], nextPageToken: null, totalMatchingThreads: 0 };
      }

      const { threads, hasMore, totalCount } = await queryThreads(
        account.id,
        input.filters,
        {
          limit: input.limit,
          cursor: input.cursor ?? null,
        },
      );

      return {
        threads: threads.map(toThreadListItem),
        nextPageToken: hasMore
          ? (threads.at(-1)?.lastMessageAt ?? null)
          : null,
        totalMatchingThreads: totalCount,
      };
    }),

  getThread: publicProcedure
    .input(
      z.object({
        providerAccountId: z.string(),
        gmailThreadId: z.string(),
      }),
    )
    .query(async ({ input }) => {
      const account = await getGmailAccount(input.providerAccountId);
      if (!account) return null;

      const thread = await getStoredThread(account.id, input.gmailThreadId);
      if (!thread) return null;

      const messages = await getThreadMessages(thread.id);
      return mapStoredThreadDetail(thread, messages);
    }),

  getThreadCount: publicProcedure
    .input(
      z.object({
        providerAccountId: z.string(),
        filters: sectionFiltersSchema,
      }),
    )
    .query(async ({ input }) => {
      const account = await getGmailAccount(input.providerAccountId);
      if (!account) return { count: 0 };

      const count = await countFilteredThreads(account.id, input.filters);
      return { count };
    }),

  getLabels: publicProcedure
    .input(z.object({ providerAccountId: z.string() }))
    .query(async ({ input }) => {
      const account = await getGmailAccount(input.providerAccountId);
      if (!account) return [];

      const labels = await getLabels(account.id);
      return labels
        .map(toLabelCatalogEntry)
        .map(toLabelOption)
        .filter((label): label is FilterSuggestionOption => label != null);
    }),

  getLabelCatalog: publicProcedure
    .input(z.object({ providerAccountId: z.string() }))
    .query(async ({ input }) => {
      const account = await getGmailAccount(input.providerAccountId);
      if (!account) return [];

      const labels = await getLabels(account.id);
      return labels
        .map(toLabelCatalogEntry)
        .sort((a, b) => a.label.localeCompare(b.label));
    }),

  getThreadDrafts: publicProcedure
    .input(
      z.object({
        providerAccountId: z.string(),
        threadId: z.string(),
        messageIds: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ input }) => {
      const account = await getGmailAccount(input.providerAccountId);
      if (!account) return [];
      return getStoredThreadDrafts(
        account.id,
        input.threadId,
        input.messageIds ?? [],
      );
    }),

  searchThreads: publicProcedure
    .input(
      z.object({
        providerAccountId: z.string(),
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ input }) => {
      const account = await getGmailAccount(input.providerAccountId);
      if (!account) return [];

      const threads = await searchStoredThreads(
        account.id,
        input.query,
        input.limit,
      );

      return threads.map(toThreadListItem);
    }),
});
