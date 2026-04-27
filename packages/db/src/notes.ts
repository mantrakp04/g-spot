import { and, asc, desc, eq, inArray, isNull, like, or } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "./index";
import { noteLinks, notes } from "./schema";

export type NoteRow = typeof notes.$inferSelect;
export type NoteLinkRow = typeof noteLinks.$inferSelect;

const WIKILINK_RE = /\[\[([^\[\]\n]+?)(?:\|[^\[\]\n]+?)?\]\]/g;

function nowIso(): string {
  return new Date().toISOString();
}

export async function listNotes(): Promise<NoteRow[]> {
  return db
    .select()
    .from(notes)
    .orderBy(asc(notes.kind), asc(notes.title));
}

export async function getNote(id: string): Promise<NoteRow | null> {
  const [row] = await db.select().from(notes).where(eq(notes.id, id));
  return row ?? null;
}

export async function getNoteByTitle(title: string): Promise<NoteRow | null> {
  const [row] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.title, title), eq(notes.kind, "note")));
  return row ?? null;
}

export async function createNote(input: {
  title: string;
  parentId?: string | null;
  kind?: "note" | "folder";
  content?: string;
}): Promise<NoteRow> {
  const id = nanoid();
  const now = nowIso();
  const kind = input.kind ?? "note";
  const content = kind === "folder" ? "" : input.content ?? "";
  await db.insert(notes).values({
    id,
    parentId: input.parentId ?? null,
    kind,
    title: input.title,
    content,
    createdAt: now,
    updatedAt: now,
  });
  if (kind === "note" && content) {
    await rebuildLinks(id, content);
  }
  if (kind === "note") {
    await db
      .update(noteLinks)
      .set({ targetId: id })
      .where(and(eq(noteLinks.targetTitle, input.title), isNull(noteLinks.targetId)));
  }
  const row = await getNote(id);
  if (!row) throw new Error("createNote: row not found after insert");
  return row;
}

export async function updateNote(input: {
  id: string;
  title?: string;
  content?: string;
  parentId?: string | null;
}): Promise<NoteRow> {
  const patch: Partial<typeof notes.$inferInsert> = {
    updatedAt: nowIso(),
  };
  if (input.title !== undefined) patch.title = input.title;
  if (input.content !== undefined) patch.content = input.content;
  if (input.parentId !== undefined) patch.parentId = input.parentId;

  await db.update(notes).set(patch).where(eq(notes.id, input.id));

  if (input.content !== undefined) {
    const row = await getNote(input.id);
    if (row?.kind === "note") {
      await rebuildLinks(input.id, input.content);
    }
  }

  // If title changed, resolve any dangling links pointing at the new title.
  if (input.title !== undefined) {
    await db
      .update(noteLinks)
      .set({ targetId: input.id })
      .where(
        and(eq(noteLinks.targetTitle, input.title), isNull(noteLinks.targetId)),
      );
  }

  const row = await getNote(input.id);
  if (!row) throw new Error("updateNote: row not found");
  return row;
}

export async function deleteNote(id: string): Promise<void> {
  // Cascades children + outgoing links. Incoming links get targetId nulled.
  await db.delete(notes).where(eq(notes.id, id));
}

export async function searchNotes(query: string): Promise<NoteRow[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const pattern = `%${trimmed}%`;
  return db
    .select()
    .from(notes)
    .where(
      and(
        eq(notes.kind, "note"),
        or(like(notes.title, pattern), like(notes.content, pattern)),
      ),
    )
    .orderBy(desc(notes.updatedAt))
    .limit(50);
}

function extractWikilinkTitles(content: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of content.matchAll(WIKILINK_RE)) {
    const title = match[1]?.trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    out.push(title);
  }
  return out;
}

async function rebuildLinks(sourceId: string, content: string): Promise<void> {
  await db.delete(noteLinks).where(eq(noteLinks.sourceId, sourceId));
  const titles = extractWikilinkTitles(content);
  if (titles.length === 0) return;

  const existing = await db
    .select({ id: notes.id, title: notes.title })
    .from(notes)
    .where(and(inArray(notes.title, titles), eq(notes.kind, "note")));
  const titleToId = new Map(existing.map((r) => [r.title, r.id]));

  await db.insert(noteLinks).values(
    titles.map((title) => ({
      id: nanoid(),
      sourceId,
      targetId: titleToId.get(title) ?? null,
      targetTitle: title,
    })),
  );
}

/**
 * `[[wikilinks]]` referenced from inside the given note. Each row is one
 * outgoing link — `target` is null for unresolved targets so the UI can
 * render dangling refs visually, just like backlinks.
 */
export async function getOutgoingLinks(
  noteId: string,
): Promise<Array<{ targetTitle: string; target: NoteRow | null }>> {
  const rows = await db
    .select({
      targetTitle: noteLinks.targetTitle,
      targetId: noteLinks.targetId,
    })
    .from(noteLinks)
    .where(eq(noteLinks.sourceId, noteId))
    .orderBy(asc(noteLinks.targetTitle));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.targetId).filter((id): id is string => !!id);
  const targets =
    ids.length === 0
      ? []
      : await db.select().from(notes).where(inArray(notes.id, ids));
  const byId = new Map(targets.map((n) => [n.id, n] as const));
  return rows.map((r) => ({
    targetTitle: r.targetTitle,
    target: r.targetId ? byId.get(r.targetId) ?? null : null,
  }));
}

/** Notes that link TO the given note (resolved by id OR matching title). */
export async function getBacklinks(
  noteId: string,
): Promise<Array<{ source: NoteRow; targetTitle: string }>> {
  const target = await getNote(noteId);
  if (!target) return [];
  const rows = await db
    .select({ source: notes, targetTitle: noteLinks.targetTitle })
    .from(noteLinks)
    .innerJoin(notes, eq(notes.id, noteLinks.sourceId))
    .where(
      or(
        eq(noteLinks.targetId, noteId),
        and(eq(noteLinks.targetTitle, target.title), isNull(noteLinks.targetId)),
      ),
    )
    .orderBy(desc(notes.updatedAt));
  return rows;
}

/** Distinct #tags across all notes, with counts. */
export async function listTags(): Promise<Array<{ tag: string; count: number }>> {
  const rows = await db.select({ content: notes.content }).from(notes).where(eq(notes.kind, "note"));
  const counts = new Map<string, number>();
  const tagRe = /(?<![\w/])#([\w\-/]+)/g;
  for (const { content } of rows) {
    for (const m of content.matchAll(tagRe)) {
      const tag = m[1];
      if (!tag) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
