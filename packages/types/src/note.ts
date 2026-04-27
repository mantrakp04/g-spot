import { z } from "zod";

export const noteKindSchema = z.enum(["note", "folder"]);
export type NoteKind = z.infer<typeof noteKindSchema>;

export const noteTitleSchema = z
  .string()
  .min(1, "Title is required")
  .max(200);

export const createNoteInputSchema = z.object({
  title: noteTitleSchema,
  parentId: z.string().nullable().optional(),
  kind: noteKindSchema.optional(),
  content: z.string().max(2_000_000).optional(),
});

export const updateNoteInputSchema = z
  .object({
    id: z.string().min(1),
    title: noteTitleSchema.optional(),
    content: z.string().max(2_000_000).optional(),
    parentId: z.string().nullable().optional(),
  })
  .strict();

export type CreateNoteInput = z.infer<typeof createNoteInputSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteInputSchema>;

export type Note = {
  id: string;
  parentId: string | null;
  kind: NoteKind;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type NoteBacklink = {
  source: Note;
  targetTitle: string;
};

export type NoteOutgoingLink = {
  targetTitle: string;
  target: Note | null;
};
