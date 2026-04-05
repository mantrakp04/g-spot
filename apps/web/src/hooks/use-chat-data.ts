import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { chatKeys } from "@/lib/query-keys";
import { trpcClient } from "@/utils/trpc";

const CHAT_LIST_PAGE_SIZE = 20;

export function useChats() {
  return useInfiniteQuery({
    queryKey: chatKeys.list({ limit: CHAT_LIST_PAGE_SIZE }),
    queryFn: ({ pageParam }) =>
      trpcClient.chat.list.query({
        limit: CHAT_LIST_PAGE_SIZE,
        cursor: pageParam,
      }),
    initialPageParam: null as { updatedAt: string; id: string } | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function useChatMessages(chatId: string) {
  return useQuery({
    queryKey: chatKeys.messages(chatId),
    queryFn: () => trpcClient.chat.messages.query({ chatId }),
    enabled: !!chatId,
  });
}

export function useChatDetail(chatId: string) {
  return useQuery({
    queryKey: chatKeys.detail(chatId),
    queryFn: () => trpcClient.chat.get.query({ chatId }),
    enabled: !!chatId,
  });
}

export function useCreateChatMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input?: {
      title?: string;
      model?: string;
      initialMessage?: { id: string; message: string };
    }) => trpcClient.chat.create.mutate(input ?? {}),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      queryClient.invalidateQueries({
        queryKey: chatKeys.detail(data.id),
      });
    },
  });
}

export function useUpdateChatTitleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { chatId: string; title: string }) =>
      trpcClient.chat.updateTitle.mutate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.list() });
    },
  });
}

export function useDeleteChatMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (chatId: string) => trpcClient.chat.delete.mutate({ chatId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.list() });
    },
  });
}

export function useUpdateChatModelMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { chatId: string; model: string }) =>
      trpcClient.chat.updateModel.mutate(input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      queryClient.invalidateQueries({
        queryKey: chatKeys.detail(variables.chatId),
      });
    },
  });
}

export function useSaveChatMessageMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      chatId: string;
      message: { id: string; message: string };
    }) => trpcClient.chat.saveMessage.mutate(input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      queryClient.invalidateQueries({
        queryKey: chatKeys.messages(variables.chatId),
      });
    },
  });
}

export function useReplaceChatMessagesMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      chatId: string;
      messages: Array<{ id: string; message: string }>;
    }) => trpcClient.chat.replaceMessages.mutate(input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      queryClient.invalidateQueries({
        queryKey: chatKeys.messages(variables.chatId),
      });
    },
  });
}

export function useForkChatMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      chatId: string;
      messages: Array<{ id: string; message: string }>;
    }) => trpcClient.chat.fork.mutate(input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      queryClient.invalidateQueries({
        queryKey: chatKeys.messages(data.id),
      });
    },
  });
}

export function useGenerateChatTitleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      chatId: string;
      model: string;
      messages: Array<{
        role: "system" | "user" | "assistant";
        parts: unknown[];
      }>;
    }) => trpcClient.chat.generateTitle.mutate(input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      queryClient.invalidateQueries({
        queryKey: chatKeys.detail(variables.chatId),
      });
    },
  });
}
