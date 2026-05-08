import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "../index";
import {
  gmailAgentWorkflows,
  gmailAnalysisState,
  gmailFetchState,
  gmailSyncFailures,
  gmailThreadLabels,
  gmailThreads,
} from "../schema";
import type {
  GmailAgentWorkflowRow,
  GmailAnalysisStateRow,
  GmailFetchStateRow,
  GmailSyncFailureRow,
} from "../schema/gmail";

// ---------------------------------------------------------------------------
// Fetch state
// ---------------------------------------------------------------------------

export async function getFetchState(
  accountId: string,
  mode: "full" | "incremental",
): Promise<GmailFetchStateRow | null> {
  const [row] = await db
    .select()
    .from(gmailFetchState)
    .where(
      and(
        eq(gmailFetchState.accountId, accountId),
        eq(gmailFetchState.mode, mode),
      ),
    );
  return row ?? null;
}

export async function listFetchStates(
  accountId: string,
): Promise<GmailFetchStateRow[]> {
  return db
    .select()
    .from(gmailFetchState)
    .where(eq(gmailFetchState.accountId, accountId));
}

export async function getRunningFetchStates(): Promise<GmailFetchStateRow[]> {
  return db
    .select()
    .from(gmailFetchState)
    .where(
      or(
        eq(gmailFetchState.status, "running"),
        eq(gmailFetchState.status, "paused"),
        eq(gmailFetchState.status, "interrupted"),
      ),
    );
}

export async function upsertFetchState(
  accountId: string,
  mode: "full" | "incremental",
  data: Partial<{
    status: string;
    totalThreads: number;
    fetchedThreads: number;
    failedThreads: number;
    startedAt: string;
    completedAt: string | null;
    lastError: string | null;
  }>,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(gmailFetchState)
    .values({
      id: nanoid(),
      accountId,
      mode,
      status: data.status ?? "idle",
      totalThreads: data.totalThreads ?? 0,
      fetchedThreads: data.fetchedThreads ?? 0,
      failedThreads: data.failedThreads ?? 0,
      startedAt: data.startedAt ?? null,
      completedAt: data.completedAt ?? null,
      lastError: data.lastError ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [gmailFetchState.accountId, gmailFetchState.mode],
      set: {
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.totalThreads !== undefined
          ? { totalThreads: data.totalThreads }
          : {}),
        ...(data.fetchedThreads !== undefined
          ? { fetchedThreads: data.fetchedThreads }
          : {}),
        ...(data.failedThreads !== undefined
          ? { failedThreads: data.failedThreads }
          : {}),
        ...(data.startedAt !== undefined
          ? { startedAt: data.startedAt }
          : {}),
        ...(data.completedAt !== undefined
          ? { completedAt: data.completedAt }
          : {}),
        ...(data.lastError !== undefined ? { lastError: data.lastError } : {}),
        updatedAt: now,
      },
    });
}

export async function incrementFetchProgress(
  accountId: string,
  mode: "full" | "incremental",
  field: "fetchedThreads" | "failedThreads",
  amount = 1,
): Promise<void> {
  const col = gmailFetchState[field];
  await db
    .update(gmailFetchState)
    .set({
      [field]: sql`${col} + ${amount}`,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(gmailFetchState.accountId, accountId),
        eq(gmailFetchState.mode, mode),
      ),
    );
}

// ---------------------------------------------------------------------------
// Analysis state
// ---------------------------------------------------------------------------

export async function getAnalysisState(
  accountId: string,
): Promise<GmailAnalysisStateRow | null> {
  const [row] = await db
    .select()
    .from(gmailAnalysisState)
    .where(eq(gmailAnalysisState.accountId, accountId));
  return row ?? null;
}

