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
  Skill as PiSkill,
} from "@mariozechner/pi-coding-agent";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Message, Model } from "@mariozechner/pi-ai";
import type { Transport } from "@mariozechner/pi-ai";
import { getOAuthProviders } from "@mariozechner/pi-ai/oauth";
import {
  DEFAULT_PI_ACTIVE_TOOL_NAMES,
  PI_DEFAULT_CHAT_CONFIG_METADATA_KEY,
  PI_DEFAULT_WORKER_CONFIG_METADATA_KEY,
  PI_PROVIDER_CREDENTIALS_METADATA_KEY,
  piAgentConfigSchema,
  piServerMetadataSchema,
  type PiAgentConfig,
  type PiAgentDefaults,
  type PiBuiltinToolName,
  type PiOAuthProviderSummary,
  type PiSdkModel,
  type PiSdkToolInfo,
} from "@g-spot/types";

import { getServerMetadata, patchServerMetadata } from "./stack-server";

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
  const parsed = piAgentConfigSchema.safeParse({
    ...fallback,
    ...(value && typeof value === "object" ? value : {}),
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
  metadata: Record<string, unknown>,
): Record<string, AuthCredential> {
  const parsed = piServerMetadataSchema.safeParse(metadata);
  if (!parsed.success) {
    return {};
  }

  const rawCredentials =
    parsed.data[PI_PROVIDER_CREDENTIALS_METADATA_KEY] ?? {};

  return Object.fromEntries(
    Object.entries(rawCredentials).filter((entry): entry is [string, AuthCredential] => {
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

export async function getPiUserMetadata(userId: string) {
  const metadata = await getServerMetadata(userId);
  const parsed = piServerMetadataSchema.safeParse(metadata);

  return {
    raw: metadata,
    parsed: parsed.success ? parsed.data : {},
    credentials: normalizeStoredCredentials(metadata),
  };
}

export async function getPiAgentDefaults(userId: string): Promise<PiAgentDefaults> {
  const metadata = await getPiUserMetadata(userId);

  return {
    chat: mergeAgentConfig(
      metadata.parsed[PI_DEFAULT_CHAT_CONFIG_METADATA_KEY],
      DEFAULT_CHAT_CONFIG,
    ),
    worker: mergeAgentConfig(
      metadata.parsed[PI_DEFAULT_WORKER_CONFIG_METADATA_KEY],
      DEFAULT_WORKER_CONFIG,
    ),
  };
}

export async function patchPiAgentDefaults(
  userId: string,
  patch: Partial<{
    chat: PiAgentConfig;
    worker: PiAgentConfig;
  }>,
) {
  const defaults = await getPiAgentDefaults(userId);

  await patchServerMetadata(userId, {
    ...(patch.chat
      ? {
          [PI_DEFAULT_CHAT_CONFIG_METADATA_KEY]: mergeAgentConfig(
            patch.chat,
            defaults.chat,
          ),
        }
      : {}),
    ...(patch.worker
      ? {
          [PI_DEFAULT_WORKER_CONFIG_METADATA_KEY]: mergeAgentConfig(
            patch.worker,
            defaults.worker,
          ),
        }
      : {}),
  });
}

export async function upsertPiCredential(
  userId: string,
  provider: string,
  credential: AuthCredential,
) {
  const metadata = await getPiUserMetadata(userId);

  await patchServerMetadata(userId, {
    [PI_PROVIDER_CREDENTIALS_METADATA_KEY]: {
      ...metadata.credentials,
      [provider]: credential,
    },
  });
}

export async function removePiCredential(userId: string, provider: string) {
  const metadata = await getPiUserMetadata(userId);
  const nextCredentials = { ...metadata.credentials };
  delete nextCredentials[provider];

  await patchServerMetadata(userId, {
    [PI_PROVIDER_CREDENTIALS_METADATA_KEY]: nextCredentials,
  });
}

export async function createPiAuthStorageForUser(userId: string) {
  const metadata = await getPiUserMetadata(userId);
  return AuthStorage.inMemory(metadata.credentials);
}

export async function createPiModelRegistryForUser(userId: string) {
  const authStorage = await createPiAuthStorageForUser(userId);
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

export type PiAgentSessionProject = {
  id: string;
  path: string;
  customInstructions?: string | null;
  appendPrompt?: string | null;
};

export async function createPiAgentSession(args: {
  userId: string;
  config: PiAgentConfig;
  activeToolNames?: PiBuiltinToolName[];
  /**
   * Project the session is bound to. Determines `cwd`, the system prompt
   * (`customInstructions` / `appendPrompt`), and which DB-stored skills get
   * surfaced to the agent. When omitted (legacy callers / no-project flows),
   * the session falls back to the server's `process.cwd()` and no project
   * resources are loaded.
   */
  project?: PiAgentSessionProject;
  /** Pre-materialized skills to inject via `skillsOverride`. */
  materializedSkills?: PiSkill[];
  /**
   * Skip on-disk skill / extension / theme / prompt discovery rooted at the
   * project's cwd. Used by the title worker so background runs stay hermetic
   * and don't pay the disk-scan cost on every chat.
   */
  disableProjectResources?: boolean;
}) {
  const { authStorage, modelRegistry } = await createPiModelRegistryForUser(
    args.userId,
  );
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
  const materializedSkills = args.materializedSkills ?? [];
  const disableExtras = args.disableProjectResources === true;

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    settingsManager,
    systemPrompt: args.project?.customInstructions ?? undefined,
    appendSystemPrompt: args.project?.appendPrompt ?? undefined,
    noExtensions: disableExtras,
    noPromptTemplates: disableExtras,
    noThemes: disableExtras,
    // We always own skill discovery via `skillsOverride` below — disable
    // on-disk scanning so we don't accidentally double-load or get a stale
    // copy from a `.pi/skills/` directory inside the project root.
    noSkills: true,
    skillsOverride: () => ({
      skills: materializedSkills,
      diagnostics: [],
    }),
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
  });

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
