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
    onSuccess: () => {
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
