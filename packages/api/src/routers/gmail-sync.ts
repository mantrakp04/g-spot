import { z } from "zod";

import {
  getAnalysisState,
  getGmailAccount,
  getGmailThreadStats,
  listGmailAgentWorkflows,
  listFetchStates,
  deleteGmailAgentWorkflow,
  upsertGmailAgentWorkflow,
  upsertGmailAccount,
} from "@g-spot/db/gmail";
import {
  GMAIL_AGENT_TOOL_NAME_VALUES,
  gmailAgentWorkflowUpsertSchema,
  gmailAgentToolNameSchema,
  piAgentConfigSchema,
} from "@g-spot/types";

import { publicProcedure, router } from "../index";
import {
  cancelSync,
  getActiveSync,
  syncStartIntents,
  startSync,
} from "../lib/gmail-sync";
import {
  cancelGmailExtraction,
  getActiveGmailExtraction,
  startGmailExtraction,
} from "../lib/gmail-extraction";
import { getProfile } from "../lib/gmail-client";

type OperationStatus = "idle" | "running" | "paused" | "interrupted" | "completed" | "error";

type FetchProgressResponse = {
  status: OperationStatus;
  totalThreads: number;
  syncedThreads: number;
  failedThreads: number;
  startedAt: string | null;
  error: string | null;
};

type AnalysisProgressResponse = {
  status: Exclude<OperationStatus, "interrupted">;
  totalInboxThreads: number;
  analyzedInboxThreads: number;
  failedInboxThreads: number;
  remainingInboxThreads: number;
  startedAt: string | null;
  error: string | null;
};

type SyncProgressResponse = {
  fetch: {
    activeMode: "full" | "incremental" | null;
    full: FetchProgressResponse;
    incremental: FetchProgressResponse;
  };
  analysis: AnalysisProgressResponse;
  account: {
    hasCompletedFullSync: boolean;
    hasCompletedIncrementalSync: boolean;
    needsFullResync: boolean;
  };
  local: {
    totalThreads: number;
    inboxThreads: number;
    unprocessedInboxThreads: number;
  };
};

function emptyFetchProgress(): FetchProgressResponse {
  return {
    status: "idle",
    totalThreads: 0,
    syncedThreads: 0,
    failedThreads: 0,
    startedAt: null,
    error: null,
  };
}

function emptyAnalysisProgress(local: {
  inboxThreads: number;
  unprocessedInboxThreads: number;
}): AnalysisProgressResponse {
  return {
    status: local.inboxThreads > 0 && local.unprocessedInboxThreads === 0
      ? "completed"
      : "idle",
    totalInboxThreads: local.inboxThreads,
    analyzedInboxThreads: Math.max(0, local.inboxThreads - local.unprocessedInboxThreads),
    failedInboxThreads: 0,
    remainingInboxThreads: local.unprocessedInboxThreads,
    startedAt: null,
    error: null,
  };
}

function toFetchProgressResponse(input: {
  status: string;
  totalThreads: number;
  fetchedThreads: number;
  failedThreads: number;
  startedAt: string | null;
  error: string | null;
}): FetchProgressResponse {
  const status = isOperationStatus(input.status) ? input.status : "idle";

  return {
    status,
    totalThreads: input.totalThreads,
    syncedThreads: input.fetchedThreads,
    failedThreads: input.failedThreads,
    startedAt: input.startedAt,
    error: input.error,
  };
}

function toAnalysisProgressResponse(
  input: {
    status: string;
    totalThreads: number;
    analyzedThreads: number;
    failedThreads: number;
    startedAt: string | null;
    error: string | null;
  },
  local: { inboxThreads: number; unprocessedInboxThreads: number },
): AnalysisProgressResponse {
  const status = isAnalysisStatus(input.status) ? input.status : "idle";
  const totalInboxThreads = status === "running" || status === "paused" || status === "error"
    ? input.totalThreads
    : local.inboxThreads;
  const analyzedInboxThreads = status === "running" || status === "paused" || status === "error"
    ? input.analyzedThreads
    : Math.max(0, local.inboxThreads - local.unprocessedInboxThreads);

  return {
    status,
    totalInboxThreads,
    analyzedInboxThreads,
    failedInboxThreads: input.failedThreads,
    remainingInboxThreads: local.unprocessedInboxThreads,
    startedAt: input.startedAt,
    error: input.error,
  };
}

