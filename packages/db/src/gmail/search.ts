import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { db } from "../index";
import {
  gmailAttachments,
  gmailMessages,
  gmailThreadLabels,
  gmailThreads,
} from "../schema";
import type { FilterRule } from "@g-spot/types/filters";
import { getThreadLabelsByIds } from "./threads";

export type GmailFilterCondition = {
  type?: "condition";
  field: string;
  operator: string;
  value: string;
  logic?: "and" | "or";
};

export type ThreadListItem = {
  id: string;
  gmailThreadId: string;
  subject: string;
  snippet: string;
  lastMessageAt: string | null;
  labels: string[];
  fromName: string;
  fromEmail: string;
  hasAttachment: boolean;
};

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

function mapCategoryToLabel(value: string): string | null {
  switch (value.trim().toLowerCase()) {
    case "primary":
      return "CATEGORY_PERSONAL";
    case "social":
      return "CATEGORY_SOCIAL";
    case "promotions":
      return "CATEGORY_PROMOTIONS";
    case "updates":
      return "CATEGORY_UPDATES";
    case "forums":
      return "CATEGORY_FORUMS";
    default:
      return null;
  }
}

function mapLocationToLabel(value: string): string | null {
  switch (value.trim().toLowerCase()) {
    case "inbox":
      return "INBOX";
    case "sent":
      return "SENT";
    case "draft":
    case "drafts":
      return "DRAFT";
    case "trash":
      return "TRASH";
    case "spam":
      return "SPAM";
    case "starred":
      return "STARRED";
    case "important":
      return "IMPORTANT";
    case "anywhere":
      return null;
    default:
      return value;
  }
}

function parseRelativeDurationMs(value: string): number | null {
  const match = value.trim().match(/^(\d+)([dmy])$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  if (unit === "d") return amount * 86_400_000;
  if (unit === "m") return amount * 30 * 86_400_000;
  if (unit === "y") return amount * 365 * 86_400_000;
  return null;
}

function parseSizeBytes(value: string): number | null {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)([kmg])?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  if (!unit) return amount;
  if (unit === "k") return amount * 1024;
  if (unit === "m") return amount * 1048576;
  if (unit === "g") return amount * 1073741824;
  return amount;
}

function booleanFilterWantsPositive(
  operator: string,
  value: string,
): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (normalized !== "true" && normalized !== "false") return null;
  const rawValue = normalized === "true";
  return operator === "is_not" ? !rawValue : rawValue;
}

function labelExistsSql(label: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${gmailThreadLabels}
    WHERE ${gmailThreadLabels.threadId} = ${gmailThreads.id}
      AND ${gmailThreadLabels.label} = ${label}
  )`;
}

function labelNotExistsSql(label: string): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM ${gmailThreadLabels}
    WHERE ${gmailThreadLabels.threadId} = ${gmailThreads.id}
      AND ${gmailThreadLabels.label} = ${label}
  )`;
}

