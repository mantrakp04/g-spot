/**
 * Gmail sync orchestrator.
 *
 *   - Bounded fetch concurrency via `p-limit`.
 *   - A single shared circuit breaker that pauses every worker on 429.
 *   - Coalesced progress writes (workers bump in-memory counters; a debounced
 *     flusher persists to `gmail_fetch_state`).
 *   - Streaming page-by-page enqueue: pages from `streamThreadIds` are fed
 *     into the pool as they arrive, so fetch starts before the full thread
 *     list is materialized.
 */

import pLimit from "p-limit";
import { env } from "@g-spot/env/server";

import {
  getFetchedGmailThreadIds,
  getFetchedInboxGmailThreadIds,
  getUnprocessedInboxGmailThreadIds,
  incrementFetchProgress,
  recordSyncFailure,
  resolveFailuresForThread,
  upsertFetchState,
} from "@g-spot/db/gmail";

import { GmailApiError } from "../errors";
import { getProfile } from "../api";
import type {
  SyncExecutionPlan,
  SyncMode,
  SyncProgress,
} from "./plan";
import { getScopedSyncResumeState } from "./plan";
import { resolveThreadIdsForMode, type SyncThreadResolution } from "./history";
import { fetchAndUpsertThread } from "./full";
import { applyCheckpoint } from "./checkpoint";

const FETCH_CONCURRENCY = env.GMAIL_SYNC_CONCURRENCY;
const MAX_CIRCUIT_BACKOFF_SEC = 600;
const PROGRESS_FLUSH_MS = 500;

type GmailProfile = Awaited<ReturnType<typeof getProfile>>;

type FetchStateWrite = Parameters<typeof upsertFetchState>[2];

class CircuitBreaker {
  private gate: Promise<void> = Promise.resolve();
  private gateResolve: (() => void) | null = null;
  private streak = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  isOpen(): boolean {
    return this.gateResolve !== null;
  }

  async waitClosed(): Promise<void> {
    await this.gate;
  }

  open(retryAfterSec: number, exact = false): void {
    if (this.isOpen()) return;
    this.streak += 1;
    const backoffSec = exact
      ? retryAfterSec
      : Math.min(
        retryAfterSec * 2 ** (this.streak - 1),
        MAX_CIRCUIT_BACKOFF_SEC,
      );
    this.gate = new Promise<void>((resolve) => {
      this.gateResolve = resolve;
    });
    this.timer = setTimeout(() => this.close(), backoffSec * 1000);
  }

  close(): void {
    if (!this.gateResolve) return;
    this.gateResolve();
    this.gateResolve = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  reset(): void {
    this.streak = 0;
    this.close();
  }
}

export class GmailSyncOrchestrator {
  private readonly limit = pLimit(FETCH_CONCURRENCY);
  private readonly circuit = new CircuitBreaker();
  private readonly accountId: string;
  private readonly token: string;
  private initialProfile: GmailProfile | null;
  private cancelled = false;
  private progress: SyncProgress;
  private extractableGmailThreadIds = new Set<string>();
  private inflight = 0;
  private drainResolve: (() => void) | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private dirtyFetched = 0;
  private dirtyFailed = 0;
  private currentMode: SyncMode | null = null;

  constructor(
    accountId: string,
    token: string,
    initialProfile: GmailProfile | null = null,
  ) {
    this.accountId = accountId;
    this.token = token;
    this.initialProfile = initialProfile;
    this.progress = freshProgress();
  }

  getProgress(): SyncProgress {
    return { ...this.progress };
  }

  cancel(): void {
    this.cancelled = true;
    this.circuit.close();
    this.progress.status = "paused";
    if (this.drainResolve) {
      const resolve = this.drainResolve;
      this.drainResolve = null;
      resolve();
    }
  }

  async startSync(plan: SyncExecutionPlan): Promise<void> {
    await this.beginRun(plan);

    let resolution: SyncThreadResolution | null = null;
    try {
      resolution = await resolveThreadIdsForMode(
        this.token,
        this.accountId,
        plan.scopeStrategy,
        this.initialProfile,
      );
      this.initialProfile = null;
      if (this.cancelled) return;

      await this.runScopedFetch(resolution);
      if (this.cancelled) return;

      await applyCheckpoint({
        accountId: this.accountId,
        token: this.token,
        plan,
        resolution,
        failedThreads: this.progress.failedThreads,
      });

      await this.markCompleted();
    } catch (error) {
      if (this.cancelled) return;
      const msg = error instanceof Error ? error.message : String(error);
      await this.markErrored(msg);
      console.error("[gmail-sync] Sync failed:", error);
    } finally {
      await this.flushProgressNow().catch(() => {});
      if (this.cancelled) {
        await this.markPaused().catch((err) =>
          console.error("[gmail-sync] Failed to persist paused state:", err)
        );
      }
    }

    if (resolution && !this.cancelled && this.progress.status === "completed") {
      await dispatchPostSync({
        accountId: this.accountId,
        token: this.token,
        resolution,
        extractableGmailThreadIds: [...this.extractableGmailThreadIds],
      }).catch((err) => {
        console.error("[gmail-sync] Post-sync dispatch failed:", err);
      });
    }
  }

