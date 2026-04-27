import { z } from "zod";

import { piAgentConfigSchema } from "./agent";

const DEFAULT_GMAIL_WORKFLOW_AGENT_CONFIG = piAgentConfigSchema.parse({});

export const GMAIL_AGENT_WORKFLOW_TRIGGER_VALUES = [
  "incremental_sync",
] as const;

export const GMAIL_AGENT_TOOL_NAME_VALUES = [
  "gmail_search_threads",
  "gmail_get_thread",
  "gmail_list_labels",
  "gmail_modify_thread_labels",
  "gmail_create_draft",
  "gmail_update_draft",
  "gmail_delete_draft",
  "gmail_trash_thread",
  "gmail_send_email",
] as const;

export const gmailAgentWorkflowTriggerSchema = z.enum(
  GMAIL_AGENT_WORKFLOW_TRIGGER_VALUES,
);
export const gmailAgentToolNameSchema = z.enum(GMAIL_AGENT_TOOL_NAME_VALUES);

export const gmailAgentWorkflowConfigSchema = z.object({
  name: z.string().min(1).default("Incremental sync workflow"),
  enabled: z.boolean().default(false),
  trigger: gmailAgentWorkflowTriggerSchema.default("incremental_sync"),
  prompt: z.string().default(""),
  agentConfig: piAgentConfigSchema.default(DEFAULT_GMAIL_WORKFLOW_AGENT_CONFIG),
  disabledToolNames: z.array(gmailAgentToolNameSchema).default([]),
});

export const gmailAgentWorkflowUpsertSchema = gmailAgentWorkflowConfigSchema
  .extend({
    id: z.string().optional(),
  })
  .omit({ trigger: true });

export type GmailAgentWorkflowTrigger = z.infer<
  typeof gmailAgentWorkflowTriggerSchema
>;
export type GmailAgentToolName = z.infer<typeof gmailAgentToolNameSchema>;
export type GmailAgentWorkflowConfig = z.infer<
  typeof gmailAgentWorkflowConfigSchema
>;
export type GmailAgentWorkflowUpsert = z.infer<
  typeof gmailAgentWorkflowUpsertSchema
>;
