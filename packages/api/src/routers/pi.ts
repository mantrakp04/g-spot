import { z } from "zod";

import {
  type PiCatalog,
  type PiCredentialSummary,
  piAgentConfigSchema,
  piProviderApiKeySchema,
} from "@g-spot/types";

import { authedProcedure, router } from "../index";
import { cancelPiOAuthSession, getPiOAuthSession, listPiOAuthProviders, startPiOAuthSession, submitPiOAuthManualCode, submitPiOAuthPrompt } from "../lib/pi-auth";
import {
  createPiModelRegistryForUser,
  getPiAgentDefaults,
  getPiBuiltinTools,
  getPiUserMetadata,
  patchPiAgentDefaults,
  removePiCredential,
  upsertPiCredential,
} from "../lib/pi";

export const piRouter = router({
  catalog: authedProcedure.query(async ({ ctx }) => {
    const [{ modelRegistry }, defaults, metadata] = await Promise.all([
      createPiModelRegistryForUser(ctx.userId),
      getPiAgentDefaults(ctx.userId),
      getPiUserMetadata(ctx.userId),
    ]);

    const configuredProviders: PiCredentialSummary[] = Object.entries(
      metadata.credentials,
    ).map(([provider, credential]) => ({
      provider,
      type: credential.type,
    }));

    const catalog: PiCatalog = {
      oauthProviders: listPiOAuthProviders(),
      tools: getPiBuiltinTools(),
      models: modelRegistry.getAll(),
      availableModels: modelRegistry.getAvailable(),
      defaults,
      configuredProviders,
    };

    return catalog;
  }),

  defaults: authedProcedure.query(async ({ ctx }) => {
    return getPiAgentDefaults(ctx.userId);
  }),

  updateDefaults: authedProcedure
    .input(
      z.object({
        chat: piAgentConfigSchema.optional(),
        worker: piAgentConfigSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await patchPiAgentDefaults(ctx.userId, input);
      return getPiAgentDefaults(ctx.userId);
    }),

  credentials: authedProcedure.query(async ({ ctx }) => {
    const metadata = await getPiUserMetadata(ctx.userId);
    const credentials: PiCredentialSummary[] = Object.entries(
      metadata.credentials,
    ).map(([provider, credential]) => ({
      provider,
      type: credential.type,
    }));
    return credentials;
  }),

  saveApiKey: authedProcedure
    .input(piProviderApiKeySchema)
    .mutation(async ({ ctx, input }) => {
      await upsertPiCredential(ctx.userId, input.provider, {
        type: "api_key",
        key: input.apiKey,
      });

      return {
        provider: input.provider,
        type: "api_key" as const,
      };
    }),

  removeCredential: authedProcedure
    .input(
      z.object({
        provider: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await removePiCredential(ctx.userId, input.provider);
      return { provider: input.provider };
    }),

  startOAuth: authedProcedure
    .input(
      z.object({
        provider: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return startPiOAuthSession(ctx.userId, input.provider);
    }),

  oauthSession: authedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1),
      }),
    )
    .query(({ input }) => {
      return getPiOAuthSession(input.sessionId);
    }),

  submitOAuthPrompt: authedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1),
        value: z.string(),
      }),
    )
    .mutation(({ input }) => {
      return submitPiOAuthPrompt(input.sessionId, input.value);
    }),

  submitOAuthManualCode: authedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1),
        value: z.string().min(1),
      }),
    )
    .mutation(({ input }) => {
      return submitPiOAuthManualCode(input.sessionId, input.value);
    }),

  cancelOAuth: authedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1),
      }),
    )
    .mutation(({ input }) => {
      return cancelPiOAuthSession(input.sessionId);
    }),
});
