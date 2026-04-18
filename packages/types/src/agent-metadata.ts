import { z } from "zod";

import { piAgentConfigSchema } from "./agent";

export const PI_PROVIDER_CREDENTIALS_METADATA_KEY = "piProviderCredentials";
export const PI_DEFAULT_CHAT_CONFIG_METADATA_KEY = "piDefaultChatConfig";
export const PI_DEFAULT_WORKER_CONFIG_METADATA_KEY = "piDefaultWorkerConfig";

export const piStoredCredentialSchema = z
  .object({
    type: z.enum(["api_key", "oauth"]),
  })
  .passthrough();

export const piStoredCredentialsSchema = z.record(
  z.string(),
  piStoredCredentialSchema,
);

export const piClientMetadataSchema = z.object({
  [PI_PROVIDER_CREDENTIALS_METADATA_KEY]: piStoredCredentialsSchema.optional(),
  [PI_DEFAULT_CHAT_CONFIG_METADATA_KEY]: piAgentConfigSchema.optional(),
  [PI_DEFAULT_WORKER_CONFIG_METADATA_KEY]: piAgentConfigSchema.optional(),
});
