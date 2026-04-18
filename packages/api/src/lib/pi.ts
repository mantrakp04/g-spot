import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  bashTool,
  bashToolDefinition,
  createAgentSession,
  editTool,
  editToolDefinition,
  findTool,
  findToolDefinition,
  grepTool,
  grepToolDefinition,
  lsTool,
  lsToolDefinition,
  readTool,
  readToolDefinition,
  writeTool,
  writeToolDefinition,
} from "@mariozechner/pi-coding-agent";
import type {
  AuthCredential,
  ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Message, Model } from "@mariozechner/pi-ai";
import type { Transport } from "@mariozechner/pi-ai";
import { getOAuthProviders } from "@mariozechner/pi-ai/oauth";
import {
  getPiState,
  upsertPiState,
} from "@g-spot/db/pi";
import type { PiStateRow } from "@g-spot/db/schema/pi";
import {
  DEFAULT_PI_ACTIVE_TOOL_NAMES,
  piAgentConfigSchema,
  piStoredCredentialsSchema,
  type PiAgentConfig,
  type PiAgentDefaults,
  type PiBuiltinToolName,
  type PiOAuthProviderSummary,
  type PiSdkModel,
  type PiSdkToolInfo,
} from "@g-spot/types";

const BUILTIN_TOOL_REGISTRY = {
  read: readTool,
  bash: bashTool,
  edit: editTool,
  write: writeTool,
  grep: grepTool,
  find: findTool,
  ls: lsTool,
} as const satisfies Record<PiBuiltinToolName, unknown>;

const BUILTIN_TOOL_DEFINITIONS = [
  readToolDefinition,
  bashToolDefinition,
  editToolDefinition,
  writeToolDefinition,
  grepToolDefinition,
  findToolDefinition,
  lsToolDefinition,
] as const;

const DEFAULT_CHAT_CONFIG = piAgentConfigSchema.parse({});
const DEFAULT_WORKER_CONFIG = piAgentConfigSchema.parse({});

function mergeAgentConfig(
  value: unknown,
  fallback: PiAgentConfig,
): PiAgentConfig {
  const normalizedValue =
    value && typeof value === "object"
      ? {
          ...value,
          transport: "websocket",
        }
      : { transport: "websocket" };

  const parsed = piAgentConfigSchema.safeParse({
    ...fallback,
    ...normalizedValue,
  });

  const config = parsed.success ? parsed.data : fallback;
  const dedupedToolNames = Array.from(
    new Set(
      config.activeToolNames.filter(
        (toolName): toolName is PiBuiltinToolName =>
          toolName in BUILTIN_TOOL_REGISTRY,
      ),
    ),
  );

  return {
    ...config,
    activeToolNames:
      dedupedToolNames.length > 0
        ? dedupedToolNames
        : [...DEFAULT_PI_ACTIVE_TOOL_NAMES],
  };
}

function normalizeStoredCredentials(
  encodedCredentials: string | null | undefined,
): Record<string, AuthCredential> {
  if (typeof encodedCredentials !== "string" || encodedCredentials.length === 0) {
    return {};
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(encodedCredentials);
  } catch {
    return {};
  }

  const parsed = piStoredCredentialsSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(parsed.data).filter((entry): entry is [string, AuthCredential] => {
      const [, credential] = entry;
      return (
        credential.type === "api_key" ||
        credential.type === "oauth"
      );
    }),
  );
}

export function getDefaultChatConfig() {
  return { ...DEFAULT_CHAT_CONFIG };
}

export function getDefaultWorkerConfig() {
  return { ...DEFAULT_WORKER_CONFIG };
}

function parseStoredAgentConfig(
  encodedConfig: string | null | undefined,
  fallback: PiAgentConfig,
) {
  if (typeof encodedConfig !== "string" || encodedConfig.length === 0) {
    return fallback;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(encodedConfig);
  } catch {
    return fallback;
  }

  return mergeAgentConfig(parsedJson, fallback);
}

export async function getPiUserState(): Promise<{
  row: PiStateRow | null;
  defaults: PiAgentDefaults;
  credentials: Record<string, AuthCredential>;
}> {
  const row = await getPiState();
  const defaults = {
    chat: parseStoredAgentConfig(row?.chatDefaults, DEFAULT_CHAT_CONFIG),
    worker: parseStoredAgentConfig(row?.workerDefaults, DEFAULT_WORKER_CONFIG),
  };
  const credentials = normalizeStoredCredentials(row?.credentials);

  return {
    row,
    defaults,
    credentials,
  };
}

