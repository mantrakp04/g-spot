import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { client } from "@g-spot/db";

const RAW_SQL_LIMIT = 100;

const searchKindSchema = z.enum([
  "memory",
  "note",
  "chat",
  "email",
  "contact",
  "github",
  "sql",
]);

export type SearchKind = z.infer<typeof searchKindSchema>;

export const searchResultSchema = z.object({
  id: z.string().min(1),
  kind: searchKindSchema,
  title: z.string().min(1),
  subtitle: z.string().default(""),
  preview: z.string().default(""),
  target: z.record(z.string(), z.string().nullable()).default({}),
  score: z.number().default(50),
});

export type SearchResult = z.infer<typeof searchResultSchema>;

type PresentedSearchResults = {
  answer: string;
  results: SearchResult[];
};

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function assertReadOnlySql(sql: string) {
  const trimmed = sql.trim().replace(/;$/, "");
  if (!/^(select|with|pragma\s+(table_info|table_xinfo|index_list|index_info|foreign_key_list)\b)/i.test(trimmed)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Only read-only SELECT/WITH/schema PRAGMA queries are allowed." });
  }
  if (/\b(insert|update|delete|drop|alter|create|replace|attach|detach|vacuum|reindex|pragma\s+(?!table_info|table_xinfo|index_list|index_info|foreign_key_list))/i.test(trimmed)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Mutating SQL is not allowed from search." });
  }
  return trimmed;
}

export function runReadOnlySearchSql(sql: string) {
  const safeSql = assertReadOnlySql(sql);
  return client.prepare(safeSql).all().slice(0, RAW_SQL_LIMIT) as Record<string, unknown>[];
}

function normalizeTarget(value: unknown) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, targetValue]) => {
      if (typeof targetValue === "string" || targetValue === null) return [[key, targetValue]];
      if (typeof targetValue === "number" || typeof targetValue === "boolean") return [[key, String(targetValue)]];
      return [];
    }),
  );
}

export function inferSearchResultsFromRows(rows: Record<string, unknown>[]): SearchResult[] {
  return rows.flatMap((row, index): SearchResult[] => {
    const id = text(row.id) || text(row.chat_id) || text(row.note_id) || text(row.gmail_thread_id);
    if (!id) return [];

    if ("project_id" in row || "chat_id" in row || "chatId" in row) {
      const chatId = text(row.chat_id) || text(row.chatId) || text(row.id);
      const projectId = text(row.project_id) || text(row.projectId);
      if (!chatId || !projectId) return [];
      return [{
        id: `agent:chat:${chatId}:${index}`,
        kind: "chat",
        title: text(row.title) || "Chat",
        subtitle: "Chat",
        preview: text(row.preview) || text(row.snippet) || text(row.message),
        target: { chatId, projectId, messageId: text(row.message_id) || null, query: null },
        score: 90 - index,
      }];
    }

    if ("content" in row && "title" in row) {
      return [{
        id: `agent:note:${id}:${index}`,
        kind: "note",
        title: text(row.title),
        subtitle: "Note",
        preview: text(row.preview) || text(row.content),
        target: { noteId: id, query: null },
        score: 90 - index,
      }];
    }

    if ("gmail_thread_id" in row || "provider_account_id" in row) {
      return [{
        id: `agent:email:${id}:${index}`,
        kind: "email",
        title: text(row.subject) || "Email",
        subtitle: text(row.from_email) || text(row.from_name),
        preview: text(row.preview) || text(row.snippet) || text(row.body_text),
        target: {
          gmailThreadId: text(row.gmail_thread_id),
          providerAccountId: text(row.provider_account_id),
          messageId: id,
          query: null,
        },
        score: 90 - index,
      }];
    }

    return [];
  }).slice(0, 30);
}

export function createSearchResultTools(
  onPresented: (result: PresentedSearchResults) => void,
  onRows?: (rows: Record<string, unknown>[]) => void,
): ToolDefinition[] {
  let lastSqlRows: Record<string, unknown>[] = [];

  const rawSql = defineTool({
    name: "raw_sql",
    label: "Raw SQL",
    description: "Run a read-only SQLite SELECT/WITH/schema PRAGMA query against the local app database.",
    promptSnippet: "raw_sql: query the local SQLite database. Read-only only.",
    parameters: Type.Object({
      sql: Type.String({ description: "Read-only SQL query. Add LIMITs." }),
    }),
    async execute(_toolCallId, params) {
      lastSqlRows = runReadOnlySearchSql(params.sql);
      onRows?.(lastSqlRows);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(lastSqlRows, null, 2) }],
        details: undefined,
      };
    },
  });

  const presentResults = defineTool({
    name: "present_results",
    label: "Present Results",
    description: "Commit final structured Cmd-K results. Call this exactly once with clickable result items.",
    promptSnippet: "present_results: commit structured Cmd-K results.",
    parameters: Type.Object({
      answer: Type.Optional(Type.String({ description: "Short summary. No markdown list." })),
      results: Type.Any({ description: "Array of SearchResult objects." }),
    }),
    async execute(_toolCallId, params) {
      const parsed = z.array(searchResultSchema).max(30).parse(
        Array.isArray(params.results)
          ? params.results.map((result: unknown, index) => ({
              id: text((result as Record<string, unknown>)?.id) || `agent:result:${index}`,
              kind: (result as Record<string, unknown>)?.kind,
              title: (result as Record<string, unknown>)?.title,
              subtitle: text((result as Record<string, unknown>)?.subtitle),
              preview: text((result as Record<string, unknown>)?.preview),
              target: normalizeTarget((result as Record<string, unknown>)?.target),
              score: typeof (result as Record<string, unknown>)?.score === "number"
                ? (result as Record<string, unknown>).score
                : 50,
            }))
          : [],
      );

      onPresented({
        answer: params.answer?.trim() || `Found ${parsed.length} result${parsed.length === 1 ? "" : "s"}.`,
        results: parsed,
      });

      return {
        content: [{ type: "text" as const, text: "Search results accepted." }],
        details: undefined,
      };
    },
  });

  return [rawSql, presentResults];
}
