import type { FilterRule, SectionSource } from "@g-spot/types/filters";

export type SectionTemplate = {
  id: string;
  name: string;
  description: string;
  source: SectionSource;
  filters: FilterRule;
};

function condition(field: string, value: string): FilterRule {
  return {
    type: "group",
    operator: "and",
    children: [
      {
        type: "condition",
        field,
        operator: "is",
        value,
        logic: "and",
      },
    ],
  };
}

function group(...children: FilterRule[]): FilterRule {
  return {
    type: "group",
    operator: "and",
    children,
  };
}

export const GMAIL_TEMPLATES: SectionTemplate[] = [
  {
    id: "gmail-unread",
    name: "Unread",
    description: "All unread mail in your inbox",
    source: "gmail",
    filters: group(
      { type: "condition", field: "in", operator: "is", value: "inbox", logic: "and" },
      { type: "condition", field: "is_unread", operator: "is", value: "true", logic: "and" },
    ),
  },
  {
    id: "gmail-read",
    name: "Read",
    description: "Already-read inbox mail",
    source: "gmail",
    filters: group(
      { type: "condition", field: "in", operator: "is", value: "inbox", logic: "and" },
      { type: "condition", field: "is_read", operator: "is", value: "true", logic: "and" },
    ),
  },
  {
    id: "gmail-starred",
    name: "Starred",
    description: "Threads you've starred",
    source: "gmail",
    filters: condition("is_starred", "true"),
  },
  {
    id: "gmail-important",
    name: "Important",
    description: "Threads Gmail flagged as important",
    source: "gmail",
    filters: condition("is_important", "true"),
  },
  {
    id: "gmail-attachments",
    name: "With attachments",
    description: "Inbox mail that has attachments",
    source: "gmail",
    filters: group(
      { type: "condition", field: "in", operator: "is", value: "inbox", logic: "and" },
      { type: "condition", field: "has_attachment", operator: "is", value: "true", logic: "and" },
    ),
  },
];

export const GITHUB_PR_TEMPLATES: SectionTemplate[] = [
  {
    id: "pr-mine-open-not-approved",
    name: "My open PRs (not approved)",
    description: "Your open PRs still waiting on review",
    source: "github_pr",
    filters: group(
      { type: "condition", field: "author", operator: "is", value: "@me", logic: "and" },
      { type: "condition", field: "status", operator: "is", value: "open", logic: "and" },
      { type: "condition", field: "draft", operator: "is", value: "false", logic: "and" },
      { type: "condition", field: "review_status", operator: "is_not", value: "approved", logic: "and" },
    ),
  },
  {
    id: "pr-mine-open-approved",
    name: "My open PRs (approved)",
    description: "Approved and ready to merge",
    source: "github_pr",
    filters: group(
      { type: "condition", field: "author", operator: "is", value: "@me", logic: "and" },
      { type: "condition", field: "status", operator: "is", value: "open", logic: "and" },
      { type: "condition", field: "review_status", operator: "is", value: "approved", logic: "and" },
    ),
  },
  {
    id: "pr-mine-drafts",
    name: "My draft PRs",
    description: "Your work-in-progress drafts",
    source: "github_pr",
    filters: group(
      { type: "condition", field: "author", operator: "is", value: "@me", logic: "and" },
      { type: "condition", field: "status", operator: "is", value: "open", logic: "and" },
      { type: "condition", field: "draft", operator: "is", value: "true", logic: "and" },
    ),
  },
  {
    id: "pr-review-requested",
    name: "Review requested",
    description: "PRs requesting your review",
    source: "github_pr",
    filters: group(
      { type: "condition", field: "reviewer", operator: "is", value: "@me", logic: "and" },
      { type: "condition", field: "status", operator: "is", value: "open", logic: "and" },
    ),
  },
  {
    id: "pr-mentions-me",
    name: "PRs mentioning me",
    description: "Open PRs where you're mentioned",
    source: "github_pr",
    filters: group(
      { type: "condition", field: "mentions", operator: "is", value: "@me", logic: "and" },
      { type: "condition", field: "status", operator: "is", value: "open", logic: "and" },
    ),
  },
];

export const GITHUB_ISSUE_TEMPLATES: SectionTemplate[] = [
  {
    id: "issue-mine-open",
    name: "My open issues",
    description: "Open issues you've authored",
    source: "github_issue",
    filters: group(
      { type: "condition", field: "author", operator: "is", value: "@me", logic: "and" },
      { type: "condition", field: "status", operator: "is", value: "open", logic: "and" },
    ),
  },
  {
    id: "issue-assigned-to-me",
    name: "Assigned to me",
    description: "Open issues assigned to you",
    source: "github_issue",
    filters: group(
      { type: "condition", field: "assignee", operator: "is", value: "@me", logic: "and" },
      { type: "condition", field: "status", operator: "is", value: "open", logic: "and" },
    ),
  },
];
