/**
 * Gmail push notification handler.
 *
 * Records a single atomic update per account so concurrent push events from
 * the relay can't lose a historyId. Sync scheduling happens elsewhere (the
 * relay-client uses the recorded `pendingHistoryId` to decide what to fetch).
 */

import {
  listGmailAccountsByEmail,
  recordGmailPushNotification,
} from "@g-spot/db/gmail";

export type GmailPushNotification = {
  emailAddress: string;
  historyId: string;
};

export type GmailPushAccount = {
  id: string;
  email: string;
  providerAccountId: string;
};

export async function processGmailPushNotification(
  payload: GmailPushNotification,
  receivedAt: string,
): Promise<{ accounts: GmailPushAccount[] }> {
  const accounts = await listGmailAccountsByEmail(payload.emailAddress);
  if (accounts.length === 0) {
    return { accounts: [] };
  }

  for (const account of accounts) {
    await recordGmailPushNotification(account.id, payload.historyId, receivedAt);
  }

  return { accounts };
}
