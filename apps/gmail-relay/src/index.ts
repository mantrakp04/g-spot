import type { ServerWebSocket } from "bun";
import { createHash } from "node:crypto";
import { env } from "@g-spot/env/relay";
import {
  deleteRelayEventsWithoutUser,
  enqueueRelayEvent,
  getNextPendingRelayEvent,
  incrementRelayEventAttempt,
  markRelayEventDrained,
} from "@g-spot/relay-db";
import { StackServerApp } from "@stackframe/react";
import { z } from "zod";

type RelayPushMessage = {
  type: "gmail.push";
  event: {
    id: string;
    messageId: string | null;
    emailAddress: string;
    historyId: string;
    publishTime: string | null;
    receivedAt: string;
  };
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

const pubSubPushEnvelopeSchema = z.object({
  message: z.object({
    data: z.string().optional(),
    messageId: z.string().optional(),
    publishTime: z.string().optional(),
  }).optional(),
});
const gmailPushPayloadSchema = z.object({
  emailAddress: z.string().min(1),
  historyId: z.coerce.string().min(1),
});
const gmailProfileSchema = z.object({
  emailAddress: z.string().min(1),
});
const gmailWatchSchema = z.object({
  historyId: z.string().min(1),
  expiration: z.string().min(1),
});
const relayAckMessageSchema = z.object({
  type: z.literal("ack"),
  id: z.string().min(1),
});

type PubSubPushEnvelope = z.infer<typeof pubSubPushEnvelopeSchema>;
type GmailPushPayload = z.infer<typeof gmailPushPayloadSchema>;
type RelayAckMessage = z.infer<typeof relayAckMessageSchema>;

const stackServerApp = new StackServerApp({
  projectId: env.STACK_PROJECT_ID,
  secretServerKey: env.STACK_SECRET_SERVER_KEY,
  tokenStore: "memory",
});
type RelayUser = NonNullable<Awaited<ReturnType<typeof stackServerApp.getUser>>>;

await deleteRelayEventsWithoutUser();

const activeSockets = new Map<string, ServerWebSocket<RelaySocketData>>();
const inflightEventIds = new Map<string, string>();
const drainingUsers = new Set<string>();
const registeredEmailsByUserId = new Map<string, Set<string>>();
const userIdsByEmail = new Map<string, Set<string>>();

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Short stable opaque label for logs — not reversible to the original value */
function opaqueRef(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
}

function fmtMs(ms: number): string {
  return ms.toFixed(2);
}

async function getGmailProfile(token: string): Promise<{ emailAddress: string }> {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Gmail profile failed (${response.status} ${response.statusText}): ${errorBody}`,
    );
  }

  return gmailProfileSchema.parse(await response.json());
}

async function watchMailbox(
  token: string,
): Promise<{ historyId: string; expiration: string }> {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/watch", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topicName: env.GMAIL_PUBSUB_TOPIC_NAME,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Gmail watch failed (${response.status} ${response.statusText}): ${errorBody}`,
    );
  }

  return gmailWatchSchema.parse(await response.json());
}

