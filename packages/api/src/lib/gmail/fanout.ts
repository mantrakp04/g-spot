/**
 * Chat-sdk fanout for newly ingested Gmail messages.
 *
 * Sync calls `fanoutNewGmailMessages` for every thread it just upserted. Each
 * raw message goes through `chat.processMessage` so the registered chat
 * handlers (`onSubscribedMessage`, `onDirectMessage`) fire with a normalized
 * `Message` shape.
 *
 * Per-thread serialization: messages for the same `gmailThreadId` queue
 * behind the previous fanout for that thread, so handlers see them in order.
 * Failures are logged, not thrown — sync never blocks on handler errors.
 */

import type { GmailRawMessage } from "@g-spot/adapters/gmail";

import { getChatInstance } from "../chat-gmail";

const fanoutChains = new Map<string, Promise<void>>();

export function fanoutNewGmailMessages(args: {
  accountId: string;
  gmailThreadId: string;
  rawMessages: GmailRawMessage[];
}): void {
  const { accountId, gmailThreadId, rawMessages } = args;
  const threadId = `gmail:${accountId}:${gmailThreadId}`;
  const previous = fanoutChains.get(threadId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => processGmailFanout({ accountId, gmailThreadId, rawMessages }));

  fanoutChains.set(threadId, next);
  void next.finally(() => {
    if (fanoutChains.get(threadId) === next) {
      fanoutChains.delete(threadId);
    }
  });
}

async function processGmailFanout(args: {
  accountId: string;
  gmailThreadId: string;
  rawMessages: GmailRawMessage[];
}): Promise<void> {
  const { accountId, gmailThreadId, rawMessages } = args;
  try {
    const chat = await getChatInstance();
    const adapter = chat.getAdapter("gmail");
    const threadId = adapter.encodeThreadId({ accountId, gmailThreadId });

    for (const raw of rawMessages) {
      let task: Promise<unknown> | null = null;
      chat.processMessage(
        adapter,
        threadId,
        () => {
          const msg = adapter.parseMessage(raw);
          (msg as { threadId: string }).threadId = threadId;
          return Promise.resolve(msg);
        },
        {
          waitUntil(promise) {
            task = promise;
          },
        },
      );
      await task;
    }
  } catch (error) {
    console.error("[gmail-fanout] failed:", error);
  }
}
