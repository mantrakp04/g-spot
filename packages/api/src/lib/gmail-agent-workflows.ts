import {
  getGmailAccountById,
  listEnabledIncrementalGmailAgentWorkflows,
} from "@g-spot/db/gmail";
import type { GmailAgentWorkflowRow } from "@g-spot/db/schema/gmail";
import {
  gmailAgentToolNameSchema,
  type GmailAgentToolName,
} from "@g-spot/types";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { Message } from "@mariozechner/pi-ai";

import {
  createPiAgentSession,
  extractAssistantText,
  getPiAgentDefaults,
} from "./pi";
import { createGmailAgentTools, GMAIL_AGENT_TOOL_NAMES } from "./gmail-agent-tools";

type IncrementalWorkflowTrigger = {
  accountId: string;
  token: string;
  changedGmailThreadIds: string[];
  extractableGmailThreadIds: string[];
};

const activeWorkflowRuns = new Set<string>();

function parseDisabledToolNames(value: string): GmailAgentToolName[] {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(value);
  } catch {
    return [];
  }

  if (!Array.isArray(parsedJson)) return [];
  return parsedJson.filter((toolName): toolName is GmailAgentToolName =>
    gmailAgentToolNameSchema.safeParse(toolName).success
  );
}

function isPersistablePiMessage(message: unknown): message is Message {
  if (!message || typeof message !== "object") return false;
  const role = (message as { role?: unknown }).role;
  return role === "assistant" || role === "toolResult";
}

function buildWorkflowPrompt(
  workflow: GmailAgentWorkflowRow,
  trigger: IncrementalWorkflowTrigger,
): string {
  return [
    "A Gmail incremental sync just completed.",
    "",
    "Workflow instructions:",
    workflow.prompt.trim(),
    "",
    "Sync scope:",
    JSON.stringify(
      {
        accountId: trigger.accountId,
        changedGmailThreadIds: trigger.changedGmailThreadIds,
        extractableGmailThreadIds: trigger.extractableGmailThreadIds,
      },
      null,
      2,
    ),
    "",
    "Only inspect or mutate Gmail threads in this sync scope unless the workflow instructions explicitly require a broader search.",
    "Prefer drafts over sending email immediately unless the workflow explicitly says to send.",
  ].join("\n");
}

async function runWorkflow(
  workflow: GmailAgentWorkflowRow,
  trigger: IncrementalWorkflowTrigger & { accountEmail: string },
): Promise<void> {
  if (!workflow.prompt.trim()) return;

  const runKey = `${workflow.accountId}:${workflow.id}`;
  if (activeWorkflowRuns.has(runKey)) return;

  activeWorkflowRuns.add(runKey);
  try {
    const disabledToolNames = new Set(parseDisabledToolNames(workflow.disabledToolNames));
    const tools = createGmailAgentTools(
      {
        accountId: workflow.accountId,
        accountEmail: trigger.accountEmail,
        token: trigger.token,
        changedGmailThreadIds: trigger.changedGmailThreadIds,
      },
      disabledToolNames,
    );

    const defaults = await getPiAgentDefaults();
    const { session } = await createPiAgentSession({
      config: defaults.worker,
      activeToolNames: [],
      disableProjectResources: true,
      customTools: tools,
      project: {
        id: `gmail-workflow:${workflow.id}`,
        path: process.cwd(),
        customInstructions: [
          "You are running as a background Gmail workflow agent.",
          "There is no interactive user approval during this run.",
          `Available Gmail tools: ${tools.map((tool) => tool.name).join(", ") || "(none)"}.`,
          `Disabled Gmail tools: ${[...disabledToolNames].join(", ") || "(none)"}.`,
          `All possible Gmail tools: ${GMAIL_AGENT_TOOL_NAMES.join(", ")}.`,
        ].join("\n"),
        appendPrompt: null,
      },
    });

    const assistantMessages: string[] = [];
    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      if (event.type !== "message_end" || !isPersistablePiMessage(event.message)) {
        return;
      }
      const text = extractAssistantText(event.message);
      if (text) assistantMessages.push(text);
    });

    try {
      await session.sendUserMessage(buildWorkflowPrompt(workflow, trigger));
      if (assistantMessages.length > 0) {
        console.log("[gmail-agent-workflow] completed", {
          workflowId: workflow.id,
          workflowName: workflow.name,
          summary: assistantMessages.at(-1),
        });
      }
    } finally {
      unsubscribe();
      await session.abort().catch(() => {});
    }
  } catch (error) {
    console.error("[gmail-agent-workflow] failed", {
      workflowId: workflow.id,
      workflowName: workflow.name,
      error,
    });
  } finally {
    activeWorkflowRuns.delete(runKey);
  }
}

export function triggerIncrementalGmailAgentWorkflows(
  trigger: IncrementalWorkflowTrigger,
): void {
  if (trigger.changedGmailThreadIds.length === 0) return;

  void (async () => {
    const account = await getGmailAccountById(trigger.accountId);
    if (!account) return;

    const workflows = await listEnabledIncrementalGmailAgentWorkflows(
      trigger.accountId,
    );
    if (workflows.length === 0) return;

    await Promise.all(
      workflows.map((workflow) =>
        runWorkflow(workflow, {
          ...trigger,
          accountEmail: account.email,
        })
      ),
    );
  })().catch((error) => {
    console.error("[gmail-agent-workflow] trigger failed:", error);
  });
}
