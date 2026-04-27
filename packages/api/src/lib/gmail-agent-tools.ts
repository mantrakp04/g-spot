import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  getLabels,
  getThread,
  getThreadMessages,
  searchThreads,
  syncAccountDraftIds,
} from "@g-spot/db/gmail";
import type { GmailAgentToolName } from "@g-spot/types";

import {
  createGmailDraft,
  deleteGmailDraft,
  modifyGmailThreadLabels,
  sendGmailDraft,
  sendGmailMessage,
  trashGmailThread,
  updateGmailDraft,
} from "./gmail-browse";
import { listAllDraftMappings } from "./gmail-client";

type GmailToolContext = {
  accountId: string;
  accountEmail: string;
  token: string;
  changedGmailThreadIds: string[];
};

type Rfc2822Params = {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  bodyHtml: string;
  inReplyTo?: string;
  references?: string;
};

export const GMAIL_AGENT_TOOL_NAMES = [
  "gmail_search_threads",
  "gmail_get_thread",
  "gmail_list_labels",
  "gmail_modify_thread_labels",
  "gmail_create_draft",
  "gmail_update_draft",
  "gmail_delete_draft",
  "gmail_trash_thread",
  "gmail_send_email",
] as const satisfies readonly GmailAgentToolName[];

function jsonText(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    details: undefined,
  };
}

function encodeRfc2822ToBase64Url(raw: string): string {
  return Buffer.from(raw, "utf8").toString("base64url");
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildRfc2822Message(params: Rfc2822Params): string {
  const lines: string[] = [
    `From: ${params.from}`,
    `To: ${params.to}`,
  ];
  if (params.cc) lines.push(`Cc: ${params.cc}`);
  if (params.bcc) lines.push(`Bcc: ${params.bcc}`);
  lines.push(`Subject: ${params.subject}`);
  if (params.inReplyTo) lines.push(`In-Reply-To: ${params.inReplyTo}`);
  if (params.references) lines.push(`References: ${params.references}`);
  lines.push("MIME-Version: 1.0");
  lines.push("Content-Type: text/html; charset=utf-8");
  lines.push("");
  lines.push(params.bodyHtml);
  return lines.join("\r\n");
}

function buildRawMessage(
  context: GmailToolContext,
  params: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    bodyFormat?: "plain" | "html";
    inReplyTo?: string;
    references?: string;
  },
) {
  const bodyHtml = params.bodyFormat === "html"
    ? params.body
    : `<html><body><pre>${htmlEscape(params.body)}</pre></body></html>`;

  return encodeRfc2822ToBase64Url(
    buildRfc2822Message({
      from: context.accountEmail,
      to: params.to,
      cc: params.cc,
      bcc: params.bcc,
      subject: params.subject,
      bodyHtml,
      inReplyTo: params.inReplyTo,
      references: params.references,
    }),
  );
}

async function refreshDraftMappings(context: GmailToolContext): Promise<void> {
  const mappings = await listAllDraftMappings(context.token);
  await syncAccountDraftIds(context.accountId, mappings);
}