async function buildProgressResponse(account: {
  id: string;
  lastFullSyncAt: string | null;
  lastIncrementalSyncAt: string | null;
  needsFullResync: boolean;
}): Promise<SyncProgressResponse> {
  const [local, fetchStates, analysisState] = await Promise.all([
    getGmailThreadStats(account.id),
    listFetchStates(account.id),
    getAnalysisState(account.id),
  ]);
  const fetch = {
    activeMode: null as "full" | "incremental" | null,
    full: emptyFetchProgress(),
    incremental: emptyFetchProgress(),
  };

  for (const state of fetchStates) {
    if (state.mode !== "full" && state.mode !== "incremental") continue;
    fetch[state.mode] = toFetchProgressResponse({
      status: state.status,
      totalThreads: state.totalThreads,
      fetchedThreads: state.fetchedThreads,
      failedThreads: state.failedThreads,
      startedAt: state.startedAt,
      error: state.lastError,
    });
    if (fetch[state.mode].status === "running") {
      fetch.activeMode = state.mode;
    }
  }

  const active = getActiveSync(account.id);
  if (active) {
    const progress = active.getProgress();
    const mode = progress.mode;
    if (mode === "full" || mode === "incremental") {
      fetch[mode] = toFetchProgressResponse({
        status: progress.status,
        totalThreads: progress.totalThreads,
        fetchedThreads: progress.fetchedThreads,
        failedThreads: progress.failedThreads,
        startedAt: progress.startedAt,
        error: progress.error,
      });
      fetch.activeMode = mode;
    }
  }

  let analysis = analysisState
    ? toAnalysisProgressResponse(
        {
          status: analysisState.status,
          totalThreads: analysisState.totalThreads,
          analyzedThreads: analysisState.analyzedThreads,
          failedThreads: analysisState.failedThreads,
          startedAt: analysisState.startedAt,
          error: analysisState.lastError,
        },
        local,
      )
    : emptyAnalysisProgress(local);

  const activeExtraction = getActiveGmailExtraction(account.id);
  if (activeExtraction) {
    const progress = activeExtraction.getProgress();
    analysis = toAnalysisProgressResponse(
      {
        status: progress.status,
        totalThreads: progress.totalThreads,
        analyzedThreads: progress.processedThreads,
        failedThreads: progress.failedThreads,
        startedAt: progress.startedAt,
        error: progress.error,
      },
      local,
    );
  }

  return {
    account: {
      hasCompletedFullSync: Boolean(account.lastFullSyncAt),
      hasCompletedIncrementalSync: Boolean(account.lastIncrementalSyncAt),
      needsFullResync: account.needsFullResync,
    },
    local,
    fetch,
    analysis,
  };
}

function isOperationStatus(value: string): value is OperationStatus {
  return (
    value === "idle"
    || value === "running"
    || value === "paused"
    || value === "interrupted"
    || value === "completed"
    || value === "error"
  );
}

function isAnalysisStatus(value: string): value is AnalysisProgressResponse["status"] {
  return (
    value === "idle"
    || value === "running"
    || value === "paused"
    || value === "completed"
    || value === "error"
  );
}

function parseWorkflowAgentConfig(value: string) {
  try {
    const parsed = piAgentConfigSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : piAgentConfigSchema.parse({});
  } catch {
    return piAgentConfigSchema.parse({});
  }
}

function parseDisabledToolNames(value: string) {
  try {
    const parsedJson = JSON.parse(value);
    if (!Array.isArray(parsedJson)) return [];
    return parsedJson.filter((toolName): toolName is typeof GMAIL_AGENT_TOOL_NAME_VALUES[number] =>
      gmailAgentToolNameSchema.safeParse(toolName).success
    );
  } catch {
    return [];
  }
}

