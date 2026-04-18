/**
 * Background memory maintenance using TanStack Pacer.
 *
 * - Decay tick: runs every 60 minutes, decays salience on all entities/observations,
 *   prunes dead nodes, decays edge weights, linear confidence decay.
 * - Uses Pacer's Throttler to guarantee non-overlapping execution.
 */

import { Throttler } from "@tanstack/pacer";

import { createCronJob, type ManagedCronJob } from "./cron";
import { decayTick } from "./memory";

const DECAY_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes
const DECAY_CRON = "@hourly";

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
    await decayTick();
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
// Global cron — catches users who haven't chatted recently
// ---------------------------------------------------------------------------

let decayCronJob: ManagedCronJob | null = null;

/**
 * Start the global decay cron. Call once at server startup.
 * Runs decay for all known users on the hourly schedule.
 */
export function startDecayCron(): void {
  if (decayCronJob) return;

  decayCronJob = createCronJob({
    name: "memory-cron",
    cron: DECAY_CRON,
    handler: async () => {
      for (const userId of userThrottlers.keys()) {
        getOrCreateThrottler(userId).maybeExecute();
      }
    },
  });
}

/**
 * Stop the global decay cron. Call on server shutdown.
 */
export function stopDecayCron(): void {
  decayCronJob?.stop();
  decayCronJob = null;
}

/**
 * Register a user so the global cron includes them even if they
 * haven't chatted in this server session.
 */
export function registerUserForDecay(userId: string): void {
  getOrCreateThrottler(userId);
}
