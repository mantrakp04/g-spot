import type { ServerWebSocket } from "bun";
import {
  decodeGmailPushPayload,
  gmailPubSubEnvelopeSchema,
  type GmailPubSubEnvelope,
  type GmailPushPayload,
} from "@g-spot/chat-adapter-gmail";
import { env, relayDatabaseFilePath } from "@g-spot/env/relay";
import { createSqliteState } from "@g-spot/chat-state-sqlite";
import { StackServerApp } from "@stackframe/react";
import type { QueueEntry } from "chat";
import { z } from "zod";

type RelayEventPayload = {
  id: string;
  messageId: string | null;
  emailAddress: string;
  historyId: string;
  publishTime: string | null;
  receivedAt: string;
};

type RelayPushMessage = {
  type: "gmail.push";
  event: RelayEventPayload;
};

type ConnectedGmailAccount = {
  email: string;
  providerAccountId: string;
};

type RelaySocketData = {
  userId: string;
  gmailAccounts: ConnectedGmailAccount[];
};

const REQUIRED_GMAIL_SCOPE = "https://mail.google.com/";
const PENDING_QUEUE_MAX = 1000;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const INFLIGHT_TTL_MS = 10 * 60 * 1000; // 10min
const DEDUPE_TTL_MS = 5 * 60 * 1000; // 5min
const GMAIL_PROFILE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GMAIL_PROFILE_RATE_LIMIT_FALLBACK_MS = 60 * 60 * 1000;

const gmailProfileSchema = z.object({
  emailAddress: z.string().min(1),
});
const relayAckMessageSchema = z.object({
  type: z.literal("ack"),
  id: z.string().min(1),
});

type RelayAckMessage = z.infer<typeof relayAckMessageSchema>;

const stackServerApp = new StackServerApp({
  projectId: env.STACK_PROJECT_ID,
  secretServerKey: env.STACK_SECRET_SERVER_KEY,
  tokenStore: "memory",
});
type RelayUser = NonNullable<Awaited<ReturnType<typeof stackServerApp.getUser>>>;

const state = createSqliteState({ path: relayDatabaseFilePath(), keyPrefix: "relay" });
await state.connect();

const activeSockets = new Map<string, ServerWebSocket<RelaySocketData>>();
const draining = new Set<string>();
const registeredEmailsByUserId = new Map<string, Set<string>>();
const userIdsByEmail = new Map<string, Set<string>>();

function userThreadId(userId: string): string {
  return `relay:user:${userId}`;
}
function emailThreadId(email: string): string {
  return `relay:email:${normalizeEmail(email)}`;
}
function inflightKey(userId: string): string {
  return `inflight:${userId}`;
}
function dedupeKey(userId: string, messageId: string): string {
  return `dedupe:${userId}:${messageId}`;
}
function emailDedupeKey(email: string, messageId: string): string {
  return `dedupe:email:${normalizeEmail(email)}:${messageId}`;
}
function gmailProfileCacheKey(providerAccountId: string): string {
  return `gmail-profile:${providerAccountId}`;
}
function gmailProfileCooldownKey(providerAccountId: string): string {
  return `gmail-profile-cooldown:${providerAccountId}`;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(1_000, seconds * 1000);
  }

  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) return null;

  return Math.max(1_000, retryAt - Date.now());
}

function parseRetryAfterFromBodyMs(body: string): number | null {
  const match = body.match(/\bRetry after\s+([^\s.]+(?:\.\d+)?Z?)/i);
  if (!match?.[1]) return null;

  const retryAt = Date.parse(match[1]);
  if (!Number.isFinite(retryAt)) return null;

  return Math.max(1_000, retryAt - Date.now());
}

async function getCachedGmailProfile(
  providerAccountId: string,
  token: string,
): Promise<{ emailAddress: string } | null> {
  const cached = await state.get<{ emailAddress: string }>(
    gmailProfileCacheKey(providerAccountId),
  );
  if (cached) {
    return cached;
  }

  const cooldown = await state.get<boolean>(
    gmailProfileCooldownKey(providerAccountId),
  );
  if (cooldown) {
    return null;
  }

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    if (response.status === 429 || response.status === 403) {
      const retryAfterMs =
        parseRetryAfterMs(response.headers.get("Retry-After"))
        ?? parseRetryAfterFromBodyMs(errorBody)
        ?? GMAIL_PROFILE_RATE_LIMIT_FALLBACK_MS;
      await state.set(
        gmailProfileCooldownKey(providerAccountId),
        true,
        retryAfterMs,
      );
    }
    throw new Error(
      `Gmail profile failed (${response.status} ${response.statusText}): ${errorBody}`,
    );
  }

  const profile = gmailProfileSchema.parse(await response.json());
  await state.set(
    gmailProfileCacheKey(providerAccountId),
    profile,
    GMAIL_PROFILE_CACHE_TTL_MS,
  );
  return profile;
}

