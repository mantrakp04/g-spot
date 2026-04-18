import { useEffect, useState } from "react";

import type { OAuthConnection } from "@stackframe/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  clearGmailDraftQueries,
  clearGmailThreadDetail,
  getGmailThreadsSnapshot,
  invalidateGmailThreads,
  removeGmailThreadFromLists,
  restoreGmailThreadsSnapshot,
  setGmailThreadUnreadState,
} from "@/lib/gmail-cache";
import { gmailKeys } from "@/lib/query-keys";
import type {
  GmailThread,
  GmailThreadDetail,
  GmailThreadDraft,
} from "@/lib/gmail/types";
import { trpcClient } from "@/utils/trpc";

type ThreadMutationInput = {
  account: OAuthConnection;
  threadId: string;
  markRead?: boolean;
};

type SetUnreadInput = ThreadMutationInput & {
  isUnread: boolean;
};

type SaveDraftInput = {
  draftId: string | null;
  raw: string;
  threadId?: string | null;
};

type SendMessageInput = {
  draftId: string | null;
  raw: string;
  threadId?: string | null;
};

export function useMarkGmailThreadReadMutation() { 
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ account, threadId }: ThreadMutationInput) => {
      await trpcClient.gmail.modifyThreadLabels.mutate({
        providerAccountId: account.providerAccountId,
        threadId,
        removeLabelIds: ["UNREAD"],
      });
    },
    onMutate: async ({ threadId }) => {
      const snapshot = getGmailThreadsSnapshot(queryClient);
      setGmailThreadUnreadState(queryClient, threadId, false);
      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      if (context?.snapshot) {
        restoreGmailThreadsSnapshot(queryClient, context.snapshot);
      }
    },
  });
}

export function useGmailThreadDrafts(
  thread: GmailThread,
  detail: GmailThreadDetail | undefined,
  googleAccount: OAuthConnection | null,
) {
  const accountId = googleAccount?.providerAccountId ?? null;

  return useQuery({
    queryKey: gmailKeys.threadDrafts(thread.threadId, accountId),
    queryFn: () =>
      trpcClient.gmail.getThreadDrafts.query({
        providerAccountId: googleAccount!.providerAccountId,
        threadId: thread.threadId,
        messageIds: detail?.messages.map((message) => message.id) ?? [],
      }),
    enabled: !!googleAccount && !!detail,
    staleTime: 60_000,
  });
}

export function useGmailComposeDraft(
  draftId: string | null,
  googleAccount: OAuthConnection | null,
) {
  const accountId = googleAccount?.providerAccountId ?? null;

  return useQuery({
    queryKey: gmailKeys.draftCompose(draftId, accountId),
    queryFn: () =>
      trpcClient.gmail.getComposeDraft.query({
        providerAccountId: googleAccount!.providerAccountId,
        draftId: draftId!,
      }),
    enabled: !!draftId && !!googleAccount,
    staleTime: 60_000,
  });
}

export function useGmailThreadActions(
  thread: GmailThread,
  googleAccount: OAuthConnection | null,
  onClose: () => void,
) {
  const queryClient = useQueryClient();
  const accountId = googleAccount?.providerAccountId ?? null;
  const [isRead, setIsRead] = useState(!thread.isUnread);

  useEffect(() => {
    setIsRead(!thread.isUnread);
  }, [thread.threadId, thread.isUnread]);

  const archiveMutation = useMutation({
    mutationFn: async ({ account, threadId, markRead }: ThreadMutationInput) => {
      await trpcClient.gmail.modifyThreadLabels.mutate({
        providerAccountId: account.providerAccountId,
        threadId,
        removeLabelIds: markRead ? ["INBOX", "UNREAD"] : ["INBOX"],
      });
    },
    onMutate: async ({ threadId }) => {
      const snapshot = getGmailThreadsSnapshot(queryClient);
      removeGmailThreadFromLists(queryClient, threadId);
      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      if (context?.snapshot) {
        restoreGmailThreadsSnapshot(queryClient, context.snapshot);
      }
    },
    onSuccess: (_data, variables) => {
      clearGmailThreadDetail(queryClient, variables.threadId, accountId);
      clearGmailDraftQueries(queryClient, {
        accountId,
        threadId: variables.threadId,
      });
      onClose();
      invalidateGmailThreads(queryClient);
    },
  });

  const trashMutation = useMutation({
    mutationFn: async ({ account, threadId }: ThreadMutationInput) => {
      await trpcClient.gmail.trashThread.mutate({
        providerAccountId: account.providerAccountId,
        threadId,
      });
    },
    onMutate: async ({ threadId }) => {
      const snapshot = getGmailThreadsSnapshot(queryClient);
      removeGmailThreadFromLists(queryClient, threadId);
      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      if (context?.snapshot) {
        restoreGmailThreadsSnapshot(queryClient, context.snapshot);
      }
    },
    onSuccess: (_data, variables) => {
      clearGmailThreadDetail(queryClient, variables.threadId, accountId);
      clearGmailDraftQueries(queryClient, {
        accountId,
        threadId: variables.threadId,
      });
      onClose();
      invalidateGmailThreads(queryClient);
    },
  });

  const unreadMutation = useMutation({
    mutationFn: async ({ account, threadId, isUnread }: SetUnreadInput) => {
      if (isUnread) {
        await trpcClient.gmail.modifyThreadLabels.mutate({
          providerAccountId: account.providerAccountId,
          threadId,
          addLabelIds: ["UNREAD"],
        });
      } else {
        await trpcClient.gmail.modifyThreadLabels.mutate({
          providerAccountId: account.providerAccountId,
          threadId,
          removeLabelIds: ["UNREAD"],
        });
      }
    },
    onMutate: async ({ threadId, isUnread }) => {
      const snapshot = getGmailThreadsSnapshot(queryClient);
      setGmailThreadUnreadState(queryClient, threadId, isUnread);
      setIsRead(!isUnread);
      return { snapshot, previousIsRead: isRead };
    },
    onError: (_error, _variables, context) => {
      if (context?.snapshot) {
        restoreGmailThreadsSnapshot(queryClient, context.snapshot);
      }
      if (context?.previousIsRead !== undefined) {
        setIsRead(context.previousIsRead);
      }
    },
    onSettled: (_data, _error, variables) => {
      // Only refetch this thread's detail — the optimistic update already
      // reflects the correct read/unread state in the thread lists.
      queryClient.invalidateQueries({
        queryKey: gmailKeys.thread(variables.threadId, accountId),
        exact: true,
      });
    },
  });

  return {
    isRead,
    isArchiving: archiveMutation.isPending,
    isTrashing: trashMutation.isPending,
    isTogglingRead: unreadMutation.isPending,
    archive: () => {
      if (!googleAccount) {
        throw new Error("No Google account connected");
      }
      return archiveMutation.mutateAsync({
        account: googleAccount,
        threadId: thread.threadId,
        markRead: isRead,
      });
    },
    trash: () => {
      if (!googleAccount) {
        throw new Error("No Google account connected");
      }
      return trashMutation.mutateAsync({
        account: googleAccount,
        threadId: thread.threadId,
      });
    },
    toggleRead: () => {
      if (!googleAccount) {
        throw new Error("No Google account connected");
      }
      return unreadMutation.mutateAsync({
        account: googleAccount,
        threadId: thread.threadId,
        isUnread: isRead,
      });
    },
  };
}

