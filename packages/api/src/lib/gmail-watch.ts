import { createHash } from "node:crypto";

import {
  getGmailAccount,
  updateGmailWatchState,
  upsertGmailAccount,
} from "@g-spot/db/gmail";
import { env } from "@g-spot/env/server";

import { getProfile, watchMailbox } from "./gmail-client";
import { listStackGmailAccounts } from "./stack-client-api";

const WATCH_RENEWAL_WINDOW_MS = 24 * 60 * 60 * 1000;
const ENSURE_THROTTLE_MS = 6 * 60 * 60 * 1000;

type EnsureWatchResult = {
  checkedAccounts: number;
  renewedAccounts: number;
  skipped: boolean;
};

const lastEnsureByAuthRef = new Map<string, number>();
const inflightByAuthRef = new Map<string, Promise<EnsureWatchResult>>();

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function opaqueRef(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
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

  const authRef = opaqueRef(authHeader);
  const lastEnsureAt = lastEnsureByAuthRef.get(authRef);
  if (lastEnsureAt && Date.now() - lastEnsureAt < ENSURE_THROTTLE_MS) {
    return { checkedAccounts: 0, renewedAccounts: 0, skipped: true };
  }

  const existing = inflightByAuthRef.get(authRef);
  if (existing) {
    return existing;
  }

  const promise = ensureLocalGmailWatchesNow(authHeader, topicName)
    .then((result) => {
      lastEnsureByAuthRef.set(authRef, Date.now());
      return result;
    })
    .finally(() => {
      inflightByAuthRef.delete(authRef);
    });
  inflightByAuthRef.set(authRef, promise);
  return promise;
}

async function ensureLocalGmailWatchesNow(
  authHeader: string,
  topicName: string,
): Promise<EnsureWatchResult> {
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

      const watch = await watchMailbox(account.accessToken, {
        topicName,
      });
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
