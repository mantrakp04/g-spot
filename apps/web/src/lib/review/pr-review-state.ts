import type { ReviewTarget } from "@/hooks/use-github-detail";
import type { PendingCommentsKey } from "@/hooks/use-pending-comments";

export function getPendingCommentsKey(target: ReviewTarget): PendingCommentsKey {
  return {
    owner: target.owner,
    repo: target.repo,
    prNumber: target.number,
  };
}

export function getPRReviewState(input: {
  detailLoading: boolean;
  filesLoading: boolean;
  timelineLoading: boolean;
  reviewComments?: Record<string, readonly unknown[]>;
}) {
  let inlineCommentCount = 0;
  for (const list of Object.values(input.reviewComments ?? {})) {
    inlineCommentCount += list.length;
  }

  return {
    isLoading:
      input.detailLoading || input.filesLoading || input.timelineLoading,
    inlineCommentCount,
  };
}
