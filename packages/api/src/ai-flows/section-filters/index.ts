import { z } from "zod";
import {
  sectionFiltersSchema,
  sectionSourceSchema,
  stripFilterRuleIds,
  type FilterRule,
} from "@g-spot/types/filters";

import {
  createPiAgentSession,
  getPiAgentDefaults,
  normalizePiAgentConfig,
} from "../../lib/pi";
import {
  createSectionFilterTools,
  type QueryableFilterValue,
} from "./tools";

export const queryableFilterValueSchema = z.object({
  field: z.string().min(1),
  value: z.string().min(1),
  label: z.string().min(1),
});

export const buildSectionFiltersInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  source: sectionSourceSchema,
  currentFilters: sectionFiltersSchema,
  repos: z.array(z.string()).default([]),
  accountId: z.string().nullable().default(null),
  accountLabel: z.string().trim().max(200).nullable().default(null),
  queryableValues: z.array(queryableFilterValueSchema).max(300).default([]),
});

export type BuildSectionFiltersInput = z.infer<typeof buildSectionFiltersInputSchema>;

type BuiltSectionFilters = {
  filters: FilterRule;
  note: string;
};

function dedupeQueryableValues(values: QueryableFilterValue[]) {
  const seen = new Set<string>();
  const deduped: QueryableFilterValue[] = [];

  for (const value of values) {
    const key = `${value.field}:${value.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(value);
  }

  return deduped;
}

export async function buildSectionFilters(
  input: BuildSectionFiltersInput,
): Promise<BuiltSectionFilters> {
  let built: BuiltSectionFilters | null = null;
  const defaults = await getPiAgentDefaults();
  const workerConfig = normalizePiAgentConfig(defaults.worker);
  const queryableValues = dedupeQueryableValues(input.queryableValues);

  const { session } = await createPiAgentSession({
    config: workerConfig,
    activeToolNames: [],
    disableProjectResources: true,
    customTools: createSectionFilterTools(
      {
        source: input.source,
        queryableValues,
      },
      (result) => {
        built = result;
      },
    ),
  });

  await session.prompt([
    "You build inbox section filters from a user's section name and current form context.",
    "Use the tools. First inspect available fields/values with query_filter_fields, then call set_section_filters exactly once.",
    "Return only filters supported by the selected source. Prefer a simple AND group unless the section name clearly needs OR logic.",
    "Preserve useful prefilled filters and selected repositories/account context when they match the section name.",
    "Do not invent opaque IDs. Values must be strings. Boolean values must be \"true\" or \"false\".",
    "",
    "Context:",
    JSON.stringify({
      name: input.name,
      source: input.source,
      currentFilters: stripFilterRuleIds(input.currentFilters),
      repos: input.repos,
      accountId: input.accountId,
      accountLabel: input.accountLabel,
      knownQueryableValueCount: queryableValues.length,
    }, null, 2),
  ].join("\n"));

  if (!built) {
    throw new Error("Pi did not return section filters.");
  }

  return built;
}
