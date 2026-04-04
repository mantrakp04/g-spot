export type FieldValueType = "select" | "combobox" | "boolean" | "date" | "text";

export type FieldConfig = {
  label: string;
  valueType: FieldValueType;
  /** Static options for "select" type fields */
  options?: Array<{ value: string; label: string }>;
  /** Key for dynamic option fetching - used by the condition row to know which hook data to use */
  optionsKey?: "repos" | "labels" | "users" | "gmail_labels";
  /** Which operators this field supports. If undefined, all operators are available */
  operators?: Array<"is" | "is_not" | "contains" | "not_contains" | "gt" | "lt" | "gte" | "lte" | "between">;
  /** Placeholder hint for the value input */
  placeholder?: string;
  /** Optional group label for organizing fields in the dropdown */
  group?: string;
};

// ─── Shared GitHub Field Configs ─────────────────────────────────────────────

const githubPeopleFields: Record<string, FieldConfig> = {
  author: { label: "Author", valueType: "combobox", optionsKey: "users", group: "People" },
  assignee: { label: "Assignee", valueType: "combobox", optionsKey: "users", group: "People" },
  mentions: { label: "Mentions", valueType: "combobox", optionsKey: "users", group: "People" },
  involves: { label: "Involves", valueType: "combobox", optionsKey: "users", group: "People" },
};

const githubRepoFields: Record<string, FieldConfig> = {
  repo: { label: "Repository", valueType: "combobox", optionsKey: "repos", group: "Repository" },
  label: { label: "Label", valueType: "combobox", optionsKey: "labels", group: "Repository" },
  milestone: { label: "Milestone", valueType: "combobox", group: "Repository" },
  language: { label: "Language", valueType: "combobox", placeholder: "e.g. typescript", group: "Repository" },
};

const githubDateFields: Record<string, FieldConfig> = {
  created: { label: "Created", valueType: "date", operators: ["gt", "lt", "gte", "lte", "between"], placeholder: "YYYY-MM-DD", group: "Date" },
  updated: { label: "Updated", valueType: "date", operators: ["gt", "lt", "gte", "lte", "between"], placeholder: "YYYY-MM-DD", group: "Date" },
  closed: { label: "Closed", valueType: "date", operators: ["gt", "lt", "gte", "lte", "between"], placeholder: "YYYY-MM-DD", group: "Date" },
};

const githubActivityFields: Record<string, FieldConfig> = {
  comments: { label: "Comments", valueType: "text", operators: ["gt", "lt", "gte", "lte"], placeholder: "e.g. >5", group: "Activity" },
  interactions: { label: "Interactions", valueType: "text", operators: ["gt", "lt", "gte", "lte"], placeholder: "e.g. >10", group: "Activity" },
};

// ─── GitHub PR Filters ──────────────────────────────────────────────────────

export const githubPrFieldConfig: Record<string, FieldConfig> = {
  status: {
    label: "PR status",
    valueType: "select",
    options: [
      { value: "open", label: "Open" },
      { value: "closed", label: "Closed" },
      { value: "merged", label: "Merged" },
    ],
    operators: ["is", "is_not"],
    group: "Status",
  },
  draft: { label: "Draft", valueType: "boolean", operators: ["is"], group: "Status" },
  review_status: {
    label: "Review status",
    valueType: "select",
    options: [
      { value: "approved", label: "Approved" },
      { value: "changes_requested", label: "Changes requested" },
      { value: "required", label: "Review required" },
      { value: "none", label: "No review" },
    ],
    operators: ["is", "is_not"],
    group: "Status",
  },
  ...githubPeopleFields,
  reviewer: { label: "Reviewer", valueType: "combobox", optionsKey: "users", group: "People" },
  team_reviewer: { label: "Team reviewer", valueType: "combobox", optionsKey: "users", group: "People" },
  ...githubRepoFields,
  head: { label: "Head branch", valueType: "combobox", placeholder: "e.g. feature/my-branch", group: "Branches" },
  base: { label: "Base branch", valueType: "combobox", placeholder: "e.g. main", group: "Branches" },
  ...githubDateFields,
  merged: { label: "Merged", valueType: "date", operators: ["gt", "lt", "gte", "lte", "between"], placeholder: "YYYY-MM-DD", group: "Date" },
  ...githubActivityFields,
};

// ─── GitHub Issue Filters ───────────────────────────────────────────────────

export const githubIssueFieldConfig: Record<string, FieldConfig> = {
  status: {
    label: "Issue status",
    valueType: "select",
    options: [
      { value: "open", label: "Open" },
      { value: "closed", label: "Closed" },
    ],
    operators: ["is", "is_not"],
    group: "Status",
  },
  ...githubPeopleFields,
  ...githubRepoFields,
  ...githubDateFields,
  ...githubActivityFields,
};

// ─── Gmail Filters ──────────────────────────────────────────────────────────