  private async runScopedFetch(resolution: SyncThreadResolution): Promise<void> {
    const mode = resolution.completedMode;

    // Pre-load resume sets once for full mode; incremental refetches everything.
    const alreadyFetched = mode === "full"
      ? await getFetchedGmailThreadIds(this.accountId)
      : new Set<string>();
    const alreadyFetchedInbox = mode === "full"
      ? await getFetchedInboxGmailThreadIds(this.accountId)
      : new Set<string>();
    const unprocessedAll = mode === "full"
      ? await getUnprocessedInboxGmailThreadIds(this.accountId)
      : [];

    const allThreadIds: string[] = [];

    for await (const page of resolution.threadIdStream) {
      if (this.cancelled) break;
      allThreadIds.push(...page);
      const scope = getScopedSyncResumeState(
        allThreadIds,
        alreadyFetched,
        alreadyFetchedInbox,
        unprocessedAll,
        mode,
      );
      // Update bootstrap counters as pages arrive.
      this.progress.totalThreads = scope.totalThreads;
      this.progress.processableThreads = scope.processableThreads;
      this.progress.processedThreads = scope.processedThreads;
      this.progress.fetchedThreads = scope.fetchedInScope.size;
      this.scheduleProgressFlush();

      const newToFetch = page.filter((id) =>
        mode === "incremental" ? true : !scope.fetchedInScope.has(id),
      );
      this.enqueueFetchItems(newToFetch);
    }

    await this.persistFetchState({ status: "running" });
    await this.waitForCompletion();
  }

  private enqueueFetchItems(threadIds: string[]): void {
    for (const gmailThreadId of threadIds) {
      if (this.cancelled) break;
      this.inflight += 1;
      void this.limit(() => this.fetchOne(gmailThreadId))
        .finally(() => {
          this.inflight -= 1;
          if (this.inflight === 0 && this.drainResolve) {
            const resolve = this.drainResolve;
            this.drainResolve = null;
            resolve();
          }
        });
    }
  }

  private async fetchOne(gmailThreadId: string): Promise<void> {
    if (this.cancelled) return;
    await this.circuit.waitClosed();
    if (this.cancelled) return;

    try {
      const result = await fetchAndUpsertThread(
        this.accountId,
        this.token,
        gmailThreadId,
      );
      this.handleFetchSuccess(gmailThreadId, result.shouldExtract);
    } catch (error) {
      if (error instanceof GmailApiError && error.isRateLimit) {
        this.circuit.open(error.retryAfter ?? 60, error.retryAfter !== undefined);
        // Re-enqueue for after the backoff window.
        this.enqueueFetchItems([gmailThreadId]);
        return;
      }
      this.handleFetchError(gmailThreadId, error);
    }
  }

  private handleFetchSuccess(gmailThreadId: string, shouldExtract: boolean): void {
    this.circuit.reset();
    resolveFailuresForThread(this.accountId, gmailThreadId).catch((err) => {
      console.error("[gmail-sync] Failed to resolve fetch failure:", err);
    });
    this.progress.fetchedThreads += 1;
    this.dirtyFetched += 1;
    if (shouldExtract) {
      this.extractableGmailThreadIds.add(gmailThreadId);
      this.progress.processableThreads += 1;
    }
    this.scheduleProgressFlush();
  }

  private handleFetchError(gmailThreadId: string, error: unknown): void {
    if (this.cancelled) return;

    recordSyncFailure(this.accountId, {
      gmailThreadId,
      stage: "fetch",
      errorMessage: error instanceof Error ? error.message : String(error),
      errorCode: error instanceof GmailApiError
        ? error.reason ?? String(error.status)
        : undefined,
    }).catch((err) => {
      console.error("[gmail-sync] Failed to record fetch failure:", err);
    });
    this.progress.failedThreads += 1;
    this.dirtyFailed += 1;
    this.scheduleProgressFlush();
    console.error(
      `[gmail-sync] Fetch skipped for ${gmailThreadId}:`,
      error instanceof Error ? error.message : error,
    );
  }

  // ----- Lifecycle / progress -----

