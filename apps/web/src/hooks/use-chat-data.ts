import type { PiAgentConfig } from "@g-spot/types";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { chatKeys } from "@/lib/query-keys";
import { trpcClient } from "@/utils/trpc";

const CHAT_LIST_PAGE_SIZE = 20;

export function useChats(projectId: string | null) {
  return useInfiniteQuery({
    queryKey: chatKeys.list({ projectId, limit: CHAT_LIST_PAGE_SIZE }),
    queryFn: ({ pageParam }) =>
      trpcClient.chat.list.query({
        projectId: projectId ?? "",
        limit: CHAT_LIST_PAGE_SIZE,
        cursor: pageParam,
      }),
    enabled: !!projectId,
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
    mutationFn: (input: {
      projectId: string;
      title?: string;
      agentConfig?: PiAgentConfig;
    }) => trpcClient.chat.create.mutate(input),
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
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      queryClient.invalidateQueries({
        queryKey: chatKeys.detail(variables.chatId),
      });
    },
  });
}

export function useDeleteChatMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (chatId: string) => trpcClient.chat.delete.mutate({ chatId }),
    onSuccess: (_, chatId) => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      void queryClient.invalidateQueries({
        queryKey: chatKeys.detail(chatId),
      });
      void queryClient.invalidateQueries({
        queryKey: chatKeys.messages(chatId),
      });
    },
  });
}

export function useUpdateChatAgentConfigMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { chatId: string; agentConfig: PiAgentConfig }) =>
      trpcClient.chat.updateAgentConfig.mutate(input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      queryClient.invalidateQueries({
        queryKey: chatKeys.detail(variables.chatId),
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
