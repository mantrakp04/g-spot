import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";

import type { GmailThreadPage } from "@/lib/gmail/types";
import { gmailKeys } from "@/lib/query-keys";

type GmailThreadsSnapshot = Array<
  [QueryKey, InfiniteData<GmailThreadPage> | undefined]
>;

export function getGmailThreadsSnapshot(
  queryClient: QueryClient,
): GmailThreadsSnapshot {
  return queryClient.getQueriesData<InfiniteData<GmailThreadPage>>({
    queryKey: gmailKeys.threadsRoot(),
  });
}

export function restoreGmailThreadsSnapshot(
  queryClient: QueryClient,
  snapshot: GmailThreadsSnapshot,
) {
  for (const [queryKey, data] of snapshot) {
    queryClient.setQueryData(queryKey, data);
  }
}

export function removeGmailThreadFromLists(
  queryClient: QueryClient,
  threadId: string,
) {
  queryClient.setQueriesData<InfiniteData<GmailThreadPage>>(
    { queryKey: gmailKeys.threadsRoot() },
    (old) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          threads: page.threads.filter((thread) => thread.threadId !== threadId),
        })),
      };
    },
  );
}

export function setGmailThreadUnreadState(
  queryClient: QueryClient,
  threadId: string,
  isUnread: boolean,
) {
  queryClient.setQueriesData<InfiniteData<GmailThreadPage>>(
    { queryKey: gmailKeys.threadsRoot() },
    (old) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          threads: page.threads.map((thread) =>
            thread.threadId === threadId
              ? {
                  ...thread,
                  isUnread,
                  labels: isUnread
                    ? thread.labels.includes("UNREAD")
                      ? thread.labels
                      : [...thread.labels, "UNREAD"]
                    : thread.labels.filter((label) => label !== "UNREAD"),
                }
              : thread,
          ),
        })),
      };
    },
  );
}

export function clearGmailThreadDetail(
  queryClient: QueryClient,
  threadId: string,
  accountId: string | null | undefined,
) {
  queryClient.removeQueries({
    queryKey: gmailKeys.thread(threadId, accountId),
    exact: true,
  });
}

export function clearGmailDraftQueries(
  queryClient: QueryClient,
  input: {
    accountId: string | null | undefined;
    threadId?: string | null;
    draftId?: string | null;
  },
) {
  const { accountId, threadId, draftId } = input;

  if (threadId) {
    queryClient.removeQueries({
      queryKey: gmailKeys.threadDrafts(threadId, accountId),
      exact: true,
    });
    queryClient.removeQueries({
      queryKey: gmailKeys.draftId(threadId, accountId),
      exact: true,
    });
  }

  if (draftId) {
    queryClient.removeQueries({
      queryKey: gmailKeys.draftCompose(draftId, accountId),
      exact: true,
    });
  }
}

export function invalidateGmailThreads(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    queryKey: gmailKeys.threadsRoot(),
  });
}
