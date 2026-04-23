import type { Adapter } from "chat";
import { Chat } from "chat";
import { createGmailAdapter, type GmailThreadRef, type GmailRawMessage } from "@g-spot/chat-adapter-gmail";
import { createSqliteState } from "@g-spot/chat-state-sqlite";
import { getGmailAccountById, listGmailAccountsByEmail } from "@g-spot/db/gmail";
import { env } from "@g-spot/env/server";

import { processGmailPushNotification } from "./gmail-push";
import { getStackConnectedAccountAccessToken, type StackAuthHeaders } from "./stack-server";

/**
 * Server-side Chat instance.
 *
 *   - state:   SQLite adapter (shared chat-sdk state: subs/locks/cache/queue)
 *   - gmail:   always registered
 *   - slack:   registered if SLACK_SIGNING_SECRET + SLACK_BOT_TOKEN set
 *   - discord: registered if DISCORD_TOKEN + DISCORD_APPLICATION_ID + DISCORD_PUBLIC_KEY set
 *   - whatsapp: registered if WHATSAPP_ACCESS_TOKEN + WHATSAPP_APP_SECRET + WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_VERIFY_TOKEN set
 *
 * Per-account OAuth for Gmail requires Stack auth headers from the active
 * relay WS session. `setChatAuthHeaders` is called on every relay message so
 * the token provider always uses the freshest creds.
 */

const STATE_PATH = env.CHAT_STATE_SQLITE_PATH ?? "./chat-state.db";

let authHeadersRef: StackAuthHeaders | null = null;

export function setChatAuthHeaders(headers: StackAuthHeaders): void {
  authHeadersRef = headers;
}

function requireAuthHeaders(): StackAuthHeaders {
  if (!authHeadersRef) {
    throw new Error("Gmail adapter: no Stack auth headers registered yet");
  }
  return authHeadersRef;
}

type BaseAdapters = { gmail: ReturnType<typeof createGmailAdapter> };
type ChatInstanceExport = Chat<BaseAdapters>;

let chatPromise: Promise<ChatInstanceExport> | null = null;

export async function getChatInstance(): Promise<ChatInstanceExport> {
  if (!chatPromise) {
    chatPromise = buildChat();
  }
  return chatPromise;
}

async function buildChat(): Promise<ChatInstanceExport> {
  const state = createSqliteState({ path: STATE_PATH, keyPrefix: "chat" });
  await state.connect();

  const gmail = createGmailAdapter({
    userName: "g-spot",
    accountResolver: async (emailAddress) => {
      const accounts = await listGmailAccountsByEmail(emailAddress);
      return accounts.map((a) => ({ accountId: a.id }));
    },
    tokenProvider: async (accountId) => {
      const account = await getGmailAccountById(accountId);
      if (!account) {
        throw new Error(`No gmail account found for accountId=${accountId}`);
      }
      const accessToken = await getStackConnectedAccountAccessToken(
        requireAuthHeaders(),
        "google",
        account.providerAccountId,
      );
      return { accessToken, emailAddress: account.email };
    },
    onPush: async ({ emailAddress, historyId, receivedAt }) => {
      await processGmailPushNotification(
        { emailAddress, historyId },
        receivedAt,
        { authHeaders: requireAuthHeaders() },
      );
    },
  });

  const adapters: Record<string, Adapter> = { gmail };

  await maybeAddPlatformAdapters(adapters);

  const chat = new Chat({
    state,
    adapters: adapters as BaseAdapters,
    userName: "g-spot",
  });

  registerHandlers(chat);

  return chat;
}

async function maybeAddPlatformAdapters(adapters: Record<string, Adapter>): Promise<void> {
  // Platform adapters are optional peers: install the `@chat-adapter/*`
  // package you need only when turning on a platform. The dynamic imports
  // below are resolved at runtime, not by the TS compiler.
  if (env.SLACK_SIGNING_SECRET && env.SLACK_BOT_TOKEN) {
    const mod = await loadOptionalAdapter("@chat-adapter/slack");
    adapters.slack = mod.createSlackAdapter({
      signingSecret: env.SLACK_SIGNING_SECRET,
      botToken: env.SLACK_BOT_TOKEN,
      userName: "g-spot",
    });
  }

  if (env.DISCORD_TOKEN && env.DISCORD_APPLICATION_ID && env.DISCORD_PUBLIC_KEY) {
    const mod = await loadOptionalAdapter("@chat-adapter/discord");
    adapters.discord = mod.createDiscordAdapter({
      token: env.DISCORD_TOKEN,
      applicationId: env.DISCORD_APPLICATION_ID,
      publicKey: env.DISCORD_PUBLIC_KEY,
      userName: "g-spot",
    });
  }

  if (
    env.WHATSAPP_ACCESS_TOKEN
    && env.WHATSAPP_APP_SECRET
    && env.WHATSAPP_PHONE_NUMBER_ID
    && env.WHATSAPP_VERIFY_TOKEN
  ) {
    const mod = await loadOptionalAdapter("@chat-adapter/whatsapp");
    adapters.whatsapp = mod.createWhatsAppAdapter({
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
      appSecret: env.WHATSAPP_APP_SECRET,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      verifyToken: env.WHATSAPP_VERIFY_TOKEN,
      userName: "g-spot",
    });
  }
}

async function loadOptionalAdapter(name: string): Promise<any> {
  // Indirection through a variable prevents TS from resolving the module at
  // type-check time. Install the package to activate it.
  const specifier = name;
  return import(/* @vite-ignore */ specifier);
}

function registerHandlers(chat: ChatInstanceExport): void {
  chat.onSubscribedMessage(async (thread, message) => {
    console.log(
      `[chat] message platform=${thread.adapter.name} threadId=${thread.id} author=${message.author.userName} textLen=${message.text.length}`,
    );
  });

  chat.onDirectMessage(async (thread, message) => {
    console.log(
      `[chat] DM platform=${thread.adapter.name} threadId=${thread.id} author=${message.author.userName} textLen=${message.text.length}`,
    );
  });
}

/**
 * Fire chat-sdk `processMessage` for each newly-ingested Gmail message so the
 * registered `onSubscribedMessage` handler runs with a normalized `Message`.
 * Non-blocking: fire-and-forget. Errors are logged, not thrown, so sync is
 * never held up on handler failures.
 */
export function fanoutNewGmailMessages(args: {
  accountId: string;
  gmailThreadId: string;
  rawMessages: GmailRawMessage[];
}): void {
  const { accountId, gmailThreadId, rawMessages } = args;
  void (async () => {
    try {
      const chat = await getChatInstance();
      const adapter = chat.getAdapter("gmail");
      const threadId = adapter.encodeThreadId({ accountId, gmailThreadId });
      for (const raw of rawMessages) {
        chat.processMessage(adapter, threadId, () => {
          const msg = adapter.parseMessage(raw);
          (msg as { threadId: string }).threadId = threadId;
          return Promise.resolve(msg);
        });
      }
    } catch (error) {
      console.error("[chat-gmail] fanout failed", error);
    }
  })();
}

export type { GmailThreadRef, GmailRawMessage };
