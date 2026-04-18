/**
 * Global Gmail API rate limiter.
 *
 * Token-bucket shared across every orchestrator, worker, and ad-hoc call that
 * goes through `fetchGmailJson`. Enforces `GMAIL_RATE_LIMIT_RPS` driver-wide so
 * N concurrent account syncs can't collectively exceed Gmail's quota.
 */

import { env } from "@g-spot/env/server";

const RPS = env.GMAIL_RATE_LIMIT_RPS;
const CAPACITY = RPS;

let tokens = CAPACITY;
let lastRefill = Date.now();
let drainScheduled = false;
const waiters: Array<() => void> = [];

function refill(): void {
  const now = Date.now();
  const elapsed = (now - lastRefill) / 1000;
  if (elapsed <= 0) return;
  tokens = Math.min(CAPACITY, tokens + elapsed * RPS);
  lastRefill = now;
}

function drain(): void {
  drainScheduled = false;
  refill();

  while (waiters.length > 0 && tokens >= 1) {
    tokens -= 1;
    const next = waiters.shift()!;
    next();
  }

  if (waiters.length > 0 && !drainScheduled) {
    drainScheduled = true;
    const needed = 1 - tokens;
    const waitMs = Math.max(10, Math.ceil((needed / RPS) * 1000));
    setTimeout(drain, waitMs);
  }
}

/**
 * Wait until a token is available, then consume it. FIFO — new callers queue
 * behind existing waiters even if tokens are free, for fairness.
 */
export function acquireGmailToken(): Promise<void> {
  refill();
  if (waiters.length === 0 && tokens >= 1) {
    tokens -= 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiters.push(resolve);
    if (!drainScheduled) {
      drainScheduled = true;
      setTimeout(drain, 0);
    }
  });
}