export function useSaveGmailDraftMutation(
  googleAccount: OAuthConnection | null,
) {
  const queryClient = useQueryClient();
  const accountId = googleAccount?.providerAccountId ?? null;

  return useMutation({
    mutationFn: async ({ draftId, raw, threadId }: SaveDraftInput) => {
      if (!googleAccount) {
        throw new Error("No Google account connected");
      }

      return trpcClient.gmail.saveDraft.mutate({
        providerAccountId: googleAccount.providerAccountId,
        draftId,
        raw,
        threadId,
      });
    },
    onSuccess: (data, variables) => {
      if (variables.threadId) {
        queryClient.setQueryData(
          gmailKeys.draftId(variables.threadId, accountId),
          data.id,
        );
        queryClient.setQueryData<GmailThreadDraft[]>(
          gmailKeys.threadDrafts(variables.threadId, accountId),
          (current) => {
            const nextDraft = {
              draftId: data.id,
              messageId: data.message.id,
              threadId: data.message.threadId,
            };
            const drafts = current ?? [];
            const remaining = drafts.filter(
              (draft) => draft.draftId !== data.id,
            );
            return [...remaining, nextDraft];
          },
        );
      }
    },
  });
}

export function useDeleteGmailDraftMutation(
  googleAccount: OAuthConnection | null,
) {
  const queryClient = useQueryClient();
  const accountId = googleAccount?.providerAccountId ?? null;

  return useMutation({
    mutationFn: async (input: { draftId: string; threadId?: string | null }) => {
      if (!googleAccount) {
        throw new Error("No Google account connected");
      }

      await trpcClient.gmail.deleteDraft.mutate({
        providerAccountId: googleAccount.providerAccountId,
        draftId: input.draftId,
        threadId: input.threadId,
      });
      return input;
    },
    onSuccess: (input) => {
      if (input.threadId) {
        queryClient.setQueryData<GmailThreadDraft[]>(
          gmailKeys.threadDrafts(input.threadId, accountId),
          (current) =>
            current?.filter((draft) => draft.draftId !== input.draftId) ?? [],
        );
      }

      clearGmailDraftQueries(queryClient, {
        accountId,
        draftId: input.draftId,
        threadId: input.threadId,
      });

      if (input.threadId) {
        queryClient.invalidateQueries({
          queryKey: gmailKeys.thread(input.threadId, accountId),
          exact: true,
        });
      }

      invalidateGmailThreads(queryClient);
    },
  });
}

export function useSendGmailMessageMutation(
  googleAccount: OAuthConnection | null,
) {
  const queryClient = useQueryClient();
  const accountId = googleAccount?.providerAccountId ?? null;

  return useMutation({
    mutationFn: async ({ draftId, raw, threadId }: SendMessageInput) => {
      if (!googleAccount) {
        throw new Error("No Google account connected");
      }

      await trpcClient.gmail.sendMessage.mutate({
        providerAccountId: googleAccount.providerAccountId,
        draftId,
        raw,
        threadId,
      });

      return { draftId, threadId };
    },
    onSuccess: ({ draftId, threadId }) => {
      if (draftId && threadId) {
        queryClient.setQueryData<GmailThreadDraft[]>(
          gmailKeys.threadDrafts(threadId, accountId),
          (current) =>
            current?.filter((draft) => draft.draftId !== draftId) ?? [],
        );
      }

      clearGmailDraftQueries(queryClient, {
        accountId,
        draftId,
        threadId,
      });

      if (threadId) {
        queryClient.invalidateQueries({
          queryKey: gmailKeys.thread(threadId, accountId),
          exact: true,
        });
      }

      invalidateGmailThreads(queryClient);
    },
  });
}