export const gmailFieldConfig: Record<string, FieldConfig> = {
  // ── People ──
  from: {
    label: "From",
    valueType: "combobox",
    group: "People",
  },
  to: {
    label: "To",
    valueType: "combobox",
    group: "People",
  },
  cc: {
    label: "CC",
    valueType: "combobox",
    group: "People",
  },
  bcc: {
    label: "BCC",
    valueType: "combobox",
    group: "People",
  },
  deliveredto: {
    label: "Delivered to",
    valueType: "combobox",
    placeholder: "e.g. me@example.com",
    group: "People",
  },
  list: {
    label: "Mailing list",
    valueType: "combobox",
    placeholder: "e.g. info@list.example.com",
    group: "People",
  },

  // ── Content ──
  subject: {
    label: "Subject",
    valueType: "combobox",
    operators: ["contains", "not_contains"],
    group: "Content",
  },

  // ── Attachment ──
  has_attachment: {
    label: "Has attachment",
    valueType: "boolean",
    operators: ["is"],
    group: "Attachment",
  },
  has_drive: {
    label: "Has Drive file",
    valueType: "boolean",
    operators: ["is"],
    group: "Attachment",
  },
  has_document: {
    label: "Has Google Doc",
    valueType: "boolean",
    operators: ["is"],
    group: "Attachment",
  },
  has_spreadsheet: {
    label: "Has Google Sheet",
    valueType: "boolean",
    operators: ["is"],
    group: "Attachment",
  },
  has_presentation: {
    label: "Has Google Slides",
    valueType: "boolean",
    operators: ["is"],
    group: "Attachment",
  },
  has_youtube: {
    label: "Has YouTube",
    valueType: "boolean",
    operators: ["is"],
    group: "Attachment",
  },
  filename: {
    label: "Filename",
    valueType: "combobox",
    placeholder: "e.g. pdf, report.xlsx",
    group: "Attachment",
  },

  // ── Location / Status ──
  label: {
    label: "Label",
    valueType: "combobox",
    optionsKey: "gmail_labels",
    group: "Location",
  },
  category: {
    label: "Category",
    valueType: "select",
    options: [
      { value: "primary", label: "Primary" },
      { value: "social", label: "Social" },
      { value: "promotions", label: "Promotions" },
      { value: "updates", label: "Updates" },
      { value: "forums", label: "Forums" },
    ],
    operators: ["is", "is_not"],
    group: "Location",
  },
  in: {
    label: "In folder",
    valueType: "select",
    options: [
      { value: "inbox", label: "Inbox" },
      { value: "sent", label: "Sent" },
      { value: "draft", label: "Drafts" },
      { value: "trash", label: "Trash" },
      { value: "spam", label: "Spam" },
      { value: "anywhere", label: "Anywhere" },
    ],
    operators: ["is", "is_not"],
    group: "Location",
  },
  is_unread: {
    label: "Is unread",
    valueType: "boolean",
    operators: ["is"],
    group: "Status",
  },
  is_read: {
    label: "Is read",
    valueType: "boolean",
    operators: ["is"],
    group: "Status",
  },
  is_starred: {
    label: "Is starred",
    valueType: "boolean",
    operators: ["is"],
    group: "Status",
  },
  is_important: {
    label: "Is important",
    valueType: "boolean",
    operators: ["is"],
    group: "Status",
  },
  is_snoozed: {
    label: "Is snoozed",
    valueType: "boolean",
    operators: ["is"],
    group: "Status",
  },
  is_muted: {
    label: "Is muted",
    valueType: "boolean",
    operators: ["is"],
    group: "Status",
  },

  // ── Date / Time ──
  after: {
    label: "After",
    valueType: "date",
    operators: ["is"],
    placeholder: "YYYY/MM/DD",
    group: "Date",
  },
  before: {
    label: "Before",
    valueType: "date",
    operators: ["is"],
    placeholder: "YYYY/MM/DD",
    group: "Date",
  },
  older_than: {
    label: "Older than",
    valueType: "text",
    operators: ["is"],
    placeholder: "e.g. 7d, 2m, 1y",
    group: "Date",
  },
  newer_than: {
    label: "Newer than",
    valueType: "text",
    operators: ["is"],
    placeholder: "e.g. 3d, 1m, 6m",
    group: "Date",
  },

  // ── Size ──
  larger: {
    label: "Larger than",
    valueType: "text",
    operators: ["is"],
    placeholder: "e.g. 5M, 500K",
    group: "Size",
  },
  smaller: {
    label: "Smaller than",
    valueType: "text",
    operators: ["is"],
    placeholder: "e.g. 1M, 100K",
    group: "Size",
  },
};

export function getFieldConfig(
  source: "github_pr" | "github_issue" | "gmail",
  field: string,
): FieldConfig | undefined {
  const config =
    source === "github_pr"
      ? githubPrFieldConfig
      : source === "github_issue"
        ? githubIssueFieldConfig
        : gmailFieldConfig;
  return config[field];
}
