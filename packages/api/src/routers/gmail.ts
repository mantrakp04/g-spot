import { z } from "zod";
import { filterConditionSchema } from "@g-spot/types/filters";

import {
  countFilteredThreads,
  getContactSuggestions,
  getFieldSuggestions,
  getGmailAccount,
  getLabels,
  getThread as getStoredThread,
  getThreadDrafts as getStoredThreadDrafts,
  getThreadMessages,
  queryThreads,
  searchThreads as searchStoredThreads,
} from "@g-spot/db/gmail";
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

function parseJsonLabels(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

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
        filters: z.array(filterConditionSchema).default([]),
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
        threads: threads.map((t) => {
          const labels = parseJsonLabels(t.labels);
          return {
            id: t.id,
            threadId: t.gmailThreadId,
            subject: t.subject,
            from: { name: t.fromName, email: t.fromEmail },
            snippet: t.snippet,
            date: t.lastMessageAt ?? "",
            isUnread: labels.includes("UNREAD"),
            labels,
            hasAttachment: t.hasAttachment,
            avatarUrl: null,
          };
        }),
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
        filters: z.array(filterConditionSchema).default([]),
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

  getKnownContacts: publicProcedure
    .input(z.object({ providerAccountId: z.string() }))
    .query(async ({ input }) => {
      const account = await getGmailAccount(input.providerAccountId);
      if (!account) return [];

      return getContactSuggestions(account.id);
    }),

  getProfile: publicProcedure
    .input(z.object({ providerAccountId: z.string() }))
    .query(async ({ input }) => {
      const account = await getGmailAccount(input.providerAccountId);
      if (!account) {
        return { name: "Google Account", email: "", picture: "" };
      }
      return { name: account.email, email: account.email, picture: "" };
    }),

  getFilterSuggestions: publicProcedure
    .input(
      z.object({
        providerAccountId: z.string(),
        field: z.enum([
          "from",
          "to",
          "cc",
          "bcc",
          "deliveredto",
          "list",
          "subject",
          "filename",
        ]),
        filters: z.array(filterConditionSchema).default([]),
      }),
    )
    .query(async ({ input }) => {
      const account = await getGmailAccount(input.providerAccountId);
      if (!account) return [];

      if (
        input.field === "bcc"
        || input.field === "deliveredto"
        || input.field === "list"
      ) {
        return [];
      }

      return getFieldSuggestions(account.id, input.field);
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

      return threads.map((t) => {
        const labels = parseJsonLabels(t.labels);
        return {
          id: t.id,
          threadId: t.gmailThreadId,
          subject: t.subject,
          from: { name: t.fromName, email: t.fromEmail },
          snippet: t.snippet,
          date: t.lastMessageAt ?? "",
          isUnread: labels.includes("UNREAD"),
          labels,
          hasAttachment: t.hasAttachment,
          avatarUrl: null,
        };
      });
    }),
});
