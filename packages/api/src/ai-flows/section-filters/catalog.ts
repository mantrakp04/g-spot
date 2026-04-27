import {
  githubIssueFields,
  githubPrFields,
  gmailFields,
  type FilterOperator,
  type SectionSource,
} from "@g-spot/types/filters";

type FieldValueType = "select" | "combobox" | "boolean" | "date" | "text";

export type SectionFilterField = {
  field: string;
  label: string;
  valueType: FieldValueType;
  operators: FilterOperator[];
  options?: Array<{ value: string; label: string }>;
  hint?: string;
};

const identityOperators = ["is", "is_not"] satisfies FilterOperator[];
const textOperators = ["contains", "not_contains", "is", "is_not"] satisfies FilterOperator[];
const rangeOperators = ["gt", "lt", "gte", "lte"] satisfies FilterOperator[];
const unsupportedGmailFields = new Set(["bcc", "deliveredto", "list"]);

const githubStatusOptions = {
  github_pr: [
    { value: "open", label: "Open" },
    { value: "closed", label: "Closed" },
    { value: "merged", label: "Merged" },
  ],
  github_issue: [
    { value: "open", label: "Open" },
    { value: "closed", label: "Closed" },
  ],
} as const;

const reviewStatusOptions = [
  { value: "approved", label: "Approved" },
  { value: "changes_requested", label: "Changes requested" },
  { value: "required", label: "Review required" },
  { value: "none", label: "No review" },
];

const gmailSelectOptions: Record<string, Array<{ value: string; label: string }>> = {
  category: [
    { value: "primary", label: "Primary" },
    { value: "social", label: "Social" },
    { value: "promotions", label: "Promotions" },
    { value: "updates", label: "Updates" },
    { value: "forums", label: "Forums" },
  ],
  in: [
    { value: "inbox", label: "Inbox" },
    { value: "sent", label: "Sent" },
    { value: "draft", label: "Drafts" },
    { value: "trash", label: "Trash" },
    { value: "spam", label: "Spam" },
    { value: "anywhere", label: "Anywhere" },
  ],
};

const booleanFields = new Set([
  "draft",
  "has_attachment",
  "has_drive",
  "has_document",
  "has_spreadsheet",
  "has_presentation",
  "has_youtube",
  "is_unread",
  "is_read",
  "is_starred",
  "is_important",
  "is_snoozed",
  "is_muted",
]);

const dateFields = new Set([
  "created",
  "updated",
  "merged",
  "closed",
  "after",
  "before",
]);

const countFields = new Set(["comments", "interactions"]);

function toLabel(field: string) {
  return field
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildField(source: SectionSource, field: string): SectionFilterField {
  if (field === "status" && (source === "github_pr" || source === "github_issue")) {
    return {
      field,
      label: source === "github_pr" ? "PR status" : "Issue status",
      valueType: "select",
      operators: [...identityOperators],
      options: [...githubStatusOptions[source]],
    };
  }

  if (field === "review_status") {
    return {
      field,
      label: "Review status",
      valueType: "select",
      operators: [...identityOperators],
      options: reviewStatusOptions,
    };
  }

  if (booleanFields.has(field)) {
    return {
      field,
      label: toLabel(field),
      valueType: "boolean",
      operators: ["is"],
      options: [
        { value: "true", label: "True" },
        { value: "false", label: "False" },
      ],
    };
  }

  if (dateFields.has(field)) {
    return {
      field,
      label: toLabel(field),
      valueType: "date",
      operators: source === "gmail" ? ["is"] : [...rangeOperators],
      hint: source === "gmail" ? "Use YYYY/MM/DD." : "Use YYYY-MM-DD.",
    };
  }

  if (countFields.has(field)) {
    return {
      field,
      label: toLabel(field),
      valueType: "text",
      operators: ["gt", "lt", "gte", "lte"],
    };
  }

  if (source === "gmail" && gmailSelectOptions[field]) {
    return {
      field,
      label: toLabel(field),
      valueType: "select",
      operators: [...identityOperators],
      options: gmailSelectOptions[field],
    };
  }

  if (source === "gmail" && field === "subject") {
    return {
      field,
      label: "Subject",
      valueType: "combobox",
      operators: ["contains", "not_contains"],
    };
  }

  if (source === "gmail" && (field === "older_than" || field === "newer_than")) {
    return {
      field,
      label: toLabel(field),
      valueType: "text",
      operators: ["is"],
      hint: "Use a relative duration like 7d, 2w, 3m, or 1y.",
    };
  }

  if (source === "gmail" && (field === "larger" || field === "smaller")) {
    return {
      field,
      label: toLabel(field),
      valueType: "text",
      operators: ["is"],
      hint: "Use a size like 10mb, 500kb, or 1gb.",
    };
  }

  return {
    field,
    label: toLabel(field),
    valueType: "combobox",
    operators: [...textOperators],
  };
}

export function getSectionFilterCatalog(source: SectionSource): SectionFilterField[] {
  const fields =
    source === "github_pr"
      ? githubPrFields
      : source === "github_issue"
        ? githubIssueFields
        : gmailFields.filter((field) => !unsupportedGmailFields.has(field));

  return fields.map((field) => buildField(source, field));
}

export function getAllowedSectionFilterFields(source: SectionSource) {
  return new Map(getSectionFilterCatalog(source).map((field) => [field.field, field]));
}
