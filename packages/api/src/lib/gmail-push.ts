import {
  getGmailAccountById,
  listGmailAccountsByEmail,
  recordGmailPushNotification,
  upsertSyncState,
} from "@g-spot/db/gmail";

import { getActiveSync, runAfterActiveGmailSync, startSync } from "./gmail-sync";
import type { StackAuthHeaders } from "./stack-server";
import { getStackConnectedAccountAccessToken } from "./stack-server";

export type GmailPushNotification = {
  emailAddress: string;
  historyId: string;
};

function compareHistoryIds(a: string, b: string): number {
  try {
    const left = BigInt(a);
    const right = BigInt(b);
    if (left === right) return 0;
    return left > right ? 1 : -1;
  } catch {
    if (a === b) return 0;
    return a > b ? 1 : -1;
  }
}

const pendingPushSyncs = new Map<string, { authHeaders: StackAuthHeaders }>();

async function triggerSyncFromNotification(account: {
  id: string;
  providerAccountId: string;
  email: string;
  historyId: string | null;
  needsFullResync: boolean;
}, authHeaders: StackAuthHeaders) {
  if (getActiveSync(account.id)) {
    pendingPushSyncs.set(account.id, { authHeaders });
    const scheduled = runAfterActiveGmailSync(account.id, () =>
      flushPendingPushSync(account.id)
    );
    if (!scheduled) {
      await flushPendingPushSync(account.id);
    }
    return;
  }

  await startPushSync(account, authHeaders);
}

async function startPushSync(account: {
  id: string;
  providerAccountId: string;
  email: string;
}, authHeaders: StackAuthHeaders) {
  try {
    const accessToken = await getStackConnectedAccountAccessToken(
      authHeaders,
      "google",
      account.providerAccountId,
    );

    await startSync(account.id, accessToken, "push");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await upsertSyncState(account.id, {
      status: "error",
      lastError: message,
    });
    console.error(
      `[gmail-push] Failed to start sync for ${account.email}:`,
      error,
    );
  }
}

async function flushPendingPushSync(accountId: string): Promise<void> {
  const pending = pendingPushSyncs.get(accountId);
  if (!pending) return;

  const account = await getGmailAccountById(accountId);
  if (!account) {
    pendingPushSyncs.delete(accountId);
    return;
  }

  if (!account.needsFullResync && account.historyId && account.lastNotificationHistoryId) {
    if (compareHistoryIds(account.lastNotificationHistoryId, account.historyId) <= 0) {
      pendingPushSyncs.delete(accountId);
      return;
    }
  }

  pendingPushSyncs.delete(accountId);
  if (getActiveSync(account.id)) {
    pendingPushSyncs.set(account.id, pending);
    return;
  }

  await startPushSync(account, pending.authHeaders);
}

export async function processGmailPushNotification(
  payload: GmailPushNotification,
  receivedAt: string,
  context: {
    authHeaders: StackAuthHeaders;
  },
): Promise<void> {
  const accounts = await listGmailAccountsByEmail(payload.emailAddress);
  if (accounts.length === 0) {
    return;
  }

  for (const account of accounts) {
    await recordGmailPushNotification(account.id, payload.historyId, receivedAt);

    if (account.needsFullResync || !account.historyId) {
      await triggerSyncFromNotification(account, context.authHeaders);
      continue;
    }

    if (compareHistoryIds(payload.historyId, account.historyId) <= 0) {
      continue;
    }

    await triggerSyncFromNotification(account, context.authHeaders);
  }
}
