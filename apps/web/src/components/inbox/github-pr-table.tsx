import { useState, useEffect } from "react";

import type { FilterCondition } from "@g-spot/api/schemas/section-filters";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@g-spot/ui/components/table";
import { useUser } from "@stackframe/react";
import { Loader2 } from "lucide-react";

import { GitHubPRRow } from "./github-pr-row";
import { SectionEmpty } from "./section-empty";
import { SectionSkeleton } from "./section-skeleton";
import { useGitHubPRs } from "@/hooks/use-github-prs";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";

type GitHubPRTableProps = {
  sectionId: string;
  filters: FilterCondition[];
  repos?: string[];
  accountId?: string | null;
  sortAsc?: boolean;
  onCountChange?: (count: number) => void;
};

export function GitHubPRTable({ sectionId, filters, repos, accountId, sortAsc, onCountChange }: GitHubPRTableProps) {
  const user = useUser();
  const accounts = user?.useConnectedAccounts();
  const githubAccount = accountId
    ? accounts?.find((a) => a.providerAccountId === accountId) ?? null
    : accounts?.find((a) => a.provider === "github") ?? null;

  const { data, isLoading, isError, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useGitHubPRs(sectionId, filters, githubAccount, repos, sortAsc);

  // Report total count to parent
  const totalCount = data?.pages[0]?.totalCount ?? 0;
  useEffect(() => {
    onCountChange?.(totalCount);
  }, [totalCount, onCountChange]);

  const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);
  const sentinelRef = useInfiniteScroll({
    hasNextPage: hasNextPage ?? false,
    isFetchingNextPage,
    fetchNextPage: () => void fetchNextPage(),
    root: scrollContainer,
  });

  if (!user) {
    return (
      <SectionEmpty source="github_pr" message="Sign in to view pull requests" />
    );
  }

  if (!githubAccount) {
    return (
      <SectionEmpty
        source="github_pr"
        message="Connect your GitHub account to view pull requests"
      />
    );
  }

  if (isLoading) {
    return <SectionSkeleton rows={7} />;
  }

  if (isError) {
    return (
      <SectionEmpty
        source="github_pr"
        message={error?.message ?? "Failed to load pull requests"}
      />
    );
  }

  const prs = data?.pages.flatMap((p) => p.prs) ?? [];

  if (prs.length === 0) {
    return <SectionEmpty source="github_pr" />;
  }

  return (
    <div ref={setScrollContainer} className="max-h-[28rem] overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-3">Title</TableHead>
            <TableHead className="hidden md:table-cell">Reviewers</TableHead>
            <TableHead className="hidden text-center sm:table-cell">CI</TableHead>
            <TableHead className="hidden text-center sm:table-cell">Review</TableHead>
            <TableHead className="hidden lg:table-cell">Changes</TableHead>
            <TableHead className="pr-3 text-right">Updated</TableHead>
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {prs.map((pr) => (
            <GitHubPRRow key={pr.id} pr={pr} />
          ))}
        </TableBody>
      </Table>

      {hasNextPage && <div ref={sentinelRef} className="h-1" />}

      {isFetchingNextPage && (
        <div className="flex justify-center py-2">
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
