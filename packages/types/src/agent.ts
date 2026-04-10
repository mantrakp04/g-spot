import type { AgentSessionEvent, ToolInfo } from "@mariozechner/pi-coding-agent";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Message, Model, Transport } from "@mariozechner/pi-ai";
import { z } from "zod";

export const PI_QUEUE_MODE_VALUES = ["one-at-a-time", "all"] as const;
export const PI_BUILTIN_TOOL_NAME_VALUES = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
] as const;

export const DEFAULT_PI_ACTIVE_TOOL_NAMES = [
  "read",
  "bash",
  "edit",
  "write",
] as const;

/**
 * Permission-related fields.
 *
 * Pi itself exposes no sandbox / network / approval switches, so these are
 * enforced by `chat-stream.ts` via the `agent.beforeToolCall` hook. They stay
 * on `PiAgentConfig` so they can be persisted per-chat, per-project, and as
 * the user's default for new projects.
 */
export const PI_SANDBOX_MODE_VALUES = [
  "read-only",
  "workspace-write",
  "full-access",
] as const;
export const PI_NETWORK_ACCESS_VALUES = ["off", "on"] as const;
export const PI_APPROVAL_POLICY_VALUES = [
  "auto",
  "approval-required",
] as const;

export const piQueueModeSchema = z.enum(PI_QUEUE_MODE_VALUES);
export const piBuiltinToolNameSchema = z.enum(PI_BUILTIN_TOOL_NAME_VALUES);
export const piSandboxModeSchema = z.enum(PI_SANDBOX_MODE_VALUES);
export const piNetworkAccessSchema = z.enum(PI_NETWORK_ACCESS_VALUES);
export const piApprovalPolicySchema = z.enum(PI_APPROVAL_POLICY_VALUES);

export const piAgentConfigSchema = z.object({
  provider: z.string().min(1).default("openai-codex"),
  modelId: z.string().min(1).default("gpt-5.4-mini"),
  thinkingLevel: z
    .enum(["off", "minimal", "low", "medium", "high", "xhigh"] satisfies readonly [
      "off",
      ...ThinkingLevel[],
    ])
    .default("off"),
  transport: z.enum(["sse", "websocket", "auto"] satisfies readonly Transport[]).default("sse"),
  steeringMode: piQueueModeSchema.default("one-at-a-time"),
  followUpMode: piQueueModeSchema.default("one-at-a-time"),
  activeToolNames: z
    .array(piBuiltinToolNameSchema)
    .default([...DEFAULT_PI_ACTIVE_TOOL_NAMES]),
  sandboxMode: piSandboxModeSchema.default("workspace-write"),
  networkAccess: piNetworkAccessSchema.default("off"),
  approvalPolicy: piApprovalPolicySchema.default("approval-required"),
});

export const piProviderApiKeySchema = z.object({
  provider: z.string().min(1),
  apiKey: z.string().min(1),
});

export type PiAgentConfig = z.infer<typeof piAgentConfigSchema>;
export type PiQueueMode = z.infer<typeof piQueueModeSchema>;
export type PiBuiltinToolName = z.infer<typeof piBuiltinToolNameSchema>;
export type PiSandboxMode = z.infer<typeof piSandboxModeSchema>;
export type PiNetworkAccess = z.infer<typeof piNetworkAccessSchema>;
export type PiApprovalPolicy = z.infer<typeof piApprovalPolicySchema>;
export type PiProviderApiKeyInput = z.infer<typeof piProviderApiKeySchema>;

export type PiSdkTransport = Transport;
export type PiSdkThinkingLevel = ThinkingLevel;
export type PiSdkModel = Model<any>;
export type PiSdkMessage = Message;
export type PiSdkSessionEvent = AgentSessionEvent;
export type PiSdkToolInfo = ToolInfo;

export type PiCredentialSummary = {
  provider: string;
  type: "api_key" | "oauth";
};

export type PiOAuthProviderSummary = {
  id: string;
  name: string;
  usesCallbackServer: boolean;
};

export type PiChatHistoryMessage = PiSdkMessage & {
  id: string;
  createdAt: string;
};

export type PiAgentDefaults = {
  chat: PiAgentConfig;
  worker: PiAgentConfig;
};

export type PiCatalog = {
  oauthProviders: PiOAuthProviderSummary[];
  tools: PiSdkToolInfo[];
  models: PiSdkModel[];
  availableModels: PiSdkModel[];
  defaults: PiAgentDefaults;
  configuredProviders: PiCredentialSummary[];
};