export async function upsertAnalysisState(
  accountId: string,
  data: Partial<{
    status: string;
    totalThreads: number;
    analyzedThreads: number;
    failedThreads: number;
    startedAt: string;
    completedAt: string | null;
    lastError: string | null;
  }>,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(gmailAnalysisState)
    .values({
      id: nanoid(),
      accountId,
      status: data.status ?? "idle",
      totalThreads: data.totalThreads ?? 0,
      analyzedThreads: data.analyzedThreads ?? 0,
      failedThreads: data.failedThreads ?? 0,
      startedAt: data.startedAt ?? null,
      completedAt: data.completedAt ?? null,
      lastError: data.lastError ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: gmailAnalysisState.accountId,
      set: {
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.totalThreads !== undefined
          ? { totalThreads: data.totalThreads }
          : {}),
        ...(data.analyzedThreads !== undefined
          ? { analyzedThreads: data.analyzedThreads }
          : {}),
        ...(data.failedThreads !== undefined
          ? { failedThreads: data.failedThreads }
          : {}),
        ...(data.startedAt !== undefined
          ? { startedAt: data.startedAt }
          : {}),
        ...(data.completedAt !== undefined
          ? { completedAt: data.completedAt }
          : {}),
        ...(data.lastError !== undefined ? { lastError: data.lastError } : {}),
        updatedAt: now,
      },
    });
}