function labelContainsSql(pattern: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${gmailThreadLabels}
    WHERE ${gmailThreadLabels.threadId} = ${gmailThreads.id}
      AND LOWER(${gmailThreadLabels.label}) LIKE ${pattern}
  )`;
}

function messageFieldMatchSql(
  accountId: string,
  column:
    | typeof gmailMessages.fromEmail
    | typeof gmailMessages.fromName
    | typeof gmailMessages.toHeader
    | typeof gmailMessages.ccHeader
    | typeof gmailMessages.subject,
  operator: string,
  value: string,
): SQL {
  const needle = value.trim().toLowerCase();
  let cond: SQL;
  switch (operator) {
    case "is":
      cond = sql`LOWER(${column}) = ${needle}`;
      break;
    case "is_not":
      cond = sql`LOWER(${column}) != ${needle}`;
      break;
    case "contains":
      cond = sql`LOWER(${column}) LIKE ${"%" + needle + "%"}`;
      break;
    case "not_contains":
      cond = sql`LOWER(${column}) NOT LIKE ${"%" + needle + "%"}`;
      break;
    default:
      cond = sql`1=1`;
  }

  const isNegated = operator === "is_not" || operator === "not_contains";
  if (isNegated) {
    return sql`NOT EXISTS (SELECT 1 FROM ${gmailMessages} m WHERE m.thread_id = ${gmailThreads.id} AND m.account_id = ${accountId} AND NOT (${cond}))`;
  }
  return sql`EXISTS (SELECT 1 FROM ${gmailMessages} m WHERE m.thread_id = ${gmailThreads.id} AND m.account_id = ${accountId} AND ${cond})`;
}

function buildFilterConditionSql(
  accountId: string,
  filter: GmailFilterCondition,
): SQL | null {
  const { field, operator, value } = filter;

  switch (field) {
    case "from": {
      const needle = value.trim().toLowerCase();
      const like = "%" + needle + "%";
      if (operator === "is" || operator === "contains") {
        const match =
          operator === "is"
            ? sql`LOWER(m.from_email) = ${needle}`
            : sql`(LOWER(m.from_email) LIKE ${like} OR LOWER(m.from_name) LIKE ${like})`;
        return sql`EXISTS (SELECT 1 FROM ${gmailMessages} m WHERE m.thread_id = ${gmailThreads.id} AND m.account_id = ${accountId} AND ${match})`;
      }
      if (operator === "is_not" || operator === "not_contains") {
        const match =
          operator === "is_not"
            ? sql`LOWER(m.from_email) = ${needle}`
            : sql`(LOWER(m.from_email) LIKE ${like} OR LOWER(m.from_name) LIKE ${like})`;
        return sql`NOT EXISTS (SELECT 1 FROM ${gmailMessages} m WHERE m.thread_id = ${gmailThreads.id} AND m.account_id = ${accountId} AND ${match})`;
      }
      return null;
    }

    case "to":
      return messageFieldMatchSql(
        accountId,
        gmailMessages.toHeader,
        operator,
        value,
      );
    case "cc":
      return messageFieldMatchSql(
        accountId,
        gmailMessages.ccHeader,
        operator,
        value,
      );
    case "subject":
      return messageFieldMatchSql(
        accountId,
        gmailMessages.subject,
        operator,
        value,
      );

    case "label": {
      const needle = value.trim().toLowerCase();
      if (operator === "is") return labelExistsSql(value);
      if (operator === "is_not") return labelNotExistsSql(value);
      if (operator === "contains") return labelContainsSql("%" + needle + "%");
      if (operator === "not_contains")
        return sql`NOT (${labelContainsSql("%" + needle + "%")})`;
      return null;
    }

    case "category": {
      const mapped = mapCategoryToLabel(value);
      if (!mapped) return null;
      return operator === "is_not"
        ? labelNotExistsSql(mapped)
        : labelExistsSql(mapped);
    }

    case "in": {
      const mapped = mapLocationToLabel(value);
      if (mapped === null) return null;
      return operator === "is_not"
        ? labelNotExistsSql(mapped)
        : labelExistsSql(mapped);
    }

    case "is_unread": {
      const wantsPositive = booleanFilterWantsPositive(operator, value);
      if (wantsPositive === null) return null;
      return wantsPositive
        ? labelExistsSql("UNREAD")
        : labelNotExistsSql("UNREAD");
    }
    case "is_read": {
      const wantsPositive = booleanFilterWantsPositive(operator, value);
      if (wantsPositive === null) return null;
      return wantsPositive
        ? labelNotExistsSql("UNREAD")
        : labelExistsSql("UNREAD");
    }
    case "is_starred": {
      const wantsPositive = booleanFilterWantsPositive(operator, value);
      if (wantsPositive === null) return null;
      return wantsPositive
        ? labelExistsSql("STARRED")
        : labelNotExistsSql("STARRED");
    }
    case "is_important": {
      const wantsPositive = booleanFilterWantsPositive(operator, value);
      if (wantsPositive === null) return null;
      return wantsPositive
        ? labelExistsSql("IMPORTANT")
        : labelNotExistsSql("IMPORTANT");
    }
    case "is_snoozed": {
      const wantsPositive = booleanFilterWantsPositive(operator, value);
      if (wantsPositive === null) return null;
      return wantsPositive
        ? labelExistsSql("SNOOZED")
        : labelNotExistsSql("SNOOZED");
    }
    case "is_muted": {
      const wantsPositive = booleanFilterWantsPositive(operator, value);
      if (wantsPositive === null) return null;
      return wantsPositive
        ? labelExistsSql("MUTED")
        : labelNotExistsSql("MUTED");
    }

    case "has_attachment": {
      const wantsPositive = booleanFilterWantsPositive(operator, value);
      if (wantsPositive === null) return null;
      if (wantsPositive) {
        return sql`EXISTS (SELECT 1 FROM ${gmailAttachments} a INNER JOIN ${gmailMessages} m ON a.message_id = m.id WHERE m.thread_id = ${gmailThreads.id} AND m.account_id = ${accountId})`;
      }
      return sql`NOT EXISTS (SELECT 1 FROM ${gmailAttachments} a INNER JOIN ${gmailMessages} m ON a.message_id = m.id WHERE m.thread_id = ${gmailThreads.id} AND m.account_id = ${accountId})`;
    }

    case "filename": {
      const needle = value.trim().toLowerCase();
      const like = "%" + needle + "%";
      if (operator === "is") {
        return sql`EXISTS (SELECT 1 FROM ${gmailAttachments} a INNER JOIN ${gmailMessages} m ON a.message_id = m.id WHERE m.thread_id = ${gmailThreads.id} AND m.account_id = ${accountId} AND LOWER(a.filename) = ${needle})`;
      }
      if (operator === "contains") {
        return sql`EXISTS (SELECT 1 FROM ${gmailAttachments} a INNER JOIN ${gmailMessages} m ON a.message_id = m.id WHERE m.thread_id = ${gmailThreads.id} AND m.account_id = ${accountId} AND LOWER(a.filename) LIKE ${like})`;
      }
      return null;
    }

    case "after": {
      const dateStr = value.trim();
      return sql`${gmailThreads.lastMessageAt} > ${dateStr}`;
    }
    case "before": {
      const dateStr = value.trim();
      return sql`${gmailThreads.lastMessageAt} < ${dateStr}`;
    }
    case "newer_than": {
      const durationMs = parseRelativeDurationMs(value);
      if (durationMs === null) return null;
      const cutoff = new Date(Date.now() - durationMs).toISOString();
      return sql`${gmailThreads.lastMessageAt} >= ${cutoff}`;
    }
    case "older_than": {
      const durationMs = parseRelativeDurationMs(value);
      if (durationMs === null) return null;
      const cutoff = new Date(Date.now() - durationMs).toISOString();
      return sql`${gmailThreads.lastMessageAt} <= ${cutoff}`;
    }

    case "larger": {
      const bytes = parseSizeBytes(value);
      if (bytes === null) return null;
      return sql`(SELECT COALESCE(SUM(COALESCE(m.raw_size_estimate, 0)), 0) FROM ${gmailMessages} m WHERE m.thread_id = ${gmailThreads.id} AND m.account_id = ${accountId}) > ${bytes}`;
    }
    case "smaller": {
      const bytes = parseSizeBytes(value);
      if (bytes === null) return null;
      return sql`(SELECT COALESCE(SUM(COALESCE(m.raw_size_estimate, 0)), 0) FROM ${gmailMessages} m WHERE m.thread_id = ${gmailThreads.id} AND m.account_id = ${accountId}) < ${bytes}`;
    }

    case "has_drive":
    case "has_document":
    case "has_spreadsheet":
    case "has_presentation":
    case "has_youtube": {
      const wantsPositive = booleanFilterWantsPositive(operator, value);
      if (wantsPositive === null) return null;
      const patterns: Record<string, string[]> = {
        has_drive: ["%drive.google.com%"],
        has_document: ["%docs.google.com/document%"],
        has_spreadsheet: ["%docs.google.com/spreadsheets%"],
        has_presentation: ["%docs.google.com/presentation%"],
        has_youtube: ["%youtube.com%", "%youtu.be%"],
      };
      const likes = patterns[field]!;
      const likeClauses = likes.map(
        (p) => sql`(m.body_html LIKE ${p} OR m.body_text LIKE ${p})`,
      );
      const combined =
        likeClauses.length === 1
          ? likeClauses[0]!
          : sql`(${sql.join(likeClauses, sql` OR `)})`;
      if (wantsPositive) {
        return sql`EXISTS (SELECT 1 FROM ${gmailMessages} m WHERE m.thread_id = ${gmailThreads.id} AND m.account_id = ${accountId} AND ${combined})`;
      }
      return sql`NOT EXISTS (SELECT 1 FROM ${gmailMessages} m WHERE m.thread_id = ${gmailThreads.id} AND m.account_id = ${accountId} AND ${combined})`;
    }

    default:
      return null;
  }
}

function buildFilterRuleSql(
  accountId: string,
  rule: FilterRule,
): SQL | undefined {
  if (rule.type === "condition") {
    if (rule.value.trim().length === 0) return undefined;
    return buildFilterConditionSql(accountId, rule) ?? undefined;
  }

  const conditions = rule.children
    .map((child) => buildFilterRuleSql(accountId, child))
    .filter((condition): condition is SQL => condition != null);

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return rule.operator === "or" ? or(...conditions) : and(...conditions);
}

function buildFilterWhere(
  accountId: string,
  filters: FilterRule,
): SQL | undefined {
  const ruleSql = buildFilterRuleSql(accountId, filters);
  const conditions: SQL[] = [eq(gmailThreads.accountId, accountId)];
  if (ruleSql) conditions.push(ruleSql);
  return and(...conditions);
}

// ---------------------------------------------------------------------------
// Public queries
// ---------------------------------------------------------------------------

async function hydrateThreads(
  rows: Array<{
    id: string;
    gmailThreadId: string;
    subject: string;
    snippet: string;
    lastMessageAt: string | null;
  }>,
): Promise<ThreadListItem[]> {
  if (rows.length === 0) return [];
  const threadIds = rows.map((r) => r.id);

  const [labelsByThread, senderRows, attachmentCounts] = await Promise.all([
    getThreadLabelsByIds(threadIds),
    db
      .select({
        threadId: gmailMessages.threadId,
        fromName: gmailMessages.fromName,
        fromEmail: gmailMessages.fromEmail,
        date: gmailMessages.date,
      })
      .from(gmailMessages)
      .where(inArray(gmailMessages.threadId, threadIds))
      .orderBy(desc(gmailMessages.date)),
    db
      .select({
        threadId: gmailMessages.threadId,
        count: sql<number>`COUNT(*)`.as("count"),
      })
      .from(gmailAttachments)
      .innerJoin(
        gmailMessages,
        eq(gmailAttachments.messageId, gmailMessages.id),
      )
      .where(inArray(gmailMessages.threadId, threadIds))
      .groupBy(gmailMessages.threadId),
  ]);

  const senderMap = new Map<
    string,
    { fromName: string; fromEmail: string }
  >();
  for (const row of senderRows) {
    if (!senderMap.has(row.threadId)) {
      senderMap.set(row.threadId, {
        fromName: row.fromName,
        fromEmail: row.fromEmail,
      });
    }
  }
  const attMap = new Map(attachmentCounts.map((r) => [r.threadId, r.count]));

  return rows.map((row) => {
    const msg = senderMap.get(row.id);
    return {
      id: row.id,
      gmailThreadId: row.gmailThreadId,
      subject: row.subject,
      snippet: row.snippet,
      lastMessageAt: row.lastMessageAt,
      labels: labelsByThread.get(row.id) ?? [],
      fromName: msg?.fromName ?? "",
      fromEmail: msg?.fromEmail ?? "",
      hasAttachment: (attMap.get(row.id) ?? 0) > 0,
    };
  });
}

export async function queryThreads(
  accountId: string,
  filters: FilterRule,
  options: {
    limit?: number;
    cursor?: string | null;
    sortAsc?: boolean;
  } = {},
): Promise<{ threads: ThreadListItem[]; hasMore: boolean; totalCount: number }> {
  const limit = options.limit ?? 7;
  const where = buildFilterWhere(accountId, filters);

  const cursorConditions: SQL[] = where
    ? [where]
    : [eq(gmailThreads.accountId, accountId)];
  if (options.cursor) {
    cursorConditions.push(lt(gmailThreads.lastMessageAt, options.cursor));
  }

  const threadRows = await db
    .select({
      id: gmailThreads.id,
      gmailThreadId: gmailThreads.gmailThreadId,
      subject: gmailThreads.subject,
      snippet: gmailThreads.snippet,
      lastMessageAt: gmailThreads.lastMessageAt,
    })
    .from(gmailThreads)
    .where(and(...cursorConditions))
    .orderBy(
      options.sortAsc
        ? asc(gmailThreads.lastMessageAt)
        : desc(gmailThreads.lastMessageAt),
    )
    .limit(limit + 1);

  const hasMore = threadRows.length > limit;
  const pageRows = threadRows.slice(0, limit);
  const threads = await hydrateThreads(pageRows);

  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(gmailThreads)
    .where(where);
  const totalCount = countRow?.count ?? 0;

  return { threads, hasMore, totalCount };
}

export async function countFilteredThreads(
  accountId: string,
  filters: FilterRule,
): Promise<number> {
  const where = buildFilterWhere(accountId, filters);
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(gmailThreads)
    .where(where);
  return row?.count ?? 0;
}

// ---------------------------------------------------------------------------
// FTS5-backed full-text search across messages
// ---------------------------------------------------------------------------

/**
 * Escape the user's query into a valid FTS5 MATCH expression. We split on
 * whitespace, drop punctuation that would confuse the tokenizer, double-quote
 * each remaining token, and OR them together. Sender lookups (subject/body)
 * still benefit from this because the FTS index covers those columns.
 */
function buildFtsMatchExpr(query: string): string | null {
  const tokens = query
    .split(/\s+/)
    .map((tok) => tok.replace(/["()*\-:^]/g, "").trim())
    .filter((tok) => tok.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((tok) => `"${tok}"`).join(" ");
}

export async function searchThreads(
  accountId: string,
  query: string,
  limit = 20,
): Promise<ThreadListItem[]> {
  const matchExpr = buildFtsMatchExpr(query);
  if (!matchExpr) return [];

  const matchingThreadIds = await db.all<{ thread_id: string }>(sql`
    SELECT DISTINCT m.thread_id
    FROM gmail_messages_fts f
    INNER JOIN ${gmailMessages} m ON m.rowid = f.rowid
    WHERE m.account_id = ${accountId}
      AND gmail_messages_fts MATCH ${matchExpr}
    LIMIT ${limit}
  `);

  if (matchingThreadIds.length === 0) return [];
  const ids = matchingThreadIds.map((r) => r.thread_id);

  const rows = await db
    .select({
      id: gmailThreads.id,
      gmailThreadId: gmailThreads.gmailThreadId,
      subject: gmailThreads.subject,
      snippet: gmailThreads.snippet,
      lastMessageAt: gmailThreads.lastMessageAt,
    })
    .from(gmailThreads)
    .where(inArray(gmailThreads.id, ids))
    .orderBy(desc(gmailThreads.lastMessageAt));

  return hydrateThreads(rows);
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

export async function getContactSuggestions(
  accountId: string,
  limit = 100,
): Promise<Array<{ name: string; email: string }>> {
  const rows = await db
    .select({
      fromName: gmailMessages.fromName,
      fromEmail: gmailMessages.fromEmail,
      count: sql<number>`COUNT(*)`.as("cnt"),
    })
    .from(gmailMessages)
    .where(
      and(
        eq(gmailMessages.accountId, accountId),
        sql`${gmailMessages.fromEmail} != ''`,
      ),
    )
    .groupBy(gmailMessages.fromEmail)
    .orderBy(sql`cnt DESC`)
    .limit(limit);

  return rows.map((r) => ({ name: r.fromName, email: r.fromEmail }));
}

function extractUniqueEmails(
  headers: string[],
  limit: number,
): Array<{ value: string; label: string }> {
  const seen = new Map<string, string>();

  for (const raw of headers) {
    for (const part of raw.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      const named = trimmed.match(/^(.+?)\s*<(.+?)>$/);
      if (named) {
        const email = named[2]!.trim().toLowerCase();
        if (!seen.has(email)) {
          const name = named[1]!.trim().replace(/^"|"$/g, "");
          seen.set(email, name ? `${name} <${email}>` : email);
        }
      } else {
        const email = trimmed.replace(/^<|>$/g, "").trim().toLowerCase();
        if (email && !seen.has(email)) seen.set(email, email);
      }

      if (seen.size >= limit) break;
    }
    if (seen.size >= limit) break;
  }

  return [...seen.entries()].map(([email, label]) => ({ value: email, label }));
}

export async function getFieldSuggestions(
  accountId: string,
  field: "from" | "to" | "cc" | "subject" | "filename",
  limit = 50,
): Promise<Array<{ value: string; label: string }>> {
  switch (field) {
    case "from": {
      const rows = await db
        .select({
          fromName: gmailMessages.fromName,
          fromEmail: gmailMessages.fromEmail,
        })
        .from(gmailMessages)
        .where(
          and(
            eq(gmailMessages.accountId, accountId),
            sql`${gmailMessages.fromEmail} != ''`,
          ),
        )
        .groupBy(gmailMessages.fromEmail)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(limit);
      return rows.map((r) => ({
        value: r.fromEmail,
        label: r.fromName ? `${r.fromName} <${r.fromEmail}>` : r.fromEmail,
      }));
    }

    case "to": {
      const rows = await db
        .select({ toHeader: gmailMessages.toHeader })
        .from(gmailMessages)
        .where(
          and(
            eq(gmailMessages.accountId, accountId),
            sql`${gmailMessages.toHeader} != ''`,
          ),
        )
        .groupBy(gmailMessages.toHeader)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(limit * 3);
      return extractUniqueEmails(
        rows.map((r) => r.toHeader),
        limit,
      );
    }

    case "cc": {
      const rows = await db
        .select({ ccHeader: gmailMessages.ccHeader })
        .from(gmailMessages)
        .where(
          and(
            eq(gmailMessages.accountId, accountId),
            sql`${gmailMessages.ccHeader} != ''`,
          ),
        )
        .groupBy(gmailMessages.ccHeader)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(limit * 3);
      return extractUniqueEmails(
        rows.map((r) => r.ccHeader),
        limit,
      );
    }

    case "subject": {
      const rows = await db
        .select({ subject: gmailMessages.subject })
        .from(gmailMessages)
        .where(
          and(
            eq(gmailMessages.accountId, accountId),
            sql`${gmailMessages.subject} != ''`,
          ),
        )
        .groupBy(gmailMessages.subject)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(limit);
      return rows.map((r) => ({ value: r.subject, label: r.subject }));
    }

    case "filename": {
      const rows = await db
        .select({ filename: gmailAttachments.filename })
        .from(gmailAttachments)
        .innerJoin(
          gmailMessages,
          eq(gmailAttachments.messageId, gmailMessages.id),
        )
        .where(eq(gmailMessages.accountId, accountId))
        .groupBy(gmailAttachments.filename)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(limit);
      return rows.map((r) => ({ value: r.filename, label: r.filename }));
    }

    default:
      return [];
  }
}
