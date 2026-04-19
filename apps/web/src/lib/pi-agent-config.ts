import type {
  PiAgentConfig,
  PiApprovalPolicy,
  PiNetworkAccess,
  PiSandboxMode,
  PiSdkModel,
} from "@g-spot/types";

export type PiModelOption = Pick<PiSdkModel, "provider" | "id" | "name">;

/**
 * Permission-mode *presets* exposed to the chat input. Each preset is a
 * specific `(sandboxMode, networkAccess, approvalPolicy)` tuple — the chat's
 * underlying config still stores the three fields individually, but the
 * presets give users a one-click way to pick a sensible combination.
 *
 * "Custom" is synthesized client-side when the three stored fields don't
 * match any preset; the selector still shows them in settings individually.
 */
export type PermissionModePresetId =
  | "plan"
  | "default"
  | "accept-edits"
  | "bypass";

export const PERMISSION_MODE_PRESETS: Record<
  PermissionModePresetId,
  {
    id: PermissionModePresetId;
    label: string;
    description: string;
    sandboxMode: PiSandboxMode;
    networkAccess: PiNetworkAccess;
    approvalPolicy: PiApprovalPolicy;
  }
> = {
  plan: {
    id: "plan",
    label: "Plan",
    description: "Read-only. The agent can explore but never mutate anything.",
    sandboxMode: "read-only",
    networkAccess: "off",
    approvalPolicy: "auto",
  },
  default: {
    id: "default",
    label: "Default",
    description:
      "Workspace writes allowed, but every command or edit needs your OK first.",
    sandboxMode: "workspace-write",
    networkAccess: "off",
    approvalPolicy: "approval-required",
  },
  "accept-edits": {
    id: "accept-edits",
    label: "Auto",
    description:
      "Workspace writes allowed, no approval prompts. Network stays off.",
    sandboxMode: "workspace-write",
    networkAccess: "off",
    approvalPolicy: "auto",
  },
  bypass: {
    id: "bypass",
    label: "Bypass",
    description:
      "Full filesystem + network access. Nothing is gated. Use with care.",
    sandboxMode: "full-access",
    networkAccess: "on",
    approvalPolicy: "auto",
  },
};

export const PERMISSION_MODE_PRESET_ORDER: PermissionModePresetId[] = [
  "plan",
  "default",
  "accept-edits",
  "bypass",
];

export function getPermissionModePresetId(
  config: Pick<
    PiAgentConfig,
    "sandboxMode" | "networkAccess" | "approvalPolicy"
  >,
): PermissionModePresetId | null {
  for (const id of PERMISSION_MODE_PRESET_ORDER) {
    const preset = PERMISSION_MODE_PRESETS[id];
    if (
      preset.sandboxMode === config.sandboxMode &&
      preset.networkAccess === config.networkAccess &&
      preset.approvalPolicy === config.approvalPolicy
    ) {
      return id;
    }
  }
  return null;
}

export function applyPermissionModePreset(
  config: PiAgentConfig,
  presetId: PermissionModePresetId,
): PiAgentConfig {
  const preset = PERMISSION_MODE_PRESETS[presetId];
  return {
    ...config,
    sandboxMode: preset.sandboxMode,
    networkAccess: preset.networkAccess,
    approvalPolicy: preset.approvalPolicy,
  };
}

export const SANDBOX_MODE_OPTIONS = [
  { value: "read-only", label: "Read only" },
  { value: "workspace-write", label: "Workspace write" },
  { value: "full-access", label: "Full access" },
] as const satisfies ReadonlyArray<{
  value: PiSandboxMode;
  label: string;
}>;

export const NETWORK_ACCESS_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "on", label: "On" },
] as const satisfies ReadonlyArray<{
  value: PiNetworkAccess;
  label: string;
}>;

export const APPROVAL_POLICY_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "approval-required", label: "Approval required" },
] as const satisfies ReadonlyArray<{
  value: PiApprovalPolicy;
  label: string;
}>;

export const THINKING_LEVEL_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "XHigh" },
] as const satisfies ReadonlyArray<{
  value: PiAgentConfig["thinkingLevel"];
  label: string;
}>;

export const QUEUE_MODE_OPTIONS = [
  { value: "one-at-a-time", label: "One at a time" },
  { value: "all", label: "All" },
] as const satisfies ReadonlyArray<{
  value: PiAgentConfig["steeringMode"];
  label: string;
}>;

export const FALLBACK_PI_AGENT_CONFIG: PiAgentConfig = {
  provider: "openai-codex",
  modelId: "gpt-5.4-mini",
  thinkingLevel: "off",
  transport: "websocket",
  steeringMode: "one-at-a-time",
  followUpMode: "one-at-a-time",
  activeToolNames: ["read", "bash", "edit", "write"],
  sandboxMode: "workspace-write",
  networkAccess: "off",
  approvalPolicy: "approval-required",
  branch: null,
};

export function areAgentConfigsEqual(a: PiAgentConfig, b: PiAgentConfig) {
  return (
    a.provider === b.provider &&
    a.modelId === b.modelId &&
    a.thinkingLevel === b.thinkingLevel &&
    a.transport === b.transport &&
    a.steeringMode === b.steeringMode &&
    a.followUpMode === b.followUpMode &&
    a.sandboxMode === b.sandboxMode &&
    a.networkAccess === b.networkAccess &&
    a.approvalPolicy === b.approvalPolicy &&
    a.branch === b.branch &&
    a.activeToolNames.length === b.activeToolNames.length &&
    a.activeToolNames.every((toolName, index) => toolName === b.activeToolNames[index])
  );
}

export function prettyProviderName(providerId: string) {
  return providerId
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getModelValue(model: Pick<PiModelOption, "provider" | "id">) {
  return `${model.provider}::${model.id}`;
}

export function parseModelValue(value: string) {
  const [provider, modelId] = value.split("::");
  if (!provider || !modelId) {
    return null;
  }

  return { provider, modelId };
}

export function updateAgentConfigModel(
  config: PiAgentConfig,
  value: string,
): PiAgentConfig {
  const parsed = parseModelValue(value);
  if (!parsed) {
    return config;
  }

  return {
    ...config,
    provider: parsed.provider,
    modelId: parsed.modelId,
  };
}

export function getProviderModels(models: PiModelOption[], provider: string) {
  return models.filter((model) => model.provider === provider);
}

export function normalizeAgentConfig(
  config: PiAgentConfig,
  models: PiModelOption[],
): PiAgentConfig {
  if (models.length === 0) {
    return config;
  }

  const exactModel = models.find(
    (model) =>
      model.provider === config.provider && model.id === config.modelId,
  );
  if (exactModel) {
    return config;
  }

  const providerModel = models.find((model) => model.provider === config.provider);
  if (providerModel) {
    return {
      ...config,
      modelId: providerModel.id,
    };
  }

  const fallbackModel = models[0];
  return {
    ...config,
    provider: fallbackModel.provider,
    modelId: fallbackModel.id,
  };
}