export async function incrementAnalysisProgress(
  accountId: string,
  field: "analyzedThreads" | "failedThreads",
  amount = 1,
): Promise<void> {
  const col = gmailAnalysisState[field];
  await db
    .update(gmailAnalysisState)
    .set({
      [field]: sql`${col} + ${amount}`,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(gmailAnalysisState.accountId, accountId));
}

// ---------------------------------------------------------------------------
// Sync failures (dead-letter queue)
// ---------------------------------------------------------------------------

const HAS_INBOX_FOR_FAILURE = sql`EXISTS (
  SELECT 1 FROM ${gmailThreadLabels}
  INNER JOIN ${gmailThreads} ON ${gmailThreads.id} = ${gmailThreadLabels.threadId}
  WHERE ${gmailThreads.accountId} = ${gmailSyncFailures.accountId}
    AND ${gmailThreads.gmailThreadId} = ${gmailSyncFailures.gmailThreadId}
    AND ${gmailThreadLabels.label} = 'INBOX'
)`;

export async function recordSyncFailure(
  accountId: string,
  data: {
    gmailThreadId: string;
    stage: string;
    errorMessage: string;
    errorCode?: string;
  },
): Promise<boolean> {
  const now = new Date().toISOString();

  const [existing] = await db
    .select()
    .from(gmailSyncFailures)
    .where(
      and(
        eq(gmailSyncFailures.accountId, accountId),
        eq(gmailSyncFailures.gmailThreadId, data.gmailThreadId),
        isNull(gmailSyncFailures.resolvedAt),
      ),
    );

  if (existing) {
    await db
      .update(gmailSyncFailures)
      .set({
        stage: data.stage,
        errorMessage: data.errorMessage,
        errorCode: data.errorCode ?? null,
        attempts: sql`${gmailSyncFailures.attempts} + 1`,
        lastAttemptAt: now,
      })
      .where(eq(gmailSyncFailures.id, existing.id));
    return false;
  }

  await db.insert(gmailSyncFailures).values({
    id: nanoid(),
    accountId,
    gmailThreadId: data.gmailThreadId,
    stage: data.stage,
    errorMessage: data.errorMessage,
    errorCode: data.errorCode ?? null,
    attempts: 1,
    lastAttemptAt: now,
    createdAt: now,
  });
  return true;
}

export async function getRetryableSyncFailures(
  accountId: string,
): Promise<GmailSyncFailureRow[]> {
  return db
    .select()
    .from(gmailSyncFailures)
    .where(
      and(
        eq(gmailSyncFailures.accountId, accountId),
        isNull(gmailSyncFailures.resolvedAt),
        or(eq(gmailSyncFailures.stage, "fetch"), HAS_INBOX_FOR_FAILURE),
      ),
    )
    .orderBy(desc(gmailSyncFailures.lastAttemptAt));
}

export async function resolveFailure(failureId: string): Promise<void> {
  await db
    .update(gmailSyncFailures)
    .set({ resolvedAt: new Date().toISOString() })
    .where(eq(gmailSyncFailures.id, failureId));
}

export async function resolveFailuresForThread(
  accountId: string,
  gmailThreadId: string,
): Promise<number> {
  const unresolved = await db
    .select({ id: gmailSyncFailures.id })
    .from(gmailSyncFailures)
    .where(
      and(
        eq(gmailSyncFailures.accountId, accountId),
        eq(gmailSyncFailures.gmailThreadId, gmailThreadId),
        isNull(gmailSyncFailures.resolvedAt),
      ),
    );

  if (unresolved.length === 0) return 0;

  await db
    .update(gmailSyncFailures)
    .set({ resolvedAt: new Date().toISOString() })
    .where(
      inArray(
        gmailSyncFailures.id,
        unresolved.map((r) => r.id),
      ),
    );

  return unresolved.length;
}

export async function getRetryableFailureThreadIds(
  accountId: string,
): Promise<string[]> {
  const rows = await db
    .select({ gmailThreadId: gmailSyncFailures.gmailThreadId })
    .from(gmailSyncFailures)
    .where(
      and(
        eq(gmailSyncFailures.accountId, accountId),
        isNull(gmailSyncFailures.resolvedAt),
        or(eq(gmailSyncFailures.stage, "fetch"), HAS_INBOX_FOR_FAILURE),
      ),
    );
  return Array.from(new Set(rows.map((r) => r.gmailThreadId)));
}

export async function getFailuresByIds(
  failureIds: string[],
): Promise<GmailSyncFailureRow[]> {
  if (failureIds.length === 0) return [];
  return db
    .select()
    .from(gmailSyncFailures)
    .where(
      and(
        inArray(gmailSyncFailures.id, failureIds),
        isNull(gmailSyncFailures.resolvedAt),
      ),
    );
}

// ---------------------------------------------------------------------------
// Agent workflows
// ---------------------------------------------------------------------------

export async function listGmailAgentWorkflows(
  accountId: string,
): Promise<GmailAgentWorkflowRow[]> {
  return db
    .select()
    .from(gmailAgentWorkflows)
    .where(eq(gmailAgentWorkflows.accountId, accountId))
    .orderBy(asc(gmailAgentWorkflows.createdAt));
}

export async function listEnabledIncrementalGmailAgentWorkflows(
  accountId: string,
): Promise<GmailAgentWorkflowRow[]> {
  return db
    .select()
    .from(gmailAgentWorkflows)
    .where(
      and(
        eq(gmailAgentWorkflows.accountId, accountId),
        eq(gmailAgentWorkflows.enabled, true),
        eq(gmailAgentWorkflows.trigger, "incremental_sync"),
      ),
    )
    .orderBy(asc(gmailAgentWorkflows.createdAt));
}

export async function upsertGmailAgentWorkflow(
  accountId: string,
  input: {
    id?: string;
    name: string;
    enabled: boolean;
    prompt: string;
    disabledToolNames?: string;
  },
): Promise<{ id: string }> {
  const now = new Date().toISOString();

  if (input.id) {
    await db
      .update(gmailAgentWorkflows)
      .set({
        name: input.name,
        enabled: input.enabled,
        prompt: input.prompt,
        ...(input.disabledToolNames !== undefined
          ? { disabledToolNames: input.disabledToolNames }
          : {}),
        trigger: "incremental_sync",
        updatedAt: now,
      })
      .where(
        and(
          eq(gmailAgentWorkflows.id, input.id),
          eq(gmailAgentWorkflows.accountId, accountId),
        ),
      );
    return { id: input.id };
  }

  const id = nanoid();
  await db.insert(gmailAgentWorkflows).values({
    id,
    accountId,
    name: input.name,
    enabled: input.enabled,
    trigger: "incremental_sync",
    prompt: input.prompt,
    disabledToolNames: input.disabledToolNames ?? "[]",
    createdAt: now,
    updatedAt: now,
  });
  return { id };
}

export async function deleteGmailAgentWorkflow(
  accountId: string,
  workflowId: string,
): Promise<void> {
  await db
    .delete(gmailAgentWorkflows)
    .where(
      and(
        eq(gmailAgentWorkflows.accountId, accountId),
        eq(gmailAgentWorkflows.id, workflowId),
      ),
    );
}
