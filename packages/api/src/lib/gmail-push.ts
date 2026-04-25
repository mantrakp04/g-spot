import {
  listGmailAccountsByEmail,
  recordGmailPushNotification,
} from "@g-spot/db/gmail";

export type GmailPushNotification = {
  emailAddress: string;
  historyId: string;
};

export async function processGmailPushNotification(
  payload: GmailPushNotification,
  receivedAt: string,
): Promise<void> {
  const accounts = await listGmailAccountsByEmail(payload.emailAddress);
  if (accounts.length === 0) {
    return;
  }

  for (const account of accounts) {
    await recordGmailPushNotification(account.id, payload.historyId, receivedAt);
  }
}
