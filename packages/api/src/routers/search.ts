import { z } from "zod";

import { client } from "@g-spot/db";

import { publicProcedure, router } from "../index";
import { createPiAgentSession, getPiAgentDefaults, normalizePiAgentConfig } from "../lib/pi";
import { buildSearchAgentPrompt } from "../ai-flows/search/prompt";
import {
  createSearchResultTools,
  inferSearchResultsFromRows,
  runReadOnlySearchSql,
  type SearchResult,
} from "../ai-flows/search/tools";

const SEARCH_LIMIT = 8;
const SEARCHABLE_TABLES = [
  "notes",
  "chats",
  "chat_messages",
  "gmail_accounts",
  "gmail_threads",
  "gmail_messages",
  "memory_entities",
  "memory_observations",
  "memory_edges",
  "memory_blocks",
] as const;

function likePattern(query: string) {
  return `%${query.replace(/[\\%_]/g, "\\$&")}%`;
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function searchTerms(query: string) {
  const stopWords = new Set(["a", "an", "and", "are", "for", "from", "in", "me", "of", "on", "or", "that", "the", "to", "with"]);
  return query
    .toLowerCase()
    .split(/[^a-z0-9_/-]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length > 2 && !stopWords.has(term))
    .slice(0, 6);
}

function snippet(value: unknown, query: string, max = 220) {
  const source = text(value).replace(/\s+/g, " ").trim();
  if (!source) return "";
  const index = source.toLowerCase().indexOf(query.toLowerCase());
  const start = index === -1 ? 0 : Math.max(0, index - 70);
  const out = source.slice(start, start + max);
  return `${start > 0 ? "…" : ""}${out}${start + max < source.length ? "…" : ""}`;
}

function parseChatMessage(value: unknown) {
  try {
    const parsed = JSON.parse(text(value)) as { role?: string; content?: unknown; parts?: unknown };
    const parts = Array.isArray(parsed.parts) ? parsed.parts : [];
    const partText = parts
      .flatMap((part) =>
        part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part
          ? [text(part.text)]
          : [],
      )
      .join("\n");
    return {
      role: text(parsed.role) || "message",
      body: partText || (typeof parsed.content === "string" ? parsed.content : text(value)),
    };
  } catch {
    return { role: "message", body: text(value) };
  }
}

function tableNames() {
  return (client.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[])
    .map((row) => row.name);
}

function schemaPrompt() {
  return tableNames()
    .map((table) => {
      const columns = client.prepare(`PRAGMA table_xinfo(${JSON.stringify(table)})`).all() as { name: string; type: string; notnull: number; pk: number }[];
      return `${table}(${columns.map((c) => `${c.name} ${c.type}${c.pk ? " primary key" : ""}${c.notnull ? " not null" : ""}`).join(", ")})`;
    })
    .join("\n");
}

function searchAll(query: string): SearchResult[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const like = likePattern(q);
  const results: SearchResult[] = [];

  const notes = client.prepare(`
    SELECT id, title, content, updated_at FROM notes
    WHERE kind = 'note' AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')
    ORDER BY updated_at DESC LIMIT ?
  `).all(like, like, SEARCH_LIMIT) as Record<string, unknown>[];
  for (const row of notes) {
    const titleHit = text(row.title).toLowerCase().includes(q.toLowerCase());
    results.push({
      id: `note:${row.id}`,
      kind: "note",
      title: text(row.title),
      subtitle: titleHit ? "Note title" : "Note body",
      preview: snippet(titleHit ? row.title : row.content, q),
      target: { noteId: text(row.id), query: titleHit ? null : q },
      score: titleHit ? 100 : 80,
    });
  }

  const chats = client.prepare(`
    SELECT id, project_id, title, updated_at FROM chats
    WHERE title LIKE ? ESCAPE '\\'
    ORDER BY updated_at DESC LIMIT ?
  `).all(like, SEARCH_LIMIT) as Record<string, unknown>[];
  for (const row of chats) {
    results.push({
      id: `chat-title:${row.id}`,
      kind: "chat",
      title: text(row.title),
      subtitle: "Chat title",
      preview: snippet(row.title, q),
      target: { chatId: text(row.id), projectId: text(row.project_id), messageId: null, query: null },
      score: 95,
    });
  }

  const terms = searchTerms(q);
  const chatMessageWhere = terms.length > 1
    ? terms.map(() => "cm.message LIKE ? ESCAPE '\\'").join(" AND ")
    : "cm.message LIKE ? ESCAPE '\\'";
  const chatMessageParams = terms.length > 1
    ? terms.map((term) => likePattern(term))
    : [like];
  const chatMessages = client.prepare(`
    SELECT cm.id, cm.chat_id, cm.message, c.title, c.project_id, cm.created_at
    FROM chat_messages cm JOIN chats c ON c.id = cm.chat_id
    WHERE ${chatMessageWhere}
    ORDER BY cm.created_at DESC LIMIT ?
  `).all(...chatMessageParams, SEARCH_LIMIT) as Record<string, unknown>[];
  for (const row of chatMessages) {
    const parsed = parseChatMessage(row.message);
    results.push({
      id: `chat-message:${row.id}`,
      kind: "chat",
      title: text(row.title) || "Chat message",
      subtitle: `${parsed.role} message`,
      preview: snippet(parsed.body, q),
      target: { chatId: text(row.chat_id), projectId: text(row.project_id), messageId: text(row.id), query: q },
      score: 75,
    });
  }

  const emails = client.prepare(`
    SELECT gm.id, gm.account_id, gm.gmail_thread_id, gm.from_name, gm.from_email, gm.subject, gm.body_text, gm.snippet, gm.date, ga.provider_account_id, ga.email AS account_email
    FROM gmail_messages gm JOIN gmail_accounts ga ON ga.id = gm.account_id
    WHERE gm.subject LIKE ? ESCAPE '\\' OR gm.from_name LIKE ? ESCAPE '\\' OR gm.from_email LIKE ? ESCAPE '\\' OR gm.body_text LIKE ? ESCAPE '\\' OR gm.snippet LIKE ? ESCAPE '\\'
    ORDER BY gm.date DESC LIMIT ?
  `).all(like, like, like, like, like, SEARCH_LIMIT) as Record<string, unknown>[];
  for (const row of emails) {
    const isContact = text(row.from_name).toLowerCase().includes(q.toLowerCase()) || text(row.from_email).toLowerCase().includes(q.toLowerCase());
    results.push({
      id: `email:${row.id}`,
      kind: isContact ? "contact" : "email",
      title: text(row.subject) || "(no subject)",
      subtitle: `${text(row.from_name) || text(row.from_email)} · ${text(row.account_email)}`,
      preview: snippet([row.subject, row.snippet, row.body_text].map(text).join(" "), q),
      target: { gmailThreadId: text(row.gmail_thread_id), providerAccountId: text(row.provider_account_id), messageId: text(row.id), query: q },
      score: isContact ? 85 : 70,
    });
  }

  const githubSections = client.prepare(`
    SELECT id, name, source, repos, filters FROM sections
    WHERE source IN ('github_pr', 'github_issue') AND (name LIKE ? ESCAPE '\\' OR repos LIKE ? ESCAPE '\\' OR filters LIKE ? ESCAPE '\\')
    ORDER BY position ASC LIMIT ?
  `).all(like, like, like, SEARCH_LIMIT) as Record<string, unknown>[];
  for (const row of githubSections) {
    results.push({
      id: `github:${row.id}`,
      kind: "github",
      title: text(row.name),
      subtitle: text(row.source) === "github_pr" ? "GitHub pull requests section" : "GitHub issues section",
      preview: snippet([row.repos, row.filters].map(text).join(" "), q),
      target: { sectionId: text(row.id), query: q },
      score: 60,
    });
  }

  const memories = client.prepare(`
    SELECT id, name AS title, description AS body, entity_type AS type, updated_at FROM memory_entities
    WHERE valid_to IS NULL AND (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR aliases LIKE ? ESCAPE '\\')
    UNION ALL
    SELECT id, observation_type AS title, content AS body, observation_type AS type, updated_at FROM memory_observations
    WHERE valid_to IS NULL AND content LIKE ? ESCAPE '\\'
    ORDER BY updated_at DESC LIMIT ?
  `).all(like, like, like, like, SEARCH_LIMIT) as Record<string, unknown>[];
  for (const row of memories) {
    results.push({
      id: `memory:${row.id}`,
      kind: "memory",
      title: text(row.title),
      subtitle: `Memory · ${text(row.type)}`,
      preview: snippet(row.body, q),
      target: { memoryId: text(row.id), query: q },
      score: 65,
    });
  }

  if (/^(select|with|pragma)\b/i.test(q)) {
    results.unshift({
      id: "sql:raw",
      kind: "sql",
      title: "Run read-only SQL",
      subtitle: "Raw SQL",
      preview: q,
      target: { sql: q },
      score: 110,
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 30);
}

export const searchRouter = router({
  global: publicProcedure
    .input(z.object({ query: z.string() }))
    .query(({ input }): SearchResult[] => searchAll(input.query)),

  schema: publicProcedure.query(() => ({ schema: schemaPrompt(), tables: SEARCHABLE_TABLES })),

  rawSql: publicProcedure
    .input(z.object({ sql: z.string().min(1) }))
    .mutation(({ input }) => ({ rows: runReadOnlySearchSql(input.sql) })),

  ask: publicProcedure
    .input(z.object({ query: z.string().min(2) }))
    .mutation(async ({ input }) => {
      const presentedRef: { current: { answer: string; results: SearchResult[] } | null } = { current: null };
      const lastSqlRowsRef: { current: Record<string, unknown>[] } = { current: [] };

      const defaults = await getPiAgentDefaults();
      const config = normalizePiAgentConfig(defaults.worker);
      const { session } = await createPiAgentSession({
        config,
        activeToolNames: [],
        customTools: createSearchResultTools(
          (result) => {
            presentedRef.current = result;
          },
          (rows) => {
            lastSqlRowsRef.current = rows;
          },
        ),
        disableProjectResources: true,
      });

      await session.prompt(buildSearchAgentPrompt({
        query: input.query,
        schema: schemaPrompt(),
      }));

      if (!presentedRef.current) {
        await session.prompt([
          "You did not commit structured results.",
          "Call present_results now with clickable structured results. If there were no useful SQL rows, use an empty results array.",
        ].join("\n"));
      }

      if (!presentedRef.current) {
        const inferred = inferSearchResultsFromRows(lastSqlRowsRef.current);
        if (inferred.length > 0) {
          return { answer: `Found ${inferred.length} result${inferred.length === 1 ? "" : "s"}.`, results: inferred };
        }
      }

      if (!presentedRef.current || presentedRef.current.results.length === 0) {
        const fallbackResults = searchAll(input.query);
        if (fallbackResults.length > 0) {
          return { answer: `Found ${fallbackResults.length} result${fallbackResults.length === 1 ? "" : "s"}.`, results: fallbackResults };
        }
      }

      if (!presentedRef.current) {
        throw new Error("Pi did not return structured search results.");
      }

      return presentedRef.current;
    }),
});
