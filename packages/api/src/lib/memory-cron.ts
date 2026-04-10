/**
 * Background memory maintenance using TanStack Pacer.
 *
 * - Decay tick: runs every 60 minutes, decays salience on all entities/observations,
 *   prunes dead nodes, decays edge weights, linear confidence decay.
 * - Uses Pacer's Throttler to guarantee non-overlapping execution.
 */

import { Throttler } from "@tanstack/pacer";

import { decayTick } from "./memory";

const DECAY_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes

/**
 * Per-user decay throttlers. Each user gets their own throttler so one
 * user's slow decay doesn't block another's.
 */
const userThrottlers = new Map<string, Throttler<() => void>>();

function getOrCreateThrottler(userId: string): Throttler<() => void> {
  let throttler = userThrottlers.get(userId);
  if (!throttler) {
    throttler = new Throttler<() => void>(
      () => {
        runDecayForUser(userId);
      },
      {
        wait: DECAY_INTERVAL_MS,
        leading: true,  // run immediately on first call
        trailing: false,
      },
    );
    userThrottlers.set(userId, throttler);
  }
  return throttler;
}

async function runDecayForUser(userId: string): Promise<void> {
  try {
    const stats = await decayTick(userId);
    if (stats.decayed > 0 || stats.pruned > 0 || stats.edgesPruned > 0) {
      console.log(
        `[memory-cron] Decay tick for ${userId}: ${stats.decayed} decayed, ${stats.pruned} pruned, ${stats.edgesPruned} edges pruned`,
      );
    }
  } catch (error) {
    console.error(`[memory-cron] Decay tick failed for ${userId}:`, error);
  }
}

/**
 * Trigger a decay tick for a user. The Throttler guarantees at most one
 * execution per DECAY_INTERVAL_MS, so calling this frequently is safe.
 *
 * Call this after every chat turn or memory ingest — the throttler will
 * debounce it to once per hour.
 */
export function scheduleDecayTick(userId: string): void {
  getOrCreateThrottler(userId).maybeExecute();
}

// ---------------------------------------------------------------------------
// Global interval — catches users who haven't chatted recently
// ---------------------------------------------------------------------------

let globalIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Start the global decay interval. Call once at server startup.
 * Runs decay for ALL known users every DECAY_INTERVAL_MS.
 */
export function startDecayCron(): void {
  if (globalIntervalId) return;

  globalIntervalId = setInterval(() => {
    for (const userId of userThrottlers.keys()) {
      getOrCreateThrottler(userId).maybeExecute();
    }
  }, DECAY_INTERVAL_MS);

  console.log("[memory-cron] Decay cron started (interval: 60min)");
}

/**
 * Stop the global decay interval. Call on server shutdown.
 */
export function stopDecayCron(): void {
  if (globalIntervalId) {
    clearInterval(globalIntervalId);
    globalIntervalId = null;
  }
}

/**
 * Register a user so the global cron includes them even if they
 * haven't chatted in this server session.
 */
export function registerUserForDecay(userId: string): void {
  getOrCreateThrottler(userId);
}