export function createGmailAgentTools(
  context: GmailToolContext,
  disabledToolNames: ReadonlySet<GmailAgentToolName> = new Set(),
): ToolDefinition[] {
  const tools = [
    defineTool({
      name: "gmail_search_threads",
      label: "Gmail Search Threads",
      description:
        "Search synced local Gmail threads by sender, subject, or body text. Use this before mutating mail when you need more context.",
      promptSnippet:
        "gmail_search_threads: search synced local Gmail threads by text.",
      parameters: Type.Object({
        query: Type.String({ description: "Text to search for." }),
        limit: Type.Optional(Type.Number({ description: "Max threads, default 10." })),
      }),
      async execute(_toolCallId, params) {
        const threads = await searchThreads(
          context.accountId,
          params.query,
          params.limit ?? 10,
        );
        return jsonText({ threads });
      },
    }),

    defineTool({
      name: "gmail_get_thread",
      label: "Gmail Get Thread",
      description:
        "Read one synced Gmail thread, including stored message bodies. Does not fetch from Gmail unless the thread was already synced.",
      promptSnippet: "gmail_get_thread: read a synced Gmail thread by thread id.",
      parameters: Type.Object({
        gmailThreadId: Type.String({ description: "Gmail thread id." }),
      }),
      async execute(_toolCallId, params) {
        const thread = await getThread(context.accountId, params.gmailThreadId);
        if (!thread) return jsonText({ thread: null, messages: [] });
        const messages = await getThreadMessages(thread.id);
        return jsonText({ thread, messages });
      },
    }),

    defineTool({
      name: "gmail_list_labels",
      label: "Gmail List Labels",
      description:
        "List synced Gmail label ids and names. Use ids with gmail_modify_thread_labels.",
      promptSnippet: "gmail_list_labels: list Gmail labels.",
      parameters: Type.Object({}),
      async execute() {
        return jsonText({ labels: await getLabels(context.accountId) });
      },
    }),

    defineTool({
      name: "gmail_modify_thread_labels",
      label: "Gmail Modify Thread Labels",
      description:
        "Add or remove Gmail label ids on a thread. Use label ids, not display names.",
      promptSnippet:
        "gmail_modify_thread_labels: add/remove labels on a Gmail thread.",
      parameters: Type.Object({
        gmailThreadId: Type.String({ description: "Gmail thread id." }),
        addLabelIds: Type.Optional(Type.Array(Type.String())),
        removeLabelIds: Type.Optional(Type.Array(Type.String())),
      }),
      async execute(_toolCallId, params) {
        await modifyGmailThreadLabels(
          context.token,
          params.gmailThreadId,
          params.addLabelIds,
          params.removeLabelIds,
        );
        return jsonText({ ok: true });
      },
    }),

    defineTool({
      name: "gmail_create_draft",
      label: "Gmail Create Draft",
      description:
        "Create a Gmail draft. For replies, pass threadId plus inReplyTo/references from gmail_get_thread.",
      promptSnippet: "gmail_create_draft: create a Gmail draft.",
      parameters: Type.Object({
        to: Type.String(),
        subject: Type.String(),
        body: Type.String(),
        cc: Type.Optional(Type.String()),
        bcc: Type.Optional(Type.String()),
        bodyFormat: Type.Optional(Type.Union([
          Type.Literal("plain"),
          Type.Literal("html"),
        ])),
        threadId: Type.Optional(Type.String()),
        inReplyTo: Type.Optional(Type.String()),
        references: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId, params) {
        const raw = buildRawMessage(context, params);
        const draft = await createGmailDraft(context.token, raw, params.threadId);
        await refreshDraftMappings(context);
        return jsonText({ draft });
      },
    }),

    defineTool({
      name: "gmail_update_draft",
      label: "Gmail Update Draft",
      description: "Replace an existing Gmail draft body/headers.",
      promptSnippet: "gmail_update_draft: update a Gmail draft.",
      parameters: Type.Object({
        draftId: Type.String(),
        to: Type.String(),
        subject: Type.String(),
        body: Type.String(),
        cc: Type.Optional(Type.String()),
        bcc: Type.Optional(Type.String()),
        bodyFormat: Type.Optional(Type.Union([
          Type.Literal("plain"),
          Type.Literal("html"),
        ])),
        threadId: Type.Optional(Type.String()),
        inReplyTo: Type.Optional(Type.String()),
        references: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId, params) {
        const raw = buildRawMessage(context, params);
        const draft = await updateGmailDraft(
          context.token,
          params.draftId,
          raw,
          params.threadId,
        );
        await refreshDraftMappings(context);
        return jsonText({ draft });
      },
    }),

    defineTool({
      name: "gmail_delete_draft",
      label: "Gmail Delete Draft",
      description: "Delete a Gmail draft by draft id.",
      promptSnippet: "gmail_delete_draft: delete a Gmail draft.",
      parameters: Type.Object({
        draftId: Type.String(),
      }),
      async execute(_toolCallId, params) {
        await deleteGmailDraft(context.token, params.draftId);
        await refreshDraftMappings(context);
        return jsonText({ ok: true });
      },
    }),

    defineTool({
      name: "gmail_trash_thread",
      label: "Gmail Trash Thread",
      description: "Move a Gmail thread to trash.",
      promptSnippet: "gmail_trash_thread: trash a Gmail thread.",
      parameters: Type.Object({
        gmailThreadId: Type.String(),
      }),
      async execute(_toolCallId, params) {
        await trashGmailThread(context.token, params.gmailThreadId);
        return jsonText({ ok: true });
      },
    }),

    defineTool({
      name: "gmail_send_email",
      label: "Gmail Send Email",
      description:
        "Send an email immediately. Prefer gmail_create_draft unless the workflow explicitly asks you to send.",
      promptSnippet: "gmail_send_email: send an email immediately.",
      parameters: Type.Object({
        draftId: Type.Optional(Type.String()),
        to: Type.Optional(Type.String()),
        subject: Type.Optional(Type.String()),
        body: Type.Optional(Type.String()),
        cc: Type.Optional(Type.String()),
        bcc: Type.Optional(Type.String()),
        bodyFormat: Type.Optional(Type.Union([
          Type.Literal("plain"),
          Type.Literal("html"),
        ])),
        inReplyTo: Type.Optional(Type.String()),
        references: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId, params) {
        if (!params.draftId && (!params.to || !params.subject || !params.body)) {
          throw new Error(
            "gmail_send_email requires either draftId or to, subject, and body.",
          );
        }
        const sent = params.draftId
          ? await sendGmailDraft(context.token, params.draftId)
          : await sendGmailMessage(
              context.token,
              buildRawMessage(context, {
                to: params.to ?? "",
                subject: params.subject ?? "",
                body: params.body ?? "",
                cc: params.cc,
                bcc: params.bcc,
                bodyFormat: params.bodyFormat,
                inReplyTo: params.inReplyTo,
                references: params.references,
              }),
            );
        await refreshDraftMappings(context);
        return jsonText({ sent });
      },
    }),
  ] satisfies ToolDefinition[];

  return tools.filter((tool) =>
    !disabledToolNames.has(tool.name as GmailAgentToolName)
  );
}
