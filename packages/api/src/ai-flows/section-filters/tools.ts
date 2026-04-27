import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  sectionFiltersSchema,
  type FilterRule,
  type SectionSource,
} from "@g-spot/types/filters";

import {
  getAllowedSectionFilterFields,
  getSectionFilterCatalog,
  type SectionFilterField,
} from "./catalog";

export type QueryableFilterValue = {
  field: string;
  value: string;
  label: string;
};

export type SectionFilterToolContext = {
  source: SectionSource;
  queryableValues: QueryableFilterValue[];
};

type BuiltFilterResult = {
  filters: FilterRule;
  note: string;
};

function filterCatalog(
  fields: SectionFilterField[],
  query: string | undefined,
) {
  const normalizedQuery = query?.trim().toLowerCase();
  if (!normalizedQuery) return fields;

  return fields.filter(
    (field) =>
      field.field.toLowerCase().includes(normalizedQuery)
      || field.label.toLowerCase().includes(normalizedQuery)
      || field.hint?.toLowerCase().includes(normalizedQuery),
  );
}

function filterValues(
  values: QueryableFilterValue[],
  field: string | undefined,
  query: string | undefined,
) {
  const normalizedField = field?.trim();
  const normalizedQuery = query?.trim().toLowerCase();

  return values.filter((value) => {
    if (normalizedField && value.field !== normalizedField) return false;
    if (!normalizedQuery) return true;
    return (
      value.value.toLowerCase().includes(normalizedQuery)
      || value.label.toLowerCase().includes(normalizedQuery)
    );
  }).slice(0, 50);
}

function assertFilterRuleIsAllowed(
  rule: FilterRule,
  allowedFields: ReturnType<typeof getAllowedSectionFilterFields>,
) {
  if (rule.type === "group") {
    for (const child of rule.children) {
      assertFilterRuleIsAllowed(child, allowedFields);
    }
    return;
  }

  const field = allowedFields.get(rule.field);
  if (!field) {
    throw new Error(`Unsupported filter field "${rule.field}".`);
  }

  if (!field.operators.includes(rule.operator)) {
    throw new Error(`Unsupported operator "${rule.operator}" for "${rule.field}".`);
  }

  if (field.valueType === "boolean" && rule.value !== "true" && rule.value !== "false") {
    throw new Error(`"${rule.field}" must be "true" or "false".`);
  }

  if (field.options && !field.options.some((option) => option.value === rule.value)) {
    throw new Error(`Unsupported value "${rule.value}" for "${rule.field}".`);
  }
}

export function createSectionFilterTools(
  context: SectionFilterToolContext,
  onBuilt: (result: BuiltFilterResult) => void,
): ToolDefinition[] {
  const fields = getSectionFilterCatalog(context.source);
  const allowedFields = getAllowedSectionFilterFields(context.source);

  const queryFilterFields = defineTool({
    name: "query_filter_fields",
    label: "Query Filter Fields",
    description:
      "Inspect available section filter fields, operators, value types, and known options.",
    promptSnippet: "query_filter_fields: inspect available filter fields and values.",
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "Optional field search text." })),
      field: Type.Optional(Type.String({ description: "Optional exact field for known values." })),
      valueQuery: Type.Optional(Type.String({ description: "Optional value search text." })),
    }),
    async execute(_toolCallId, params) {
      const result = {
        fields: filterCatalog(fields, params.query),
        values: filterValues(context.queryableValues, params.field, params.valueQuery),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: undefined,
      };
    },
  });

  const setSectionFilters = defineTool({
    name: "set_section_filters",
    label: "Set Section Filters",
    description:
      "Commit the final section filters. Call this exactly once with the complete filter tree.",
    promptSnippet: "set_section_filters: commit the final section filters.",
    parameters: Type.Object({
      filters: Type.Any({ description: "A FilterRule tree." }),
      note: Type.Optional(Type.String({ description: "Short summary of what was built." })),
    }),
    async execute(_toolCallId, params) {
      const parsed = sectionFiltersSchema.parse(params.filters);
      assertFilterRuleIsAllowed(parsed, allowedFields);

      onBuilt({
        filters: parsed,
        note: params.note?.trim() || "Filters built.",
      });

      return {
        content: [{ type: "text", text: "Section filters accepted." }],
        details: undefined,
      };
    },
  });

  return [queryFilterFields, setSectionFilters];
}
