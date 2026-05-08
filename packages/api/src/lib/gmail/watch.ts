/**
 * Gmail watch maintenance.
 *
 * `ensureLocalGmailWatches` walks every Stack-known Gmail account, upserts
 * the local row, and (re)issues a Pub/Sub watch when the existing one is
 * absent or close to expiry.
 *
 * `startGmailWatchDaemon` parks a single setInterval timer at module level.
 * Callers that have a fresh Stack auth header (heartbeat handler, relay
 * connect) push it in via this function — the daemon keeps the latest header
 * and runs a pass every {@link WATCH_DAEMON_INTERVAL_MS}. A pass already in
 * flight short-circuits; a token-only update is cheap.
 */

import {
  getGmailAccount,
  updateGmailWatchState,
  upsertGmailAccount,
} from "@g-spot/db/gmail";
import { env } from "@g-spot/env/server";

import { getProfile, watchMailbox } from "./api";
import { listStackGmailAccounts } from "../stack-client-api";

const WATCH_RENEWAL_WINDOW_MS = 24 * 60 * 60 * 1000;
const WATCH_DAEMON_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type EnsureWatchResult = {
  checkedAccounts: number;
  renewedAccounts: number;
  skipped: boolean;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function shouldRenewWatch(watchExpiration: number | null): boolean {
  return !watchExpiration || watchExpiration <= Date.now() + WATCH_RENEWAL_WINDOW_MS;
}

export async function ensureLocalGmailWatches(
  authHeader: string,
): Promise<EnsureWatchResult> {
  if (!env.GMAIL_PUBSUB_TOPIC_NAME) {
    return { checkedAccounts: 0, renewedAccounts: 0, skipped: true };
  }
  const topicName = env.GMAIL_PUBSUB_TOPIC_NAME;

  let accounts;
  try {
    accounts = await listStackGmailAccounts(authHeader);
  } catch {
    return { checkedAccounts: 0, renewedAccounts: 0, skipped: true };
  }

  if (!accounts) {
    return { checkedAccounts: 0, renewedAccounts: 0, skipped: true };
  }

  let checkedAccounts = 0;
  let renewedAccounts = 0;

  for (const account of accounts) {
    try {
      const existingAccount = await getGmailAccount(account.providerAccountId);
      checkedAccounts += 1;

      if (existingAccount && !shouldRenewWatch(existingAccount.watchExpiration)) {
        continue;
      }

      const profile = await getProfile(account.accessToken);
      const email = normalizeEmail(profile.emailAddress);
      const accountId = (
        await upsertGmailAccount({
          email,
          providerAccountId: account.providerAccountId,
          ...(existingAccount ? {} : { historyId: profile.historyId }),
        })
      ).id;

      const watch = await watchMailbox(account.accessToken, { topicName });
      await updateGmailWatchState(accountId, {
        watchExpiration: Number(watch.expiration),
        lastWatchHistoryId: watch.historyId,
      });
      renewedAccounts += 1;
    } catch {
      // skip account on watch failure
    }
  }

  return { checkedAccounts, renewedAccounts, skipped: false };
}

let watchDaemonTimer: NodeJS.Timeout | null = null;
let latestAuthHeader: string | null = null;
let watchDaemonInflight: Promise<void> | null = null;

async function runWatchDaemonPass(): Promise<void> {
  if (!latestAuthHeader) return;
  if (watchDaemonInflight) return;
  const authHeader = latestAuthHeader;
  watchDaemonInflight = ensureLocalGmailWatches(authHeader)
    .then(() => undefined)
    .catch((err) => {
      console.error("[gmail-watch] daemon pass failed:", err);
    })
    .finally(() => {
      watchDaemonInflight = null;
    });
  await watchDaemonInflight;
}

/**
 * Update the daemon's auth header and ensure the interval is running.
 *
 * Safe to call repeatedly — the timer is module-level and idempotent. The
 * first call kicks off an immediate pass; subsequent calls just refresh the
 * header for the next pass.
 */
export function startGmailWatchDaemon(authHeader: string): void {
  latestAuthHeader = authHeader;
  if (watchDaemonTimer) return;
  void runWatchDaemonPass();
  watchDaemonTimer = setInterval(() => {
    void runWatchDaemonPass();
  }, WATCH_DAEMON_INTERVAL_MS);
}

export function stopGmailWatchDaemon(): void {
  if (watchDaemonTimer) {
    clearInterval(watchDaemonTimer);
    watchDaemonTimer = null;
  }
  latestAuthHeader = null;
}
