import { useUser } from "@stackframe/react";
import { useCallback, useState } from "react";

export const CHAT_MODELS = [
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
  { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
  { id: "gpt-5.2-codex", label: "GPT-5.2 Codex" },
  { id: "gpt-5.2", label: "GPT-5.2" },
  { id: "gpt-5.1-codex-max", label: "GPT-5.1 Codex Max" },
  { id: "gpt-5.1-codex-mini", label: "GPT-5.1 Codex Mini" },
] as const;

export type ChatModelId = (typeof CHAT_MODELS)[number]["id"];

export const DEFAULT_CHAT_MODEL: ChatModelId = "gpt-5.4-mini";
export const DEFAULT_WORKER_MODEL: ChatModelId = "gpt-5.4-mini";

const DEFAULT_CHAT_MODEL_KEY = "defaultChatModel";
const DEFAULT_WORKER_MODEL_KEY = "defaultWorkerModel";
const LEGACY_CHAT_PREFERENCES_KEY = "gSpotChatPreferences";
const CHAT_MODEL_IDS = new Set<string>(CHAT_MODELS.map((model) => model.id));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getPreferencesRecord(
  metadata: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(metadata)) {
    return undefined;
  }

  const preferences = metadata[LEGACY_CHAT_PREFERENCES_KEY];
  return isRecord(preferences) ? preferences : undefined;
}

function getModelFromMetadata(
  metadata: unknown,
  key: string,
  fallback: ChatModelId,
): ChatModelId {
  if (
    isRecord(metadata) &&
    typeof metadata[key] === "string" &&
    CHAT_MODEL_IDS.has(metadata[key] as string)
  ) {
    return metadata[key] as ChatModelId;
  }

  const preferences = getPreferencesRecord(metadata);
  const value = preferences?.[key];

  if (typeof value === "string" && CHAT_MODEL_IDS.has(value)) {
    return value as ChatModelId;
  }

  return fallback;
}

export function getDefaultChatModelFromMetadata(metadata: unknown): ChatModelId {
  return getModelFromMetadata(metadata, DEFAULT_CHAT_MODEL_KEY, DEFAULT_CHAT_MODEL);
}

export function getDefaultWorkerModelFromMetadata(
  metadata: unknown,
): ChatModelId {
  return getModelFromMetadata(
    metadata,
    DEFAULT_WORKER_MODEL_KEY,
    DEFAULT_WORKER_MODEL,
  );
}

function useModelPreference(
  key: typeof DEFAULT_CHAT_MODEL_KEY | typeof DEFAULT_WORKER_MODEL_KEY,
  fallback: ChatModelId,
) {
  const user = useUser();
  const [isSaving, setIsSaving] = useState(false);
  const model = getModelFromMetadata(user?.clientMetadata, key, fallback);

  const setModel = useCallback(
    async (nextModel: ChatModelId) => {
      if (!user) {
        return;
      }

      const currentMetadata = isRecord(user.clientMetadata)
        ? user.clientMetadata
        : {};

      setIsSaving(true);
      try {
        await user.setClientMetadata({
          ...currentMetadata,
          [key]: nextModel,
        });
      } finally {
        setIsSaving(false);
      }
    },
    [key, user],
  );

  return {
    model,
    setModel,
    isSaving,
  };
}

export function useDefaultChatModelPreference() {
  const {
    model,
    setModel,
    isSaving,
  } = useModelPreference(DEFAULT_CHAT_MODEL_KEY, DEFAULT_CHAT_MODEL);

  return {
    defaultChatModel: model,
    setDefaultChatModel: setModel,
    isSaving,
  };
}

export function useDefaultWorkerModelPreference() {
  const {
    model,
    setModel,
    isSaving,
  } = useModelPreference(DEFAULT_WORKER_MODEL_KEY, DEFAULT_WORKER_MODEL);

  return {
    defaultWorkerModel: model,
    setDefaultWorkerModel: setModel,
    isSaving,
  };
}
