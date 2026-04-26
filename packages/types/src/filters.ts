import { z } from "zod";

export const filterOperatorSchema = z.enum([
  "is",
  "is_not",
  "contains",
  "not_contains",
  "gt",
  "lt",
  "gte",
  "lte",
  "between",
]);

export type FilterOperator = z.infer<typeof filterOperatorSchema>;

export const filterLogicSchema = z.enum(["and", "or"]);
export type FilterLogic = z.infer<typeof filterLogicSchema>;

export const githubPrFields = [
  "status",
  "draft",
  "review_status",
  "author",
  "reviewer",
  "team_reviewer",
  "assignee",
  "mentions",
  "involves",
  "repo",
  "label",
  "milestone",
  "language",
  "head",
  "base",
  "created",
  "updated",
  "merged",
  "closed",
  "comments",
  "interactions",
] as const;

export const githubIssueFields = [
  "status",
  "author",
  "assignee",
  "mentions",
  "involves",
  "repo",
  "label",
  "milestone",
  "language",
  "created",
  "updated",
  "closed",
  "comments",
  "interactions",
] as const;

export const gmailFields = [
  "from",
  "to",
  "cc",
  "bcc",
  "deliveredto",
  "list",
  "subject",
  "has_attachment",
  "has_drive",
  "has_document",
  "has_spreadsheet",
  "has_presentation",
  "has_youtube",
  "filename",
  "label",
  "category",
  "in",
  "is_unread",
  "is_read",
  "is_starred",
  "is_important",
  "is_snoozed",
  "is_muted",
  "after",
  "before",
  "older_than",
  "newer_than",
  "larger",
  "smaller",
] as const;

export const filterConditionSchema = z.object({
  type: z.literal("condition").default("condition"),
  id: z.string().optional(),
  field: z.string().min(1),
  operator: filterOperatorSchema,
  value: z.string(),
  logic: filterLogicSchema.default("and"),
});

export type FilterCondition = z.infer<typeof filterConditionSchema>;

export type FilterGroup = {
  type: "group";
  id?: string;
  operator: FilterLogic;
  children: FilterRule[];
};

export type FilterRule = FilterCondition | FilterGroup;

export const filterGroupSchema: z.ZodType<FilterGroup> = z.object({
  type: z.literal("group"),
  id: z.string().optional(),
  operator: filterLogicSchema.default("and"),
  children: z.lazy(() => filterRuleSchema.array()).default([]),
});

export const filterRuleSchema: z.ZodType<FilterRule> = z.union([
  filterConditionSchema,
  filterGroupSchema,
]);

export const sectionFiltersSchema = filterRuleSchema.default({
  type: "group",
  operator: "and",
  children: [],
});

export function createEmptyFilterCondition(
  source: SectionSource = "github_pr",
): FilterCondition {
  return {
    type: "condition",
    field: source === "gmail" ? "from" : "status",
    operator: "is",
    value: "",
    logic: "and",
  };
}

export function createEmptyFilterGroup(
  operator: FilterLogic = "and",
  children: FilterRule[] = [],
): FilterGroup {
  return {
    type: "group",
    operator,
    children,
  };
}

function isFilterConditionLike(value: unknown): value is FilterCondition {
  return Boolean(
    value
    && typeof value === "object"
    && "field" in value
    && "operator" in value
    && "value" in value,
  );
}

function conditionHasValue(condition: FilterCondition): boolean {
  return condition.value.trim().length > 0;
}

export function normalizeFilterRule(value: unknown): FilterRule {
  if (Array.isArray(value)) {
    return legacyFilterArrayToRule(value.filter(isFilterConditionLike));
  }

  const parsed = filterRuleSchema.safeParse(value);
  if (parsed.success) return parsed.data;

  return createEmptyFilterGroup();
}

export function legacyFilterArrayToRule(filters: FilterCondition[]): FilterGroup {
  const orGroups: FilterGroup[] = [];

  for (const filter of filters) {
    const condition: FilterCondition = {
      type: "condition",
      field: filter.field,
      operator: filter.operator,
      value: filter.value,
      logic: filter.logic ?? "and",
      ...(filter.id ? { id: filter.id } : {}),
    };

    if (orGroups.length === 0 || condition.logic === "or") {
      orGroups.push(createEmptyFilterGroup("and", [condition]));
    } else {
      orGroups[orGroups.length - 1]!.children.push(condition);
    }
  }

  if (orGroups.length === 0) return createEmptyFilterGroup();
  if (orGroups.length === 1) return orGroups[0]!;
  return createEmptyFilterGroup("or", orGroups);
}