export async function getPiAgentDefaults(): Promise<PiAgentDefaults> {
  const state = await getPiUserState();
  return state.defaults;
}

export async function patchPiAgentDefaults(
  patch: Partial<{
    chat: PiAgentConfig;
    worker: PiAgentConfig;
  }>,
) {
  const defaults = await getPiAgentDefaults();

  await upsertPiState({
    ...(patch.chat
      ? {
          chatDefaults: JSON.stringify(
            mergeAgentConfig(patch.chat, defaults.chat),
          ),
        }
      : {}),
    ...(patch.worker
      ? {
          workerDefaults: JSON.stringify(
            mergeAgentConfig(patch.worker, defaults.worker),
          ),
        }
      : {}),
  });
}

export async function upsertPiCredential(
  provider: string,
  credential: AuthCredential,
) {
  const state = await getPiUserState();

  await upsertPiState({
    credentials: JSON.stringify({
      ...state.credentials,
      [provider]: credential,
    }),
  });
}

export async function removePiCredential(provider: string) {
  const state = await getPiUserState();
  const nextCredentials = { ...state.credentials };
  delete nextCredentials[provider];

  await upsertPiState({
    credentials: JSON.stringify(nextCredentials),
  });
}

export async function createPiAuthStorage() {
  const state = await getPiUserState();
  return AuthStorage.inMemory(state.credentials);
}

export async function createPiModelRegistry() {
  const authStorage = await createPiAuthStorage();
  return {
    authStorage,
    modelRegistry: ModelRegistry.inMemory(authStorage),
  };
}

export function createPiPublicModelRegistry() {
  const authStorage = AuthStorage.inMemory({});
  return {
    authStorage,
    modelRegistry: ModelRegistry.inMemory(authStorage),
  };
}

function getFallbackModel(
  modelRegistry: ModelRegistry,
  preferredProvider: string,
): Model<any> | null {
  const availableModels = modelRegistry.getAvailable();
  if (availableModels.length > 0) {
    return (
      availableModels.find((model: Model<any>) => model.provider === preferredProvider) ??
      availableModels[0] ??
      null
    );
  }

  const allModels = modelRegistry.getAll();
  if (allModels.length === 0) {
    return null;
  }

  return (
    allModels.find((model: Model<any>) => model.provider === preferredProvider) ??
    allModels[0] ??
    null
  );
}

export function resolvePiModel(
  modelRegistry: ModelRegistry,
  config: PiAgentConfig,
): { model: PiSdkModel; config: PiAgentConfig } | null {
  const exactModel = modelRegistry.find(config.provider, config.modelId);
  const fallbackModel = getFallbackModel(modelRegistry, config.provider);
  const model =
    exactModel && modelRegistry.hasConfiguredAuth(exactModel)
      ? exactModel
      : fallbackModel;

  if (!model) {
    return null;
  }

  return {
    model,
    config: {
      ...config,
      provider: model.provider,
      modelId: model.id,
    },
  };
}

export function getPiBuiltinTools(): PiSdkToolInfo[] {
  return BUILTIN_TOOL_DEFINITIONS.map((definition) => ({
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    sourceInfo: {
      path: definition.name,
      source: "g-spot",
      scope: "temporary",
      origin: "top-level",
    },
  }));
}

export function normalizePiAgentConfig(
  value: unknown,
  fallback: PiAgentConfig = DEFAULT_CHAT_CONFIG,
) {
  return mergeAgentConfig(value, fallback);
}

export function normalizeStoredChatAgentConfig(chat: {
  agentConfig?: string | null;
  model?: string | null;
}) {
  let parsedAgentConfig: unknown = {};

  if (typeof chat.agentConfig === "string" && chat.agentConfig.length > 0) {
    try {
      parsedAgentConfig = JSON.parse(chat.agentConfig);
    } catch {
      parsedAgentConfig = {};
    }
  }

  return normalizePiAgentConfig({
    ...(chat.model ? { modelId: chat.model } : {}),
    ...(parsedAgentConfig && typeof parsedAgentConfig === "object"
      ? parsedAgentConfig
      : {}),
  });
}

