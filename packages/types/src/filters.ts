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
  field: z.string().min(1),
  operator: filterOperatorSchema,
  value: z.string(),
  logic: filterLogicSchema.default("and"),
});

export type FilterCondition = z.infer<typeof filterConditionSchema>;

export const sectionFiltersSchema = z.array(filterConditionSchema);

export const sectionSourceSchema = z.enum(["github_pr", "github_issue", "gmail"]);
export type SectionSource = z.infer<typeof sectionSourceSchema>;