export function filterRuleHasConditions(rule: FilterRule): boolean {
  if (rule.type === "condition") return conditionHasValue(rule);
  return rule.children.some(filterRuleHasConditions);
}

export function pruneEmptyFilterRule(rule: FilterRule): FilterRule {
  if (rule.type === "condition") return rule;

  return {
    ...rule,
    children: rule.children
      .map(pruneEmptyFilterRule)
      .filter((child) => child.type === "group" || conditionHasValue(child)),
  };
}

export function stripFilterRuleIds(rule: FilterRule): FilterRule {
  if (rule.type === "condition") {
    const { id: _id, ...condition } = rule;
    return condition;
  }

  const { id: _id, ...group } = rule;
  return {
    ...group,
    children: group.children.map(stripFilterRuleIds),
  };
}

export function flattenFilterConditions(rule: FilterRule): FilterCondition[] {
  if (rule.type === "condition") return [rule];
  return rule.children.flatMap(flattenFilterConditions);
}

export const sectionSourceSchema = z.enum(["github_pr", "github_issue", "gmail"]);
export type SectionSource = z.infer<typeof sectionSourceSchema>;

// ── Column Configuration ───────────────────────────────────────────────────

export const columnAlignmentSchema = z.enum(["left", "center", "right"]);
export type ColumnAlignment = z.infer<typeof columnAlignmentSchema>;

export const columnTruncationSchema = z.enum(["end", "middle"]);
export type ColumnTruncation = z.infer<typeof columnTruncationSchema>;

export const columnSizingSchema = z.enum(["fixed", "fit", "fill"]);
export type ColumnSizing = z.infer<typeof columnSizingSchema>;

export const columnConfigSchema = z.object({
  id: z.string(),
  visible: z.boolean(),
  sizing: columnSizingSchema.optional(),
  width: z.number().nullable().default(null),
  minWidth: z.number().finite().optional(),
  maxWidth: z.number().finite().optional(),
  label: z.string().trim().max(32).nullable().default(null),
  headerAlign: columnAlignmentSchema.nullable().default(null),
  align: columnAlignmentSchema.nullable().default(null),
  truncation: columnTruncationSchema.nullable().default(null),
});

export type ColumnConfig = z.infer<typeof columnConfigSchema>;

export const sectionColumnsSchema = z.array(columnConfigSchema);

// Column definitions per source type

export const PR_COLUMN_IDS = [
  "title",
  "reviewers",
  "ci",
  "review",
  "labels",
  "changes",
  "updated",
] as const;

export const ISSUE_COLUMN_IDS = [
  "title",
  "labels",
  "assignees",
  "status",
  "reactions",
  "comments",
  "milestone",
  "created",
  "updated",
] as const;

export const GMAIL_COLUMN_IDS = [
  "from",
  "labels",
  "subject",
  "date",
] as const;

export type PrColumnId = (typeof PR_COLUMN_IDS)[number];
export type IssueColumnId = (typeof ISSUE_COLUMN_IDS)[number];
export type GmailColumnId = (typeof GMAIL_COLUMN_IDS)[number];

/**
 * Column sizing strategy:
 * - "fixed"  → exact pixel width (e.g. icons, timestamps)
 * - "fit"    → shrink-wrap to content, with optional min/max
 * - "fill"   → take remaining space (only one per table)
 */
/** Responsive breakpoint at which column becomes visible */
export type ColumnBreakpoint = "always" | "sm" | "md" | "lg" | "xl";

export type ColumnMeta = {
  id: string;
  label: string;
  defaultVisible: boolean;
  /** Sizing strategy */
  sizing: ColumnSizing;
  /** Width in pixels (used when sizing is "fixed") */
  width?: number;
  /** Minimum width floor in pixels after padding and alignment */
  minWidth?: number;
  /** Default max width for auto-sized "fit" columns before any explicit user override */
  maxWidth?: number;
  align?: ColumnAlignment;
  truncation?: ColumnTruncation;
  /** Responsive breakpoint — column hidden below this */
  breakpoint?: ColumnBreakpoint;
};