  private async beginRun(plan: SyncExecutionPlan): Promise<void> {
    this.cancelled = false;
    this.circuit.reset();
    this.extractableGmailThreadIds.clear();
    this.dirtyFetched = 0;
    this.dirtyFailed = 0;
    this.currentMode = plan.mode;

    this.progress = {
      status: "running",
      mode: plan.mode,
      totalThreads: plan.bootstrapProgress?.totalThreads ?? 0,
      fetchedThreads: plan.bootstrapProgress?.fetchedThreads ?? 0,
      processableThreads: plan.bootstrapProgress?.processableThreads ?? 0,
      processedThreads: plan.bootstrapProgress?.processedThreads ?? 0,
      failedThreads: plan.bootstrapProgress?.failedThreads ?? 0,
      startedAt: new Date().toISOString(),
      error: null,
    };

    await this.persistFetchState({
      completedAt: null,
      lastError: null,
      status: "running",
    });
  }

  private scheduleProgressFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushProgressNow().catch((err) =>
        console.error(
          `[gmail-sync] Failed to persist progress for ${this.accountId}:`,
          err,
        )
      );
    }, PROGRESS_FLUSH_MS);
  }

  private async flushProgressNow(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const fetchedDelta = this.dirtyFetched;
    const failedDelta = this.dirtyFailed;
    this.dirtyFetched = 0;
    this.dirtyFailed = 0;
    if (!this.currentMode) return;

    const ops: Array<Promise<void>> = [];
    if (fetchedDelta > 0) {
      ops.push(
        incrementFetchProgress(
          this.accountId,
          this.currentMode,
          "fetchedThreads",
          fetchedDelta,
        ),
      );
    }
    if (failedDelta > 0) {
      ops.push(
        incrementFetchProgress(
          this.accountId,
          this.currentMode,
          "failedThreads",
          failedDelta,
        ),
      );
    }
    if (ops.length > 0) await Promise.all(ops);
  }

  private async waitForCompletion(): Promise<void> {
    if (this.cancelled || this.inflight === 0) return;
    await new Promise<void>((resolve) => {
      this.drainResolve = resolve;
    });
  }

  private async persistFetchState(
    overrides: FetchStateWrite = {},
  ): Promise<void> {
    if (!this.progress.mode) {
      throw new Error("Cannot persist Gmail fetch state without a sync mode");
    }
    await upsertFetchState(this.accountId, this.progress.mode, {
      status: this.progress.status,
      totalThreads: this.progress.totalThreads,
      fetchedThreads: this.progress.fetchedThreads,
      failedThreads: this.progress.failedThreads,
      lastError: this.progress.error,
      ...(this.progress.startedAt ? { startedAt: this.progress.startedAt } : {}),
      ...overrides,
    });
  }

  private async markCompleted(): Promise<void> {
    this.progress.status = "completed";
    this.progress.error = null;
    await this.persistFetchState({
      completedAt: new Date().toISOString(),
      lastError: null,
      status: "completed",
    });
  }

  private async markPaused(): Promise<void> {
    this.progress.status = "paused";
    this.progress.error = null;
    await this.persistFetchState({
      completedAt: null,
      lastError: null,
      status: "paused",
    });
  }

  private async markErrored(message: string): Promise<void> {
    this.progress.status = "error";
    this.progress.error = message;
    await this.persistFetchState({
      completedAt: null,
      lastError: message,
      status: "error",
    });
  }
}

function freshProgress(): SyncProgress {
  return {
    status: "idle",
    mode: null,
    totalThreads: 0,
    fetchedThreads: 0,
    processableThreads: 0,
    processedThreads: 0,
    failedThreads: 0,
    startedAt: null,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Post-sync side effects (extraction + agent workflows)
// ---------------------------------------------------------------------------

interface PostSyncDispatchInput {
  accountId: string;
  token: string;
  resolution: SyncThreadResolution;
  extractableGmailThreadIds: string[];
}

async function dispatchPostSync(input: PostSyncDispatchInput): Promise<void> {
  const { accountId, token, resolution, extractableGmailThreadIds } = input;

  // Late-import to avoid load-time cycles between extraction and sync modules.
  const [{ runExtraction }, { triggerIncrementalGmailAgentWorkflows }] =
    await Promise.all([
      import("../extraction"),
      import("../../gmail-agent-workflows"),
    ]);

  if (
    resolution.completedMode === "incremental"
    && extractableGmailThreadIds.length > 0
  ) {
    runExtraction({ accountId, mode: "scoped", gmailThreadIds: extractableGmailThreadIds });
  }

  if (resolution.completedMode === "incremental") {
    triggerIncrementalGmailAgentWorkflows({
      accountId,
      token,
      changedGmailThreadIds: resolution.knownThreadIds,
      extractableGmailThreadIds,
    });
  }
}
