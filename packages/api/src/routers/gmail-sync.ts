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
} from "@g-spot/types";

import { publicProcedure, router } from "../index";
import {
  cancelSync,
  getActiveSync,
  syncStartIntents,
  startSync,
} from "../lib/gmail";
import {
  cancelGmailExtraction,
  getActiveGmailExtraction,
  runExtraction,
} from "../lib/gmail";
import { getProfile } from "../lib/gmail";

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

type SyncStatus =
  | "idle"
  | "running"
  | "paused"
  | "interrupted"
  | "completed"
  | "error";

type ExtractionStatus = Exclude<SyncStatus, "interrupted">;

type SyncProgressResponse = {
  sync: {
    status: SyncStatus;
    mode: "full" | "incremental" | null;
    totalThreads: number;
    fetchedThreads: number;
    failedThreads: number;
    startedAt: string | null;
    error: string | null;
  };
  extraction: {
    status: ExtractionStatus;
    totalThreads: number;
    processedThreads: number;
    failedThreads: number;
    startedAt: string | null;
    error: string | null;
  };
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

function isSyncStatus(value: string): value is SyncStatus {
  return (
    value === "idle"
    || value === "running"
    || value === "paused"
    || value === "interrupted"
    || value === "completed"
    || value === "error"
  );
}

function isExtractionStatus(value: string): value is ExtractionStatus {
  return (
    value === "idle"
    || value === "running"
    || value === "paused"
    || value === "completed"
    || value === "error"
  );
}

function emptySync(): SyncProgressResponse["sync"] {
  return {
    status: "idle",
    mode: null,
    totalThreads: 0,
    fetchedThreads: 0,
    failedThreads: 0,
    startedAt: null,
    error: null,
  };
}

function emptyExtraction(local: {
  inboxThreads: number;
  unprocessedInboxThreads: number;
}): SyncProgressResponse["extraction"] {
  return {
    status: local.inboxThreads > 0 && local.unprocessedInboxThreads === 0
      ? "completed"
      : "idle",
    totalThreads: local.inboxThreads,
    processedThreads: Math.max(0, local.inboxThreads - local.unprocessedInboxThreads),
    failedThreads: 0,
    startedAt: null,
    error: null,
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

  let sync: SyncProgressResponse["sync"] = emptySync();

  // Pick the most recently active fetch state. Prefer running > paused/
  // interrupted > most-recent startedAt.
  const sortedStates = [...fetchStates].sort((a, b) => {
    const rank = (status: string) => {
      if (status === "running") return 0;
      if (status === "paused" || status === "interrupted") return 1;
      return 2;
    };
    const r = rank(a.status) - rank(b.status);
    if (r !== 0) return r;
    return (b.startedAt ?? "").localeCompare(a.startedAt ?? "");
  });
  const primaryState = sortedStates[0];
  if (primaryState && (primaryState.mode === "full" || primaryState.mode === "incremental")) {
    sync = {
      status: isSyncStatus(primaryState.status) ? primaryState.status : "idle",
      mode: primaryState.mode,
      totalThreads: primaryState.totalThreads,
      fetchedThreads: primaryState.fetchedThreads,
      failedThreads: primaryState.failedThreads,
      startedAt: primaryState.startedAt,
      error: primaryState.lastError,
    };
  }

  const active = getActiveSync(account.id);
  if (active) {
    const progress = active.getProgress();
    if (progress.mode === "full" || progress.mode === "incremental") {
      sync = {
        status: progress.status,
        mode: progress.mode,
        totalThreads: progress.totalThreads,
        fetchedThreads: progress.fetchedThreads,
        failedThreads: progress.failedThreads,
        startedAt: progress.startedAt,
        error: progress.error,
      };
    }
  }

  let extraction: SyncProgressResponse["extraction"] = analysisState
    ? {
        status: isExtractionStatus(analysisState.status) ? analysisState.status : "idle",
        totalThreads: analysisState.totalThreads,
        processedThreads: analysisState.analyzedThreads,
        failedThreads: analysisState.failedThreads,
        startedAt: analysisState.startedAt,
        error: analysisState.lastError,
      }
    : emptyExtraction(local);

  const activeExtraction = getActiveGmailExtraction(account.id);
  if (activeExtraction) {
    const progress = activeExtraction.getProgress();
    extraction = {
      status: progress.status,
      totalThreads: progress.totalThreads,
      processedThreads: progress.processedThreads,
      failedThreads: progress.failedThreads,
      startedAt: progress.startedAt,
      error: progress.error,
    };
  }

  return {
    sync,
    extraction,
    account: {
      hasCompletedFullSync: Boolean(account.lastFullSyncAt),
      hasCompletedIncrementalSync: Boolean(account.lastIncrementalSyncAt),
      needsFullResync: account.needsFullResync,
    },
    local,
  };
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
      const existingAccount = await getGmailAccount(input.providerAccountId);
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

      runExtraction({ accountId: account.id, mode: "all" });

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
