import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const defaultDemoDatabasePath = resolve(repoRoot, "apps/server/demo.db");
const demoProjectPath = process.env.DEMO_PROJECT_PATH ?? repoRoot;

process.env.DEMO_MODE = process.env.DEMO_MODE ?? "true";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? `file:${defaultDemoDatabasePath}`;

mkdirSync(dirname(defaultDemoDatabasePath), { recursive: true });

const { client, db } = await import("./index");
const schema = await import("./schema");

const now = new Date().toISOString();
const timestamp = Date.now();
const accountId = "demo-gmail-account";
const providerAccountId = "demo-google-account";
const projectId = "demo-project-g-spot";
const chatId = "demo-chat-readonly";
const noteFolderId = "demo-folder-product";
const todayNoteId = "demo-note-today";
const reviewNoteId = "demo-note-review-loop";
const memoryNoteId = "demo-note-memory";

await db.transaction(async (tx) => {
  await tx.delete(schema.gmailAttachments);
  await tx.delete(schema.gmailMessageLabels);
  await tx.delete(schema.gmailMessages);
  await tx.delete(schema.gmailThreadLabels);
  await tx.delete(schema.gmailThreads);
  await tx.delete(schema.gmailLabels);
  await tx.delete(schema.gmailAgentWorkflows);
  await tx.delete(schema.gmailAccounts);
  await tx.delete(schema.chatMessages);
  await tx.delete(schema.chats);
  await tx.delete(schema.projects);
  await tx.delete(schema.noteLinks);
  await tx.delete(schema.notes);
  await tx.delete(schema.sections);
  await tx.delete(schema.memoryAuditLog);
  await tx.delete(schema.memoryBlockHistory);
  await tx.delete(schema.memoryBlocks);
  await tx.delete(schema.memoryEdges);
  await tx.delete(schema.memoryObservations);
  await tx.delete(schema.memoryEntities);

  await tx.insert(schema.projects).values({
    id: projectId,
    name: "g-spot demo workspace",
    path: demoProjectPath,
    customInstructions:
      "Read-only demo workspace. Show how mail, code review, notes, and memory fit together without running tools.",
    appendPrompt:
      "Explain the visible product surface. Do not execute commands in demo mode.",
    agentConfig: JSON.stringify({
      modelId: "gpt-5.4-mini",
      thinkingLevel: "low",
      network: false,
      tools: ["read", "search"],
    }),
    createdAt: now,
    updatedAt: now,
  });

  await tx.insert(schema.chats).values({
    id: chatId,
    projectId,
    title: "Triage today's inbox and PR queue",
    agentConfig: JSON.stringify({
      modelId: "gpt-5.4-mini",
      thinkingLevel: "low",
      network: false,
    }),
    agentContext: null,
    createdAt: now,
    updatedAt: now,
  });

  await tx.insert(schema.chatMessages).values([
    {
      id: "demo-msg-user-1",
      chatId,
      message: JSON.stringify({
        role: "user",
        content:
          "What needs my attention before I ship the inbox and review flow?",
        timestamp,
      }),
      createdAt: now,
    },
    {
      id: "demo-msg-assistant-1",
      chatId,
      message: JSON.stringify({
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Top items: reply to the OAuth scope question, review the comment threading PR, and keep the memory decay rollout behind a manual approval gate.",
          },
        ],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "demo-model",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0,
        },
        stopReason: "stop",
        timestamp,
      }),
      createdAt: now,
    },
  ]);

  await tx.insert(schema.notes).values([
    {
      id: noteFolderId,
      parentId: null,
      kind: "folder",
      title: "Product",
      content: "",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: todayNoteId,
      parentId: noteFolderId,
      kind: "note",
      title: "Today",
      content:
        "# Today\n\n- Ship [[Review Loop]] polish\n- Verify Gmail sections\n- Keep demo mode read-only\n\n#launch #inbox",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: reviewNoteId,
      parentId: noteFolderId,
      kind: "note",
      title: "Review Loop",
      content:
        "PR review should keep CI, files, comments, and the action bar visible without forcing context switches back to GitHub.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: memoryNoteId,
      parentId: null,
      kind: "note",
      title: "Memory Model",
      content:
        "Memory blocks are local, auditable, and decay over time. The agent should cite recalled context before using it.",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await tx.insert(schema.noteLinks).values({
    id: "demo-link-today-review",
    sourceId: todayNoteId,
    targetId: reviewNoteId,
    targetTitle: "Review Loop",
  });

  await tx.insert(schema.gmailAccounts).values({
    id: accountId,
    email: "demo@g-spot.dev",
    providerAccountId,
    historyId: "1024",
    needsFullResync: false,
    lastFullSyncAt: now,
    lastIncrementalSyncAt: now,
    createdAt: now,
    updatedAt: now,
  });

  await tx.insert(schema.gmailLabels).values([
    {
      id: "demo-label-inbox",
      accountId,
      gmailId: "INBOX",
      name: "Inbox",
      type: "system",
      color: null,
      createdAt: now,
    },
    {
      id: "demo-label-review",
      accountId,
      gmailId: "Label_Review",
      name: "Needs review",
      type: "user",
      color: JSON.stringify({
        backgroundColor: "#e0f2fe",
        textColor: "#075985",
      }),
      createdAt: now,
    },
    {
      id: "demo-label-launch",
      accountId,
      gmailId: "Label_Launch",
      name: "Launch",
      type: "user",
      color: JSON.stringify({
        backgroundColor: "#dcfce7",
        textColor: "#166534",
      }),
      createdAt: now,
    },
  ]);

  await tx.insert(schema.gmailThreads).values([
    {
      id: "demo-thread-oauth",
      accountId,
      gmailThreadId: "gmail-thread-oauth",
      subject: "OAuth scope copy for launch page",
      snippet:
        "Can we make the Gmail permissions copy clearer before the next demo?",
      lastMessageAt: now,
      messageCount: 2,
      historyId: "1025",
      isProcessed: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "demo-thread-review",
      accountId,
      gmailThreadId: "gmail-thread-review",
      subject: "Review queue plan for public OSS demo",
      snippet:
        "Can the demo show open PRs and issues without asking visitors to sign in?",
      lastMessageAt: new Date(timestamp - 35 * 60_000).toISOString(),
      messageCount: 2,
      historyId: "1027",
      isProcessed: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "demo-thread-notes",
      accountId,
      gmailThreadId: "gmail-thread-notes",
      subject: "Notes graph polish",
      snippet:
        "The wikilink backlinks look good. Could we make daily notes visible in the demo?",
      lastMessageAt: new Date(timestamp - 2 * 60 * 60_000).toISOString(),
      messageCount: 1,
      historyId: "1028",
      isProcessed: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "demo-thread-ci",
      accountId,
      gmailThreadId: "gmail-thread-ci",
      subject: "CI failure on comment threading PR",
      snippet:
        "The visual diff test is failing after the drawer resize change.",
      lastMessageAt: now,
      messageCount: 3,
      historyId: "1026",
      isProcessed: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await tx.insert(schema.gmailThreadLabels).values([
    { accountId, threadId: "demo-thread-oauth", label: "INBOX" },
    { accountId, threadId: "demo-thread-oauth", label: "Label_Launch" },
    { accountId, threadId: "demo-thread-review", label: "INBOX" },
    { accountId, threadId: "demo-thread-review", label: "Label_Review" },
    { accountId, threadId: "demo-thread-notes", label: "INBOX" },
    { accountId, threadId: "demo-thread-notes", label: "Label_Launch" },
    { accountId, threadId: "demo-thread-ci", label: "INBOX" },
    { accountId, threadId: "demo-thread-ci", label: "Label_Review" },
  ]);

  await tx.insert(schema.gmailMessages).values([
    {
      id: "demo-message-oauth",
      threadId: "demo-thread-oauth",
      accountId,
      gmailMessageId: "gmail-message-oauth",
      gmailThreadId: "gmail-thread-oauth",
      fromName: "Maya Chen",
      fromEmail: "maya@example.com",
      toHeader: "demo@g-spot.dev",
      ccHeader: "",
      subject: "OAuth scope copy for launch page",
      date: now,
      bodyHtml: null,
      bodyText:
        "Can we make the Gmail permissions copy clearer before the next demo?",
      snippet:
        "Can we make the Gmail permissions copy clearer before the next demo?",
      messageIdHeader: "<oauth-copy@example.com>",
      inReplyTo: null,
      referencesHeader: null,
      isDraft: false,
      gmailDraftId: null,
      historyId: "1025",
      rawSizeEstimate: 2048,
      createdAt: now,
    },
    {
      id: "demo-message-review",
      threadId: "demo-thread-review",
      accountId,
      gmailMessageId: "gmail-message-review",
      gmailThreadId: "gmail-thread-review",
      fromName: "Ari Patel",
      fromEmail: "ari@example.com",
      toHeader: "demo@g-spot.dev",
      ccHeader: "",
      subject: "Review queue plan for public OSS demo",
      date: new Date(timestamp - 35 * 60_000).toISOString(),
      bodyHtml: null,
      bodyText:
        "Can the demo show open PRs and issues without asking visitors to sign in?",
      snippet:
        "Can the demo show open PRs and issues without asking visitors to sign in?",
      messageIdHeader: "<review-demo@example.com>",
      inReplyTo: null,
      referencesHeader: null,
      isDraft: false,
      gmailDraftId: null,
      historyId: "1027",
      rawSizeEstimate: 3072,
      createdAt: now,
    },
    {
      id: "demo-message-notes",
      threadId: "demo-thread-notes",
      accountId,
      gmailMessageId: "gmail-message-notes",
      gmailThreadId: "gmail-thread-notes",
      fromName: "Sam Rivera",
      fromEmail: "sam@example.com",
      toHeader: "demo@g-spot.dev",
      ccHeader: "",
      subject: "Notes graph polish",
      date: new Date(timestamp - 2 * 60 * 60_000).toISOString(),
      bodyHtml: null,
      bodyText:
        "The wikilink backlinks look good. Could we make daily notes visible in the demo?",
      snippet:
        "The wikilink backlinks look good. Could we make daily notes visible in the demo?",
      messageIdHeader: "<notes-polish@example.com>",
      inReplyTo: null,
      referencesHeader: null,
      isDraft: false,
      gmailDraftId: null,
      historyId: "1028",
      rawSizeEstimate: 2560,
      createdAt: now,
    },
    {
      id: "demo-message-ci",
      threadId: "demo-thread-ci",
      accountId,
      gmailMessageId: "gmail-message-ci",
      gmailThreadId: "gmail-thread-ci",
      fromName: "GitHub",
      fromEmail: "notifications@github.com",
      toHeader: "demo@g-spot.dev",
      ccHeader: "",
      subject: "CI failure on comment threading PR",
      date: now,
      bodyHtml: null,
      bodyText:
        "The visual diff test is failing after the drawer resize change.",
      snippet:
        "The visual diff test is failing after the drawer resize change.",
      messageIdHeader: "<ci-threading@example.com>",
      inReplyTo: null,
      referencesHeader: null,
      isDraft: false,
      gmailDraftId: null,
      historyId: "1026",
      rawSizeEstimate: 4096,
      createdAt: now,
    },
  ]);

  await tx.insert(schema.gmailMessageLabels).values([
    { accountId, messageId: "demo-message-oauth", label: "INBOX" },
    { accountId, messageId: "demo-message-oauth", label: "Label_Launch" },
    { accountId, messageId: "demo-message-review", label: "INBOX" },
    { accountId, messageId: "demo-message-review", label: "Label_Review" },
    { accountId, messageId: "demo-message-notes", label: "INBOX" },
    { accountId, messageId: "demo-message-notes", label: "Label_Launch" },
    { accountId, messageId: "demo-message-ci", label: "INBOX" },
    { accountId, messageId: "demo-message-ci", label: "Label_Review" },
  ]);

  await tx.insert(schema.sections).values([
    {
      id: "demo-section-prs",
      name: "Open PRs on GitHub",
      source: "github_pr",
      filters: JSON.stringify({
        type: "group",
        operator: "and",
        children: [
          {
            type: "condition",
            field: "status",
            operator: "is",
            value: "open",
          },
        ],
      }),
      repos: JSON.stringify([]),
      columns: JSON.stringify([]),
      accountId: null,
      position: 0,
      showBadge: true,
      collapsed: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "demo-section-issues",
      name: "Open issues on GitHub",
      source: "github_issue",
      filters: JSON.stringify({
        type: "group",
        operator: "and",
        children: [
          {
            type: "condition",
            field: "status",
            operator: "is",
            value: "open",
          },
        ],
      }),
      repos: JSON.stringify([]),
      columns: JSON.stringify([]),
      accountId: null,
      position: 1,
      showBadge: true,
      collapsed: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "demo-section-gmail",
      name: "Launch mail",
      source: "gmail",
      filters: JSON.stringify({
        type: "condition",
        field: "label",
        operator: "is",
        value: "Label_Launch",
      }),
      repos: JSON.stringify([]),
      columns: JSON.stringify([]),
      accountId: providerAccountId,
      position: 2,
      showBadge: true,
      collapsed: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "demo-section-review-mail",
      name: "Review mail",
      source: "gmail",
      filters: JSON.stringify({
        type: "condition",
        field: "label",
        operator: "is",
        value: "Label_Review",
      }),
      repos: JSON.stringify([]),
      columns: JSON.stringify([]),
      accountId: providerAccountId,
      position: 3,
      showBadge: true,
      collapsed: false,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await tx.insert(schema.gmailAgentWorkflows).values([
    {
      id: "demo-workflow-launch-triage",
      accountId,
      name: "Launch mail triage",
      enabled: false,
      trigger: "incremental_sync",
      prompt:
        "When a launch email arrives, summarize the ask, label it Launch, and draft a reply for review. Never send automatically in demo mode.",
      disabledToolNames: JSON.stringify([
        "gmail_modify_thread_labels",
        "gmail_create_draft",
        "gmail_update_draft",
        "gmail_delete_draft",
        "gmail_trash_thread",
        "gmail_send_email",
      ]),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "demo-workflow-review-drafts",
      accountId,
      name: "Review request drafting",
      enabled: false,
      trigger: "incremental_sync",
      prompt:
        "For review-request emails, connect the request to open PRs, identify blockers, and prepare a short draft response.",
      disabledToolNames: JSON.stringify([
        "gmail_create_draft",
        "gmail_update_draft",
        "gmail_delete_draft",
        "gmail_send_email",
      ]),
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await tx.insert(schema.memoryEntities).values([
    {
      id: "demo-entity-gspot",
      sessionId: "demo",
      name: "g-spot",
      entityType: "project",
      description:
        "Local-first command center for mail, code review, notes, and agent memory.",
      aliases: JSON.stringify(["gspot", "g-spot app"]),
      hash: "demo-entity-gspot",
      validFrom: timestamp,
      validTo: null,
      version: 1,
      salience: 0.95,
      decayRate: 0.002,
      lastAccessedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "demo-entity-gmail",
      sessionId: "demo",
      name: "Gmail workflows",
      entityType: "tool",
      description:
        "Read-only background workflow surface for triaging Gmail and preparing drafts.",
      aliases: JSON.stringify(["mail workflows", "gmail agents"]),
      hash: "demo-entity-gmail",
      validFrom: timestamp,
      validTo: null,
      version: 1,
      salience: 0.82,
      decayRate: 0.003,
      lastAccessedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "demo-entity-review",
      sessionId: "demo",
      name: "GitHub review loop",
      entityType: "procedure",
      description:
        "Open source PR review flow that lets unsigned visitors inspect public PRs without mutating GitHub.",
      aliases: JSON.stringify(["PR review", "code review"]),
      hash: "demo-entity-review",
      validFrom: timestamp,
      validTo: null,
      version: 1,
      salience: 0.88,
      decayRate: 0.003,
      lastAccessedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]);

  await tx.insert(schema.memoryObservations).values([
    {
      id: "demo-observation-readonly",
      content:
        "The public demo is intentionally read-only and should never execute tools or mutate connected services.",
      observationType: "fact",
      confidence: 1,
      sourceMessageId: null,
      entityIds: JSON.stringify(["demo-entity-gspot"]),
      hash: "demo-observation-readonly",
      validFrom: timestamp,
      validTo: null,
      version: 1,
      salience: 1,
      decayRate: 0.001,
      lastAccessedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "demo-observation-oss-prs",
      content:
        "Public OSS GitHub PRs and issues should be browsable without signing in.",
      observationType: "preference",
      confidence: 0.96,
      sourceMessageId: null,
      entityIds: JSON.stringify(["demo-entity-review"]),
      hash: "demo-observation-oss-prs",
      validFrom: timestamp,
      validTo: null,
      version: 1,
      salience: 0.9,
      decayRate: 0.002,
      lastAccessedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "demo-observation-gmail-drafts",
      content:
        "Gmail demo workflows can show prompts and disabled tools, but all Gmail mutations remain disabled.",
      observationType: "procedure",
      confidence: 0.94,
      sourceMessageId: null,
      entityIds: JSON.stringify(["demo-entity-gmail"]),
      hash: "demo-observation-gmail-drafts",
      validFrom: timestamp,
      validTo: null,
      version: 1,
      salience: 0.86,
      decayRate: 0.002,
      lastAccessedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]);

  await tx.insert(schema.memoryEdges).values([
    {
      id: "demo-edge-gspot-review",
      sourceId: "demo-entity-gspot",
      targetId: "demo-entity-review",
      sourceType: "entity",
      targetType: "entity",
      relationshipType: "contains",
      description: "g-spot includes a GitHub review loop.",
      weight: 0.9,
      confidence: 0.95,
      tripletText: "g-spot contains GitHub review loop",
      validFrom: timestamp,
      validTo: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "demo-edge-gspot-gmail",
      sourceId: "demo-entity-gspot",
      targetId: "demo-entity-gmail",
      sourceType: "entity",
      targetType: "entity",
      relationshipType: "contains",
      description: "g-spot includes Gmail workflow triage.",
      weight: 0.85,
      confidence: 0.95,
      tripletText: "g-spot contains Gmail workflows",
      validFrom: timestamp,
      validTo: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]);

  await tx.insert(schema.memoryBlocks).values([
    {
      id: "demo-memory-block-profile",
      label: "user_profile",
      value:
        "Demo viewer is exploring a read-only local-first workspace with public GitHub review, Gmail triage, notes, and memory.",
      limit: 2000,
      readOnly: true,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "demo-memory-block-active",
      label: "active_context",
      value:
        "Current demo focus: show seeded emails, public OSS PRs, disabled Gmail workflows, and a populated memory graph.",
      limit: 2000,
      readOnly: true,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]);
});

client.exec("PRAGMA wal_checkpoint(TRUNCATE);");

console.log(
  `Seeded demo database at ${process.env.DATABASE_URL}. Set DEMO_MODE=true to serve it read-only.`,
);