export const PR_COLUMN_META: Record<PrColumnId, ColumnMeta> = {
  title:      { id: "title",      label: "Title",      defaultVisible: true,  sizing: "fill",  minWidth: 280, align: "left", truncation: "end", breakpoint: "always" },
  reviewers:  { id: "reviewers",  label: "Reviewers",  defaultVisible: true,  sizing: "fixed", width: 112, align: "left", truncation: "middle", breakpoint: "md" },
  ci:         { id: "ci",         label: "CI",         defaultVisible: true,  sizing: "fixed", width: 48,  align: "center", breakpoint: "sm" },
  review:     { id: "review",     label: "Review",     defaultVisible: true,  sizing: "fixed", width: 48,  minWidth: 72, align: "center", breakpoint: "sm" },
  labels:     { id: "labels",     label: "Labels",     defaultVisible: false, sizing: "fit",   maxWidth: 144, align: "left", breakpoint: "lg" },
  changes:    { id: "changes",    label: "Changes",    defaultVisible: true,  sizing: "fit",   maxWidth: 112, align: "right", truncation: "end", breakpoint: "lg" },
  updated:    { id: "updated",    label: "Updated",    defaultVisible: true,  sizing: "fixed", width: 64,  align: "right", truncation: "end", breakpoint: "always" },
};

export const ISSUE_COLUMN_META: Record<IssueColumnId, ColumnMeta> = {
  title:      { id: "title",      label: "Title",      defaultVisible: true,  sizing: "fill",  minWidth: 280, align: "left", truncation: "end", breakpoint: "always" },
  labels:     { id: "labels",     label: "Labels",     defaultVisible: true,  sizing: "fixed", width: 72,     align: "left",   breakpoint: "lg" },
  assignees:  { id: "assignees",  label: "Assignees",  defaultVisible: false, sizing: "fixed", width: 96,     align: "left", truncation: "middle", breakpoint: "md" },
  status:     { id: "status",     label: "Status",     defaultVisible: true,  sizing: "fixed", width: 112,    align: "left",   breakpoint: "sm" },
  reactions:  { id: "reactions",  label: "Reactions",  defaultVisible: false, sizing: "fixed", width: 72,     minWidth: 88, align: "center", breakpoint: "sm" },
  comments:   { id: "comments",   label: "Comments",   defaultVisible: true,  sizing: "fixed", width: 64,     minWidth: 80, align: "center", truncation: "end", breakpoint: "md" },
  milestone:  { id: "milestone",  label: "Milestone",  defaultVisible: false, sizing: "fit",   maxWidth: 128, align: "left", truncation: "middle", breakpoint: "lg" },
  created:    { id: "created",    label: "Created",    defaultVisible: false, sizing: "fixed", width: 64,     align: "right", truncation: "end", breakpoint: "md" },
  updated:    { id: "updated",    label: "Updated",    defaultVisible: true,  sizing: "fixed", width: 64,     align: "right", truncation: "end", breakpoint: "always" },
};

export const GMAIL_COLUMN_META: Record<GmailColumnId, ColumnMeta> = {
  from:       { id: "from",       label: "From",        defaultVisible: true,  sizing: "fixed", width: 176, align: "left", truncation: "middle", breakpoint: "always" },
  labels:     { id: "labels",     label: "Labels",     defaultVisible: false, sizing: "fit",   maxWidth: 112, align: "left", truncation: "middle", breakpoint: "md" },
  subject:    { id: "subject",    label: "Subject",    defaultVisible: true,  sizing: "fill",  minWidth: 320, align: "left", truncation: "end", breakpoint: "always" },
  date:       { id: "date",       label: "Date",       defaultVisible: true,  sizing: "fixed", width: 80,  align: "right", truncation: "end", breakpoint: "always" },
};

const LEGACY_PRIMARY_COLUMN_IDS: Partial<Record<SectionSource, string>> = {
  github_pr: "__primary_title",
  github_issue: "__primary_title",
  gmail: "__primary_subject",
};

const LEGACY_PRIMARY_TARGET_COLUMN_IDS: Partial<Record<SectionSource, string>> = {
  github_pr: "title",
  github_issue: "title",
  gmail: "subject",
};

function getLegacyPrimaryWidth(
  source: SectionSource,
  columns: ColumnConfig[] | null | undefined,
): number | null {
  const legacyId = LEGACY_PRIMARY_COLUMN_IDS[source];
  if (!legacyId) return null;

  const legacyColumn = columns?.find((column) => column.id === legacyId);
  return typeof legacyColumn?.width === "number" ? legacyColumn.width : null;
}

export function getColumnMetaMap(source: SectionSource): Record<string, ColumnMeta> {
  if (source === "github_pr") return PR_COLUMN_META;
  if (source === "github_issue") return ISSUE_COLUMN_META;
  return GMAIL_COLUMN_META;
}

export function getColumnMeta(source: SectionSource, id: string): ColumnMeta | null {
  const metaMap = getColumnMetaMap(source);
  return metaMap[id] ?? null;
}

export function getColumnLabel(meta: ColumnMeta, column?: ColumnConfig): string {
  return column?.label?.trim() || meta.label;
}

export function getColumnSizing(meta: ColumnMeta, column?: ColumnConfig): ColumnSizing {
  return column?.sizing ?? meta.sizing;
}