/**
 * Parse the JSON blob stored on `projects.agent_config`. Empty / malformed
 * values fall back to the given `fallback` (typically the user's Pi defaults).
 */
export function normalizeStoredProjectAgentConfig(
  projectAgentConfig: string | null | undefined,
  fallback: PiAgentConfig,
): PiAgentConfig {
  if (typeof projectAgentConfig !== "string" || projectAgentConfig.length === 0) {
    return fallback;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(projectAgentConfig);
  } catch {
    return fallback;
  }

  if (!parsed || typeof parsed !== "object" || Object.keys(parsed).length === 0) {
    return fallback;
  }

  return normalizePiAgentConfig(parsed, fallback);
}

export type PiAgentSessionProject = {
  id: string;
  path: string;
  customInstructions?: string | null;
  appendPrompt?: string | null;
};

export async function createPiAgentSession(args: {
  config: PiAgentConfig;
  activeToolNames?: PiBuiltinToolName[];
  /**
   * Project the session is bound to. Determines `cwd`, the system prompt
   * (`customInstructions` / `appendPrompt`), and which Pi project resources
   * get surfaced to the agent. When omitted (legacy callers / no-project flows),
   * the session falls back to the server's `process.cwd()` and no project
   * resources are loaded.
   */
  project?: PiAgentSessionProject;
  /**
   * Skip on-disk skill / extension / theme / prompt discovery rooted at the
   * project's cwd. Used by the title worker so background runs stay hermetic
   * and don't pay the disk-scan cost on every chat.
   */
  disableProjectResources?: boolean;
  /**
   * Custom tool definitions forwarded to `createAgentSession`. These are
   * registered in addition to the built-in tools selected by
   * `activeToolNames`.
   */
  customTools?: ToolDefinition[];
}) {
  const { authStorage, modelRegistry } = await createPiModelRegistry();
  const resolved = resolvePiModel(modelRegistry, args.config);
  if (!resolved) {
    throw new Error(
      "No Pi models are available. Connect an OAuth provider or add an API key first.",
    );
  }

  const toolNames = args.activeToolNames ?? resolved.config.activeToolNames;
  const tools = toolNames.map((toolName) => BUILTIN_TOOL_REGISTRY[toolName]);

  const settingsManager = SettingsManager.inMemory({
    defaultProvider: resolved.config.provider,
    defaultModel: resolved.config.modelId,
    defaultThinkingLevel: resolved.config.thinkingLevel as ThinkingLevel,
    transport: resolved.config.transport as Transport,
    steeringMode: resolved.config.steeringMode,
    followUpMode: resolved.config.followUpMode,
  });

  const cwd = args.project?.path ?? process.cwd();
  const disableExtras = args.disableProjectResources === true;

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    settingsManager,
    systemPrompt: args.project?.customInstructions ?? undefined,
    appendSystemPrompt: args.project?.appendPrompt ?? undefined,
    noExtensions: disableExtras,
    noPromptTemplates: disableExtras,
    noSkills: disableExtras,
    noThemes: disableExtras,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd,
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager,
    resourceLoader,
    model: resolved.model,
    thinkingLevel: resolved.config.thinkingLevel as ThinkingLevel,
    tools,
    customTools: args.customTools,
  });

  await session.bindExtensions({});
  session.setSteeringMode(resolved.config.steeringMode);
  session.setFollowUpMode(resolved.config.followUpMode);

  return {
    session,
    authStorage,
    modelRegistry,
    model: resolved.model,
    config: resolved.config,
  };
}

export function getPiOAuthProviderCatalog(): PiOAuthProviderSummary[] {
  return getOAuthProviders().map((provider: { id: string; name: string; usesCallbackServer?: boolean }) => ({
    id: provider.id,
    name: provider.name,
    usesCallbackServer: provider.usesCallbackServer ?? false,
  }));
}

export function extractAssistantText(message: Message) {
  if (message.role !== "assistant") {
    return "";
  }

  return (message as AssistantMessage).content
    .flatMap((contentPart: AssistantMessage["content"][number]) =>
      contentPart.type === "text" ? [contentPart.text.trim()] : [],
    )
    .filter(Boolean)
    .join("\n")
    .trim();
}
