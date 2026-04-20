import { createFileRoute, useParams } from "@tanstack/react-router";
import { useUser } from "@stackframe/react";

import { PRReviewView } from "@/components/review/pr-review-view";
import { IssueReviewView } from "@/components/review/issue-review-view";
import type { ReviewTarget } from "@/hooks/use-github-detail";

export const Route = createFileRoute("/review/$kind/$owner/$repo/$number")({
  component: ReviewDetail,
});

function ReviewDetail() {
  const { kind, owner, repo, number } = useParams({
    from: "/review/$kind/$owner/$repo/$number",
  });
  const user = useUser();
  const accounts = user?.useConnectedAccounts();
  const account =
    accounts?.find((a) => a.provider === "github") ?? null;

  if (kind !== "pr" && kind !== "issue") {
    return (
      <div className="p-6 text-[14px] text-destructive">
        Unknown review kind: {kind}
      </div>
    );
  }

  const target: ReviewTarget = {
    kind,
    owner,
    repo,
    number: Number(number),
  };

  if (!account) {
    return (
      <div className="mx-auto max-w-md p-12 text-center">
        <div className="text-[14px] text-muted-foreground">
          Connect a GitHub account in settings to open reviews.
        </div>
      </div>
    );
  }

  return kind === "pr" ? (
    <PRReviewView target={target} account={account} />
  ) : (
    <IssueReviewView target={target} account={account} />
  );
}