async function listConnectedGmailAccounts(user: RelayUser): Promise<ConnectedGmailAccount[]> {
  const accounts = await user.listConnectedAccounts();
  const connectedGmailAccounts: ConnectedGmailAccount[] = [];

  for (const account of accounts) {
    if (account.provider !== "google") continue;

    const tokenResult = await account.getAccessToken({
      scopes: [REQUIRED_GMAIL_SCOPE],
    });
    if (tokenResult.status !== "ok") continue;

    try {
      const profile = await getCachedGmailProfile(
        account.providerAccountId,
        tokenResult.data.accessToken,
      );
      if (!profile) continue;
      connectedGmailAccounts.push({
        email: normalizeEmail(profile.emailAddress),
        providerAccountId: account.providerAccountId,
      });
    } catch {
      // ignore: account skipped if profile unavailable
    }
  }

  return connectedGmailAccounts.filter(
    (account, index, allAccounts) =>
      allAccounts.findIndex((candidate) => candidate.email === account.email) === index,
  );
}

function replaceRegisteredEmails(userId: string, emails: string[]) {
  const previousEmails = registeredEmailsByUserId.get(userId);
  if (previousEmails) {
    for (const email of previousEmails) {
      const userIds = userIdsByEmail.get(email);
      if (!userIds) continue;
      userIds.delete(userId);
      if (userIds.size === 0) userIdsByEmail.delete(email);
    }
  }

  const nextEmails = new Set(emails);
  registeredEmailsByUserId.set(userId, nextEmails);

  for (const email of nextEmails) {
    const userIds = userIdsByEmail.get(email) ?? new Set<string>();
    userIds.add(userId);
    userIdsByEmail.set(email, userIds);
  }
}

function getWebhookVerificationToken(request: Request): string | null {
  const url = new URL(request.url);
  return (
    url.searchParams.get("token")
    ?? request.headers.get("x-gspot-pubsub-token")
  );
}

function verifyPushRequest(request: Request): boolean {
  return getWebhookVerificationToken(request) === env.GMAIL_PUBSUB_VERIFICATION_TOKEN;
}

function eventFromPush(
  envelope: GmailPubSubEnvelope,
  payload: GmailPushPayload,
  receivedAt: string,
): RelayEventPayload {
  return {
    id: crypto.randomUUID(),
    messageId: envelope.message?.messageId ?? null,
    emailAddress: payload.emailAddress,
    historyId: payload.historyId,
    publishTime: envelope.message?.publishTime ?? null,
    receivedAt,
  };
}

function queueEntryForEvent(event: RelayEventPayload): QueueEntry {
  return {
    enqueuedAt: Date.now(),
    expiresAt: Date.now() + PENDING_TTL_MS,
    // chat-sdk's QueueEntry.message is typed `Message`; we stash our relay payload
    // in the `raw` slot since the relay is not itself a chat-sdk runtime.
    message: { raw: event } as unknown as QueueEntry["message"],
  };
}

async function enqueueRelayEventForUser(
  userId: string,
  event: RelayEventPayload,
): Promise<void> {
  if (event.messageId) {
    const fresh = await state.setIfNotExists(
      dedupeKey(userId, event.messageId),
      true,
      DEDUPE_TTL_MS,
    );
    if (!fresh) {
      return;
    }
  }

  await state.enqueue(userThreadId(userId), queueEntryForEvent(event), PENDING_QUEUE_MAX);
}

async function enqueueEventForEmail(event: RelayEventPayload): Promise<void> {
  const email = normalizeEmail(event.emailAddress);
  if (event.messageId) {
    const fresh = await state.setIfNotExists(
      emailDedupeKey(email, event.messageId),
      true,
      DEDUPE_TTL_MS,
    );
    if (!fresh) {
      return;
    }
  }

  await state.enqueue(emailThreadId(email), queueEntryForEvent(event), PENDING_QUEUE_MAX);
}

async function transferEmailQueueToUser(userId: string, email: string): Promise<void> {
  for (;;) {
    const entry = await state.dequeue(emailThreadId(email));
    if (!entry) return;
    const event = extractRelayEvent(entry);
    if (!event) continue;
    await enqueueRelayEventForUser(userId, event);
  }
}

async function enqueueEventForUser(
  userId: string,
  event: RelayEventPayload,
) {
  await enqueueRelayEventForUser(userId, event);
}