export function getColumnContentAlign(meta: ColumnMeta, column?: ColumnConfig): ColumnAlignment | undefined {
  return column?.align ?? meta.align;
}

export function getColumnHeaderAlign(meta: ColumnMeta, column?: ColumnConfig): ColumnAlignment | undefined {
  return column?.headerAlign ?? column?.align ?? meta.align;
}

export function getColumnTruncation(meta: ColumnMeta, column?: ColumnConfig): ColumnTruncation {
  return column?.truncation ?? meta.truncation ?? "end";
}

function normalizeBound(value: number | null | undefined): number | undefined {
  if (value == null || Number.isNaN(value)) return undefined;
  return Math.max(1, Math.round(value));
}

export function getColumnWidthBounds(meta: ColumnMeta, column?: ColumnConfig): {
  min: number | undefined;
  max: number | undefined;
} {
  const min = normalizeBound(column?.minWidth) ?? meta.minWidth;
  let max = normalizeBound(column?.maxWidth) ?? meta.maxWidth;

  if (min !== undefined && max !== undefined && max < min) {
    max = min;
  }

  return {
    min,
    max,
  };
}

export function clampColumnWidth(
  meta: ColumnMeta,
  width: number | null | undefined,
  column?: Pick<ColumnConfig, "minWidth" | "maxWidth">,
): number | null {
  if (width == null || Number.isNaN(width)) return null;

  const bounds = getColumnWidthBounds(meta, column as ColumnConfig | undefined);
  let nextWidth = Math.round(width);
  if (bounds.min !== undefined) nextWidth = Math.max(nextWidth, bounds.min);
  if (bounds.max !== undefined) nextWidth = Math.min(nextWidth, bounds.max);
  return nextWidth;
}

export function getDefaultColumns(source: SectionSource): ColumnConfig[] {
  const ids = source === "github_pr"
    ? PR_COLUMN_IDS
    : source === "github_issue"
      ? ISSUE_COLUMN_IDS
      : GMAIL_COLUMN_IDS;
  const metaMap = getColumnMetaMap(source);

  return ids.map((id) => {
    const meta = metaMap[id];
    if (!meta) {
      throw new Error(`Missing column meta for "${id}" in source "${source}"`);
    }

    return {
      id,
      visible: meta.defaultVisible,
      sizing: undefined,
      width: null,
      minWidth: undefined,
      maxWidth: undefined,
      label: null,
      headerAlign: null,
      align: null,
      truncation: null,
    };
  });
}

export function normalizeColumns(
  source: SectionSource,
  columns: ColumnConfig[] | null | undefined,
): ColumnConfig[] {
  const defaults = getDefaultColumns(source);
  const defaultMap = new Map(defaults.map((column) => [column.id, column]));
  const legacyPrimaryWidth = getLegacyPrimaryWidth(source, columns);
  const legacyPrimaryTargetId = LEGACY_PRIMARY_TARGET_COLUMN_IDS[source];

  if (!columns || columns.length === 0) return defaults;

  const normalized = columns
    .map((column) => {
      const meta = getColumnMeta(source, column.id);
      const base = defaultMap.get(column.id);
      if (!meta || !base) return null;

      const minWidth = normalizeBound(column.minWidth);
      let maxWidth = normalizeBound(column.maxWidth);
      if (minWidth !== undefined && maxWidth !== undefined && maxWidth < minWidth) {
        maxWidth = minWidth;
      }

      const normalizedColumn: ColumnConfig = {
        ...base,
        ...column,
        sizing: column.sizing ?? undefined,
        minWidth,
        maxWidth,
        label: column.label?.trim() || null,
        headerAlign: column.headerAlign ?? null,
        align: column.align ?? null,
        truncation: column.truncation ?? null,
        width: null,
      };

      return {
        ...normalizedColumn,
        width: clampColumnWidth(
          meta,
          column.width ?? (column.id === legacyPrimaryTargetId ? legacyPrimaryWidth : null),
          normalizedColumn,
        ),
      };
    })
    .filter((column): column is ColumnConfig => column !== null);

  const knownIds = new Set(normalized.map((column) => column.id));
  const missingDefaults = defaults.map((column) => {
    if (knownIds.has(column.id)) return null;

    if (column.id === legacyPrimaryTargetId && legacyPrimaryWidth != null) {
      const meta = getColumnMeta(source, column.id);
      return meta
        ? { ...column, width: clampColumnWidth(meta, legacyPrimaryWidth) }
        : column;
    }

    return column;
  }).filter((column): column is ColumnConfig => column !== null);

  return [...normalized, ...missingDefaults];
}
