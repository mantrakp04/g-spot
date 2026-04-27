import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import type { FilterRule, SectionSource } from "@g-spot/types/filters";

import { trpcClient } from "@/utils/trpc";

export type QueryableFilterValue = {
  field: string;
  value: string;
  label: string;
};

export type BuildSectionFiltersContext = {
  name: string;
  source: SectionSource;
  currentFilters: FilterRule;
  repos: string[];
  accountId: string | null;
  accountLabel: string | null;
  queryableValues: QueryableFilterValue[];
};

function dedupeQueryableValues(values: QueryableFilterValue[]) {
  const seen = new Set<string>();
  const deduped: QueryableFilterValue[] = [];

  for (const value of values) {
    const trimmedValue = value.value.trim();
    if (!trimmedValue) continue;
    const key = `${value.field}:${trimmedValue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      field: value.field,
      value: trimmedValue,
      label: value.label.trim() || trimmedValue,
    });
  }

  return deduped;
}

export function useSectionFilterAgent({
  onBuilt,
}: {
  onBuilt: (filters: FilterRule) => void;
}) {
  return useMutation({
    mutationFn: (context: BuildSectionFiltersContext) =>
      trpcClient.sections.buildFilters.mutate({
        ...context,
        name: context.name.trim(),
        queryableValues: dedupeQueryableValues(context.queryableValues),
      }),
    onSuccess: (result) => {
      onBuilt(result.filters);
      toast.success(result.note || "Filters built");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to build filters");
    },
  });
}