async function drainQueue(userId: string) {
  if (draining.has(userId)) {
    return;
  }
  const socket = activeSockets.get(userId);
  if (!socket) {
    return;
  }

  draining.add(userId);
  try {
    const existingInflight = await state.get<RelayEventPayload>(inflightKey(userId));
    if (existingInflight) {
      return;
    }

    const entry = await state.dequeue(userThreadId(userId));
    if (!entry) {
      return;
    }

    const event = extractRelayEvent(entry);
    if (!event) {
      return;
    }

    await state.set(inflightKey(userId), event, INFLIGHT_TTL_MS);

    const message: RelayPushMessage = { type: "gmail.push", event };
    socket.send(JSON.stringify(message));
  } catch {
    // best-effort: next drain will retry
  } finally {
    draining.delete(userId);
  }
}

function extractRelayEvent(entry: QueueEntry): RelayEventPayload | null {
  const slot = entry.message as unknown as { raw?: RelayEventPayload };
  return slot?.raw ?? null;
}

async function handleApiWsUpgrade(
  request: Request,
  server: { upgrade(request: Request, options: { data: RelaySocketData }): boolean },
): Promise<Response | undefined> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket upgrade request", {
      status: 426,
      headers: { Connection: "Upgrade", Upgrade: "websocket" },
    });
  }

  const user = await stackServerApp.getUser({ tokenStore: request });
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const gmailAccounts = await listConnectedGmailAccounts(user);

  if (gmailAccounts.length === 0) {
    replaceRegisteredEmails(user.id, []);
    return new Response("No Gmail connected accounts", { status: 409 });
  }

  replaceRegisteredEmails(
    user.id,
    gmailAccounts.map((account) => account.email),
  );

  const upgraded = server.upgrade(request, {
    data: { userId: user.id, gmailAccounts },
  });

  if (!upgraded) {
    return new Response("WebSocket upgrade failed", { status: 500 });
  }

  return undefined;
}

async function handlePushWebhook(request: Request): Promise<Response> {
  if (!verifyPushRequest(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let envelope: GmailPubSubEnvelope;
  try {
    envelope = gmailPubSubEnvelopeSchema.parse(await request.json());
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!envelope.message?.data) {
    return new Response(null, { status: 204 });
  }

  let payload: GmailPushPayload;
  try {
    payload = decodeGmailPushPayload(envelope.message.data);
  } catch {
    return new Response("Invalid Pub/Sub payload", { status: 400 });
  }

  const normalizedEmail = normalizeEmail(payload.emailAddress);
  const userIds = [...(userIdsByEmail.get(normalizedEmail) ?? [])];
  const receivedAt = envelope.message.publishTime ?? new Date().toISOString();
  const event = eventFromPush(envelope, payload, receivedAt);

  if (userIds.length === 0) {
    await enqueueEventForEmail(event);
    return new Response(null, { status: 204 });
  }

  for (const userId of userIds) {
    await enqueueEventForUser(userId, event);
    await drainQueue(userId);
  }

  return new Response(null, { status: 204 });
}

Bun.serve<RelaySocketData>({
  hostname: env.RELAY_HOST,
  port: env.RELAY_PORT,
  async fetch(request, server) {
    const url = new URL(request.url);

    if (url.pathname === "/api/ws") return handleApiWsUpgrade(request, server);

    if (url.pathname === "/api/gmail/push" && request.method === "POST") {
      return handlePushWebhook(request);
    }

    if (url.pathname === "/api/gmail/push" && request.method === "GET") {
      return new Response("OK");
    }

    if (url.pathname === "/ping") {
      return Response.json({
        ok: true,
        service: "relay",
        now: new Date().toISOString(),
      });
    }

    return new Response("Not Found", { status: 404 });
  },
  websocket: {
    open(ws) {
      const { userId, gmailAccounts } = ws.data;
      const existing = activeSockets.get(userId);
      if (existing && existing !== ws) {
        existing.close(1012, "Replaced by new connection");
      }

      activeSockets.set(userId, ws);

      void (async () => {
        for (const account of gmailAccounts) {
          await transferEmailQueueToUser(userId, account.email);
        }
        const inflight = await state.get<RelayEventPayload>(inflightKey(userId));
        ws.send(JSON.stringify({ type: "relay.hello", gmailAccounts }));
        if (inflight) {
          ws.send(JSON.stringify({ type: "gmail.push", event: inflight } satisfies RelayPushMessage));
        } else {
          await drainQueue(userId);
        }
      })();
    },
    message(ws, raw) {
      if (typeof raw !== "string") return;

      let message: RelayAckMessage;
      try {
        message = relayAckMessageSchema.parse(JSON.parse(raw));
      } catch {
        return;
      }

      const { userId } = ws.data;

      void (async () => {
        const inflight = await state.get<RelayEventPayload>(inflightKey(userId));
        if (!inflight || inflight.id !== message.id) {
          return;
        }
        await state.delete(inflightKey(userId));
        await drainQueue(userId);
      })();
    },
    close(ws) {
      const { userId } = ws.data;
      if (activeSockets.get(userId) === ws) activeSockets.delete(userId);
    },
  },
});
