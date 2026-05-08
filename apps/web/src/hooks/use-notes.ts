import type { CreateNoteInput, Note, UpdateNoteInput } from "@g-spot/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { noteKeys } from "@/lib/query-keys";
import { trpcClient } from "@/utils/trpc";

export function useNotes() {
  return useQuery({
    queryKey: noteKeys.list(),
    queryFn: () => trpcClient.notes.list.query(),
  });
}

export function useNote(noteId: string | null) {
  return useQuery({
    queryKey: noteKeys.detail(noteId ?? ""),
    queryFn: () => trpcClient.notes.get.query({ id: noteId ?? "" }),
    enabled: !!noteId,
  });
}

export function useNoteBacklinks(noteId: string | null) {
  return useQuery({
    queryKey: noteKeys.backlinks(noteId ?? ""),
    queryFn: () => trpcClient.notes.backlinks.query({ id: noteId ?? "" }),
    enabled: !!noteId,
  });
}

export function useNoteOutgoingLinks(noteId: string | null) {
  return useQuery({
    queryKey: noteKeys.outgoingLinks(noteId ?? ""),
    queryFn: () => trpcClient.notes.outgoingLinks.query({ id: noteId ?? "" }),
    enabled: !!noteId,
  });
}

export function useNoteTags() {
  return useQuery({
    queryKey: noteKeys.tags(),
    queryFn: () => trpcClient.notes.tags.query(),
  });
}

export function useNoteSearch(query: string) {
  return useQuery({
    queryKey: noteKeys.search(query),
    queryFn: () => trpcClient.notes.search.query({ query }),
    enabled: query.trim().length > 0,
  });
}

export function useCreateNoteMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateNoteInput) => trpcClient.notes.create.mutate(input),
    onSuccess: (note: Note) => {
      // Seed both caches synchronously so consumers that read the list (e.g.
      // the active-note cleanup effect in /notes) and the detail (the editor)
      // see the new note immediately, before the background refetch lands.
      // Without this, navigating to the freshly created note races with the
      // refetch and the active note gets cleared.
      queryClient.setQueryData(noteKeys.detail(note.id), note);
      queryClient.setQueryData<Note[]>(noteKeys.list(), (prev) =>
        prev && !prev.some((n) => n.id === note.id) ? [...prev, note] : prev,
      );
      queryClient.invalidateQueries({ queryKey: noteKeys.all() });
    },
  });
}

export function useUpdateNoteMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateNoteInput) => trpcClient.notes.update.mutate(input),
    onSuccess: (note: Note) => {
      queryClient.setQueryData(noteKeys.detail(note.id), note);
      queryClient.invalidateQueries({ queryKey: noteKeys.all() });
    },
  });
}

export function useDeleteNoteMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => trpcClient.notes.delete.mutate({ id }),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: noteKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: noteKeys.all() });
    },
  });
}
