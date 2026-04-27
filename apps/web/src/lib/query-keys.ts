import type { FilterCondition, FilterRule } from "@g-spot/types/filters";

import { trpc } from "@/utils/trpc";

export const sectionsKeys = {
  list: () => trpc.sections.list.queryOptions().queryKey,
};

export const piKeys = {
  catalog: () => ["pi", "catalog"] as const,
  defaults: () => ["pi", "defaults"] as const,
  credentials: () => ["pi", "credentials"] as const,
  addons: (projectId: string | null) =>
    ["pi", "addons", projectId ?? "global"] as const,
  oauthSession: (sessionId: string | null) =>
    ["pi", "oauth-session", sessionId ?? null] as const,
  addonCatalogPopular: (limit: number) =>
    ["pi", "addon-catalog", "popular", limit] as const,
  addonCatalogSearch: (query: string, limit: number) =>
    ["pi", "addon-catalog", "search", query, limit] as const,
};

export const chatKeys = {
  list: (input?: { projectId?: string | null; limit?: number }) =>
    input ? (["chat", "list", input] as const) : (["chat", "list"] as const),
  detail: (chatId: string) => ["chat", "detail", chatId] as const,
  messages: (chatId: string) => ["chat", "messages", chatId] as const,
};

export const projectKeys = {
  list: () => ["projects", "list"] as const,
  detail: (projectId: string) => ["projects", "detail", projectId] as const,
  chatCount: (projectId: string) =>
    ["projects", "chat-count", projectId] as const,
};

export const noteKeys = {
  all: () => ["notes"] as const,
  list: () => ["notes", "list"] as const,
  detail: (noteId: string) => ["notes", "detail", noteId] as const,
  search: (query: string) => ["notes", "search", query] as const,
  backlinks: (noteId: string) => ["notes", "backlinks", noteId] as const,
  outgoingLinks: (noteId: string) => ["notes", "outgoing", noteId] as const,
  tags: () => ["notes", "tags"] as const,
};

export const mcpKeys = {
  list: () => ["mcp", "list"] as const,
  config: (scope: "global" | string) => ["mcp", "config", scope] as const,
};

export const skillsKeys = {
  global: () => ["skills", "list", "global"] as const,
  project: (projectId: string) => ["skills", "list", "project", projectId] as const,
  detail: (skillId: string) => ["skills", "detail", skillId] as const,
  catalogPopular: (limit: number) =>
    ["skills", "catalog", "popular", limit] as const,
  catalogSearch: (query: string, limit: number) =>
    ["skills", "catalog", "search", query, limit] as const,
};

export const googleKeys = {
  profile: (accountId: string | null | undefined) =>
    ["google", "profile", accountId ?? null] as const,
};

export const githubKeys = {
  /** Prefix key for invalidating all PR data for a section */
  prsSection: (sectionId: string) => ["github", "prs", sectionId] as const,
  /** Prefix key for invalidating all issue data for a section */
  issuesSection: (sectionId: string) => ["github", "issues", sectionId] as const,
  items: (
    source: "github_pr" | "github_issue",
    sectionId: string,
    input: {
      accountId: string | null;
      filters: FilterRule;
      repos: string[];
      sortAsc: boolean;
    },
  ) => ["github", source === "github_pr" ? "prs" : "issues", sectionId, input] as const,
  repoSearch: (accountId: string | null | undefined, query: string) =>
    ["github", "repo-search", accountId ?? null, query] as const,
  labels: (accountId: string | null | undefined, repos: string[]) =>
    ["github", "labels", accountId ?? null, repos] as const,
  users: (accountId: string | null | undefined, query: string) =>
    ["github", "users", accountId ?? null, query] as const,
  filterSuggestions: (
    accountId: string | null | undefined,
    source: "github_pr" | "github_issue",
    field: string,
    filters: FilterCondition[],
    repos: string[],
    searchQuery = "",
  ) =>
    [
      "github",
      "filter-suggestions",
      accountId ?? null,
      source,
      field,
      { filters, repos, searchQuery },
    ] as const,
  profile: (accountId: string | null | undefined) =>
    ["github", "profile", accountId ?? null] as const,
};

export const gmailKeys = {
  root: () => ["gmail"] as const,
  threadsRoot: () => ["gmail", "threads"] as const,
  threadsSection: (sectionId: string) => ["gmail", "threads", sectionId] as const,
  threads: (
    sectionId: string,
    input: {
      accountId: string | null;
      filters: FilterRule;
    },
  ) => ["gmail", "threads", sectionId, input] as const,
  threadCount: (
    sectionId: string,
    input: {
      accountId: string | null;
      filters: FilterRule;
    },
  ) => ["gmail", "threads", sectionId, "count", input] as const,
  thread: (threadId: string | null, accountId: string | null | undefined) =>
    ["gmail", "thread", threadId, accountId ?? null] as const,
  labels: (accountId: string | null | undefined) =>
    ["gmail", "labels", accountId ?? null] as const,
  labelsCatalog: (accountId: string | null | undefined) =>
    ["gmail", "labels-catalog", accountId ?? null] as const,
  filterSuggestions: (
    accountId: string | null | undefined,
    field: string,
    filters: FilterCondition[],
  ) =>
    [
      "gmail",
      "filter-suggestions",
      accountId ?? null,
      field,
      { filters },
    ] as const,
  threadDrafts: (threadId: string, accountId: string | null | undefined) =>
    ["gmail", "threadDrafts", threadId, accountId ?? null] as const,
  draftId: (threadId: string, accountId: string | null | undefined) =>
    ["gmail", "draftId", threadId, accountId ?? null] as const,
  draftCompose: (draftId: string | null, accountId: string | null | undefined) =>
    ["gmail", "draftCompose", draftId ?? null, accountId ?? null] as const,
  contacts: (accountId: string | null | undefined) =>
    ["gmail", "contacts", accountId ?? null] as const,
  agentToolkit: () => ["gmail", "agent-toolkit"] as const,
  agentWorkflows: (accountId: string | null | undefined) =>
    ["gmail", "agent-workflows", accountId ?? null] as const,
};
