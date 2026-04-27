import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createNote,
  deleteNote,
  getBacklinks,
  getNote,
  getNoteByTitle,
  getOutgoingLinks,
  listNotes,
  listTags,
  searchNotes,
  updateNote,
} from "@g-spot/db/notes";
import {
  createNoteInputSchema,
  updateNoteInputSchema,
  type Note,
  type NoteBacklink,
  type NoteOutgoingLink,
} from "@g-spot/types";

import { publicProcedure, router } from "../index";

function toNote(row: NonNullable<Awaited<ReturnType<typeof getNote>>>): Note {
  return {
    id: row.id,
    parentId: row.parentId,
    kind: row.kind,
    title: row.title,
    content: row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const notesRouter = router({
  list: publicProcedure.query(async (): Promise<Note[]> => {
    const rows = await listNotes();
    return rows.map(toNote);
  }),

  get: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input }): Promise<Note> => {
      const row = await getNote(input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });
      return toNote(row);
    }),

  getByTitle: publicProcedure
    .input(z.object({ title: z.string().min(1) }))
    .query(async ({ input }): Promise<Note | null> => {
      const row = await getNoteByTitle(input.title);
      return row ? toNote(row) : null;
    }),

  create: publicProcedure
    .input(createNoteInputSchema)
    .mutation(async ({ input }): Promise<Note> => {
      const row = await createNote(input);
      return toNote(row);
    }),

  update: publicProcedure
    .input(updateNoteInputSchema)
    .mutation(async ({ input }): Promise<Note> => {
      const existing = await getNote(input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });
      const row = await updateNote(input);
      return toNote(row);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await deleteNote(input.id);
      return { ok: true };
    }),

  search: publicProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ input }): Promise<Note[]> => {
      const rows = await searchNotes(input.query);
      return rows.map(toNote);
    }),

  backlinks: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input }): Promise<NoteBacklink[]> => {
      const rows = await getBacklinks(input.id);
      return rows.map((r) => ({ source: toNote(r.source), targetTitle: r.targetTitle }));
    }),

  outgoingLinks: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input }): Promise<NoteOutgoingLink[]> => {
      const rows = await getOutgoingLinks(input.id);
      return rows.map((r) => ({
        targetTitle: r.targetTitle,
        target: r.target ? toNote(r.target) : null,
      }));
    }),

  tags: publicProcedure.query(async () => {
    return listTags();
  }),
});
