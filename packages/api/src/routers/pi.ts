import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getProject } from "@g-spot/db/projects";

import {
  type PiCatalog,
  type PiCredentialSummary,
  piAgentConfigSchema,
  piProviderApiKeySchema,
} from "@g-spot/types";

import { publicProcedure, router } from "../index";
import { cancelPiOAuthSession, getPiOAuthSession, listPiOAuthProviders, startPiOAuthSession, submitPiOAuthManualCode, submitPiOAuthPrompt } from "../lib/pi-auth";
import {
  getPiAgentDefaults,
  getPiBuiltinTools,
  getPiUserState,
  patchPiAgentDefaults,
  createPiModelRegistry,
  removePiCredential,
  upsertPiCredential,
} from "../lib/pi";
import {
  installPiAddon,
  listPiAddons,
  removePiAddon,
} from "../lib/pi-addons";
import {
  listPopularPiCatalog,
  PiCatalogError,
  searchPiCatalog,
} from "../lib/pi-catalog";

async function getProjectPathOrThrow(projectId: string | null) {
  if (projectId === null) {
    return null;
  }

  const project = await getProject(projectId);
  if (!project) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Project not found",
    });
  }

  return project.path;
}

export const piRouter = router({
  catalog: publicProcedure.query(async () => {
    const [{ modelRegistry }, defaults, state] = await Promise.all([
      createPiModelRegistry(),
      getPiAgentDefaults(),
      getPiUserState(),
    ]);

    const catalog: PiCatalog = {
      oauthProviders: listPiOAuthProviders(),
      tools: getPiBuiltinTools(),
      models: modelRegistry.getAll(),
      availableModels: modelRegistry.getAvailable(),
      defaults,
      configuredProviders: Object.entries(state.credentials).map(
        ([provider, credential]): PiCredentialSummary => ({
          provider,
          type: credential.type,
        }),
      ),
    };

    return catalog;
  }),

  defaults: publicProcedure.query(async () => {
    return getPiAgentDefaults();
  }),

  updateDefaults: publicProcedure
    .input(
      z.object({
        chat: piAgentConfigSchema.optional(),
        worker: piAgentConfigSchema.optional(),
      }),
    )
    .mutation(async ({ input }) => {
      await patchPiAgentDefaults(input);
      return getPiAgentDefaults();
    }),

  credentials: publicProcedure.query(async () => {
    const state = await getPiUserState();
    const credentials: PiCredentialSummary[] = Object.entries(
      state.credentials,
    ).map(([provider, credential]) => ({
      provider,
      type: credential.type,
    }));
    return credentials;
  }),

  saveApiKey: publicProcedure
    .input(piProviderApiKeySchema)
    .mutation(async ({ input }) => {
      await upsertPiCredential(input.provider, {
        type: "api_key",
        key: input.apiKey,
      });

      return {
        provider: input.provider,
        type: "api_key" as const,
      };
    }),

  removeCredential: publicProcedure
    .input(
      z.object({
        provider: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      await removePiCredential(input.provider);
      return { provider: input.provider };
    }),

  startOAuth: publicProcedure
    .input(
      z.object({
        provider: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      return startPiOAuthSession(input.provider);
    }),

  oauthSession: publicProcedure
    .input(
      z.object({
        sessionId: z.string().min(1),
      }),
    )
    .query(({ input }) => {
      return getPiOAuthSession(input.sessionId);
    }),

  submitOAuthPrompt: publicProcedure
    .input(
      z.object({
        sessionId: z.string().min(1),
        value: z.string(),
      }),
    )
    .mutation(({ input }) => {
      return submitPiOAuthPrompt(input.sessionId, input.value);
    }),

  submitOAuthManualCode: publicProcedure
    .input(
      z.object({
        sessionId: z.string().min(1),
        value: z.string().min(1),
      }),
    )
    .mutation(({ input }) => {
      return submitPiOAuthManualCode(input.sessionId, input.value);
    }),

  cancelOAuth: publicProcedure
    .input(
      z.object({
        sessionId: z.string().min(1),
      }),
    )
    .mutation(({ input }) => {
      return cancelPiOAuthSession(input.sessionId);
    }),

  listAddons: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1).nullable(),
      }),
    )
    .query(async ({ input }) => {
      return listPiAddons(await getProjectPathOrThrow(input.projectId));
    }),

  installAddon: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1).nullable(),
        source: z.string().min(1).max(512),
      }),
    )
    .mutation(async ({ input }) => {
      await installPiAddon(
        input.source.trim(),
        await getProjectPathOrThrow(input.projectId),
      );

      return listPiAddons(await getProjectPathOrThrow(input.projectId));
    }),

  removeAddon: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1).nullable(),
        source: z.string().min(1).max(512),
      }),
    )
    .mutation(async ({ input }) => {
      await removePiAddon(
        input.source.trim(),
        await getProjectPathOrThrow(input.projectId),
      );

      return listPiAddons(await getProjectPathOrThrow(input.projectId));
    }),

  popularCatalog: publicProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(50).default(24),
      }),
    )
    .query(async ({ input }) => {
      try {
        return await listPopularPiCatalog(input.limit);
      } catch (err) {
        throw translatePiCatalogError(err);
      }
    }),

  searchCatalog: publicProcedure
    .input(
      z.object({
        query: z.string().min(1).max(128),
        limit: z.number().int().min(1).max(50).default(24),
      }),
    )
    .query(async ({ input }) => {
      try {
        return await searchPiCatalog(input.query.trim(), input.limit);
      } catch (err) {
        throw translatePiCatalogError(err);
      }
    }),
});

function translatePiCatalogError(err: unknown): TRPCError {
  if (err instanceof PiCatalogError) {
    return new TRPCError({ code: "BAD_GATEWAY", message: err.message });
  }
  if (err instanceof TRPCError) return err;
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: err instanceof Error ? err.message : "Pi catalog error",
  });
}
