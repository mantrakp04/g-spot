import type { PiAgentConfig, PiSdkModel } from "@g-spot/types";

export type PiModelOption = Pick<PiSdkModel, "provider" | "id" | "name">;

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

export const TRANSPORT_OPTIONS = [
  { value: "sse", label: "SSE" },
  { value: "websocket", label: "WebSocket" },
  { value: "auto", label: "Auto" },
] as const satisfies ReadonlyArray<{
  value: PiAgentConfig["transport"];
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
  transport: "sse",
  steeringMode: "one-at-a-time",
  followUpMode: "one-at-a-time",
  activeToolNames: ["read", "bash", "edit", "write"],
};

export function areAgentConfigsEqual(a: PiAgentConfig, b: PiAgentConfig) {
  return (
    a.provider === b.provider &&
    a.modelId === b.modelId &&
    a.thinkingLevel === b.thinkingLevel &&
    a.transport === b.transport &&
    a.steeringMode === b.steeringMode &&
    a.followUpMode === b.followUpMode &&
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