async function listConnectedGmailAccounts(user: RelayUser): Promise<ConnectedGmailAccount[]> {
  const accounts = await user.listConnectedAccounts();
  const connectedGmailAccounts: ConnectedGmailAccount[] = [];

  for (const account of accounts) {
    if (account.provider !== "google") continue;

    const tokenResult = await account.getAccessToken({
      scopes: [REQUIRED_GMAIL_SCOPE],
    });
    if (tokenResult.status !== "ok") {
      continue;
    }

    try {
      const profile = await getGmailProfile(tokenResult.data.accessToken);
      await watchMailbox(tokenResult.data.accessToken);
      connectedGmailAccounts.push({
        email: normalizeEmail(profile.emailAddress),
        providerAccountId: account.providerAccountId,
      });
    } catch (error) {
      console.error(
        `[gmail-relay] gmail.watch_failed accountRef=${opaqueRef(account.providerAccountId)}`,
        error,
      );
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
      if (userIds.size === 0) {
        userIdsByEmail.delete(email);
      }
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

function decodePushPayload(data: string): GmailPushPayload {
  const json = Buffer.from(data, "base64url").toString("utf-8");
  return gmailPushPayloadSchema.parse(JSON.parse(json));
}

async function enqueueEventForUser(
  userId: string,
  envelope: PubSubPushEnvelope,
  payload: GmailPushPayload,
  receivedAt: string,
) {
  await enqueueRelayEvent({
    id: crypto.randomUUID(),
    userId,
    pubsubMessageId: envelope.message?.messageId ?? null,
    emailAddress: payload.emailAddress,
    historyId: payload.historyId,
    publishTime: envelope.message?.publishTime ?? null,
    receivedAt,
  });
}

async function drainQueue(userId: string) {
  if (drainingUsers.has(userId)) return;

  const socket = activeSockets.get(userId);
  if (!socket || inflightEventIds.has(userId)) return;

  drainingUsers.add(userId);
  const userRef = opaqueRef(userId);
  try {
    const event = await getNextPendingRelayEvent(userId);
    if (!event) return;

    inflightEventIds.set(userId, event.id);
    await incrementRelayEventAttempt(event.id, new Date().toISOString());

    const message: RelayPushMessage = {
      type: "gmail.push",
      event: {
        id: event.id,
        messageId: event.pubsubMessageId,
        emailAddress: event.emailAddress,
        historyId: event.historyId,
        publishTime: event.publishTime,
        receivedAt: event.receivedAt,
      },
    };
    socket.send(JSON.stringify(message));
  } catch (error) {
    inflightEventIds.delete(userId);
    console.error(`[gmail-relay] push.dispatch_failed userRef=${userRef}`, error);
  } finally {
    drainingUsers.delete(userId);
  }
}

async function handleApiWsUpgrade(
  request: Request,
  server: { upgrade(request: Request, options: { data: RelaySocketData }): boolean },
): Promise<Response | undefined> {
  const connectStartedAt = performance.now();

  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket upgrade request", {
      status: 426,
      headers: { Connection: "Upgrade", Upgrade: "websocket" },
    });
  }

  const user = await stackServerApp.getUser({
    tokenStore: request,
  });
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userRef = opaqueRef(user.id);
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
    data: {
      userId: user.id,
      gmailAccounts,
    },
  });

  if (!upgraded) {
    console.error(
      `[gmail-relay] ws.upgrade_failed userRef=${userRef} ms.total=${fmtMs(performance.now() - connectStartedAt)}`,
    );
    return new Response("WebSocket upgrade failed", { status: 500 });
  }

  return undefined;
}

async function handlePushWebhook(request: Request): Promise<Response> {
  if (!verifyPushRequest(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let envelope: PubSubPushEnvelope;
  try {
    envelope = pubSubPushEnvelopeSchema.parse(await request.json());
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!envelope.message?.data) {
    return new Response(null, { status: 204 });
  }

  let payload: GmailPushPayload;
  try {
    payload = decodePushPayload(envelope.message.data);
  } catch {
    return new Response("Invalid Pub/Sub payload", { status: 400 });
  }

  const userIds = [...(userIdsByEmail.get(normalizeEmail(payload.emailAddress)) ?? [])];
  if (userIds.length === 0) {
    return new Response(null, { status: 204 });
  }

  const receivedAt = envelope.message.publishTime ?? new Date().toISOString();
  for (const userId of userIds) {
    await enqueueEventForUser(userId, envelope, payload, receivedAt);
    await drainQueue(userId);
  }

  return new Response(null, { status: 204 });
}

Bun.serve<RelaySocketData>({
  hostname: env.RELAY_HOST,
  port: env.RELAY_PORT,
  async fetch(request, server) {
    const url = new URL(request.url);

    if (url.pathname === "/api/ws") {
      return handleApiWsUpgrade(request, server);
    }

    if (url.pathname === "/api/gmail/push" && request.method === "POST") {
      return handlePushWebhook(request);
    }

    if (url.pathname === "/api/gmail/push" && request.method === "GET") {
      return new Response("OK");
    }

    if (url.pathname === "/ping") {
      return Response.json({
        ok: true,
        service: "gmail-relay",
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
      inflightEventIds.delete(userId);

      ws.send(
        JSON.stringify({
          type: "relay.hello",
          gmailAccounts,
        }),
      );

      void drainQueue(userId);
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
      const inflightEventId = inflightEventIds.get(userId);
      if (!inflightEventId || message.id !== inflightEventId) return;

      void (async () => {
        await markRelayEventDrained(userId, message.id, new Date().toISOString());
        inflightEventIds.delete(userId);
        await drainQueue(userId);
      })();
    },
    close(ws) {
      const { userId } = ws.data;
      if (activeSockets.get(userId) === ws) {
        activeSockets.delete(userId);
      }
      inflightEventIds.delete(userId);
    },
  },
});