function mapWorkflow(row: Awaited<ReturnType<typeof listGmailAgentWorkflows>>[number]) {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    enabled: row.enabled,
    trigger: row.trigger,
    prompt: row.prompt,
    agentConfig: parseWorkflowAgentConfig(row.agentConfig),
    disabledToolNames: parseDisabledToolNames(row.disabledToolNames),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const gmailSyncRouter = router({
  getAgentToolkit: publicProcedure.query(() => ({
    trigger: "incremental_sync" as const,
    tools: GMAIL_AGENT_TOOL_NAME_VALUES.map((name) => ({ name })),
  })),

  listAgentWorkflows: publicProcedure
    .input(z.object({ providerAccountId: z.string() }))
    .query(async ({ input }) => {
      const account = await getGmailAccount(input.providerAccountId);
      if (!account) return [];
      const workflows = await listGmailAgentWorkflows(account.id);
      return workflows.map(mapWorkflow);
    }),

  upsertAgentWorkflow: publicProcedure
    .input(
      z.object({
        providerAccountId: z.string(),
        workflow: gmailAgentWorkflowUpsertSchema,
      }),
    )
    .mutation(async ({ input }) => {
      const account = await getGmailAccount(input.providerAccountId);
      if (!account) {
        throw new Error("Gmail account has not been synced yet");
      }

      const workflow = input.workflow;
      const result = await upsertGmailAgentWorkflow(account.id, {
        id: workflow.id,
        name: workflow.name,
        enabled: workflow.enabled,
        prompt: workflow.prompt,
        agentConfig: JSON.stringify(workflow.agentConfig),
        disabledToolNames: JSON.stringify(workflow.disabledToolNames),
      });

      const workflows = await listGmailAgentWorkflows(account.id);
      const saved = workflows.find((row) => row.id === result.id);
      return saved ? mapWorkflow(saved) : { id: result.id };
    }),

  deleteAgentWorkflow: publicProcedure
    .input(z.object({ providerAccountId: z.string(), workflowId: z.string() }))
    .mutation(async ({ input }) => {
      const account = await getGmailAccount(input.providerAccountId);
      if (!account) return { deleted: false };
      await deleteGmailAgentWorkflow(account.id, input.workflowId);
      return { deleted: true };
    }),

  /**
   * Start a Gmail sync.
   */
  startSync: publicProcedure
    .input(
      z.object({
        providerAccountId: z.string(),
        accessToken: z.string().min(1),
        intent: z.enum(syncStartIntents).default("auto"),
      }),
    )
    .mutation(async ({ input }) => {
      const existingAccount = await getGmailAccount(
        input.providerAccountId,
      );
      let accountId = existingAccount?.id;
      let initialProfile: Awaited<ReturnType<typeof getProfile>> | null = null;

      if (!accountId) {
        const profile = await getProfile(input.accessToken);
        initialProfile = profile;
        accountId = (
          await upsertGmailAccount({
            email: profile.emailAddress,
            providerAccountId: input.providerAccountId,
            historyId: profile.historyId,
          })
        ).id;
      }
      if (getActiveGmailExtraction(accountId)) {
        throw new Error("Inbox analysis is in progress for this account");
      }

      const sync = await startSync(
        accountId,
        input.accessToken,
        input.intent,
        initialProfile,
      );
      const account = existingAccount ?? await getGmailAccount(input.providerAccountId);

      return {
        accountId,
        started: sync.started,
        progress: account ? await buildProgressResponse(account) : null,
      };
    }),

  /**
   * Start Gmail inbox analysis.
   */
  startExtraction: publicProcedure
    .input(z.object({ providerAccountId: z.string() }))
    .mutation(async ({ input }) => {
      const account = await getGmailAccount(input.providerAccountId);
      if (!account) {
        throw new Error("Gmail account has not been synced yet");
      }
      if (getActiveSync(account.id)) {
        throw new Error("Gmail sync is in progress for this account");
      }

      await startGmailExtraction(account.id);

      return {
        accountId: account.id,
        progress: await buildProgressResponse(account),
      };
    }),

  /**
   * Get current sync progress.
   */
  getSyncProgress: publicProcedure
    .input(z.object({ providerAccountId: z.string() }))
    .query(async ({ input }) => {
      const account = await getGmailAccount(input.providerAccountId);
      if (!account) return null;

      return buildProgressResponse(account);
    }),

  /**
   * Cancel a running sync.
   */
  cancelSync: publicProcedure
    .input(z.object({ providerAccountId: z.string() }))
    .mutation(async ({ input }) => {
      const account = await getGmailAccount(input.providerAccountId);
      if (!account) return { cancelled: false };
      if (getActiveSync(account.id)) {
        return { cancelled: await cancelSync(account.id) };
      }
      if (getActiveGmailExtraction(account.id)) {
        return { cancelled: await cancelGmailExtraction(account.id) };
      }
      return { cancelled: await cancelSync(account.id) };
    }),

});
