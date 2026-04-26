import { env } from "@g-spot/env/server";
import { listGmailAccountsWithPendingNotifications } from "@g-spot/db/gmail";
import WebSocket from "ws";
import { z } from "zod";

import { processGmailPushNotification } from "./gmail-push";
import {
  getActiveSync,
  startSync,
} from "./gmail-sync";
import { getStackGmailAccessTokenForProviderAccountId } from "./stack-client-api";

const STACK_AUTH_HEADER = "x-stack-auth";
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

const relayHelloSchema = z.object({
  type: z.literal("relay.hello"),
  gmailAccounts: z.array(
    z.object({
      email: z.string(),
      providerAccountId: z.string(),
    }),
  ),
});

const relayPushEventSchema = z.object({
  type: z.literal("gmail.push"),
  event: z.object({
    id: z.string().min(1),
    messageId: z.string().nullable(),
    emailAddress: z.string().min(1),
    historyId: z.string().min(1),
    publishTime: z.string().nullable(),
    receivedAt: z.string().min(1),
  }),
});

type RelayState = {
  authHeader: string;
  socket: WebSocket | null;
  isConnecting: boolean;
  processing: Promise<void>;
  reconnectAttempt: number;
  reconnectTimer: NodeJS.Timeout | null;
};

let state: RelayState | null = null;

function relayWsUrl(): string {
  return `${env.RELAY_URL.replace(/\/+$/, "")}/api/ws`;
}

function clearReconnect(s: RelayState): void {
  if (s.reconnectTimer) {
    clearTimeout(s.reconnectTimer);
    s.reconnectTimer = null;
  }
}

function scheduleReconnect(s: RelayState): void {
  if (s.reconnectTimer) return;
  const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** s.reconnectAttempt);
  s.reconnectAttempt += 1;
  s.reconnectTimer = setTimeout(() => {
    s.reconnectTimer = null;
    void connect(s);
  }, delay);
}

async function handleMessage(s: RelayState, raw: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  const hello = relayHelloSchema.safeParse(parsed);
  if (hello.success) {
    return;
  }

  const push = relayPushEventSchema.safeParse(parsed);
  if (!push.success) {
    return;
  }

  const { event } = push.data;

  let accounts: Array<{ id: string; email: string; providerAccountId: string }>;
  try {
    const result = await processGmailPushNotification(
      { emailAddress: event.emailAddress, historyId: event.historyId },
      event.publishTime ?? event.receivedAt,
    );
    accounts = result.accounts;
  } catch {
    return; // do not ack so relay re-delivers
  }

  if (accounts.length > 0) {
    const scheduled = await triggerIncrementalSyncForAccounts(s.authHeader, accounts);
    if (!scheduled) return;
  }

  s.socket?.send(JSON.stringify({ type: "ack", id: event.id }));
}

async function triggerIncrementalSyncForAccounts(
  authHeader: string,
  accounts: Array<{ id: string; email: string; providerAccountId: string }>,
): Promise<boolean> {
  if (accounts.length === 0) return true;

  let scheduledAll = true;
  for (const account of accounts) {
    const scheduled = await triggerSyncForAccount(authHeader, account);
    scheduledAll &&= scheduled;
  }
  return scheduledAll;
}

async function triggerSyncForAccount(
  authHeader: string,
  account: { id: string; email: string; providerAccountId: string },
): Promise<boolean> {
  const accountId = account.id;

  const active = getActiveSync(accountId);
  if (active) {
    return true;
  }

  let accessToken: string | null;
  try {
    accessToken = await getStackGmailAccessTokenForProviderAccountId(
      authHeader,
      account.providerAccountId,
    );
  } catch {
    return false;
  }

  if (!accessToken) {
    return false;
  }

  try {
    const result = await startSync(accountId, accessToken, "push");
    return result.started;
  } catch {
    return false;
  }
}

function connect(s: RelayState): Promise<boolean> {
  if (s.isConnecting) return Promise.resolve(false);
  if (s.socket && s.socket.readyState === WebSocket.OPEN) return Promise.resolve(true);

  s.isConnecting = true;
  const url = relayWsUrl();

  return new Promise<boolean>((resolve) => {
    const socket = new WebSocket(url, {
      headers: { [STACK_AUTH_HEADER]: s.authHeader },
    });

    let settled = false;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      s.isConnecting = false;
      resolve(ok);
    };

    socket.once("open", () => {
      s.socket = socket;
      s.reconnectAttempt = 0;
      clearReconnect(s);
      settle(true);
    });

    socket.on("message", (data) => {
      const raw = typeof data === "string" ? data : data.toString("utf8");
      s.processing = s.processing
        .then(() => handleMessage(s, raw))
        .catch(() => {
          // serialized handler chain; individual messages already no-op on failure
        });
    });

    socket.on("close", () => {
      if (s.socket === socket) s.socket = null;
      settle(false);
      scheduleReconnect(s);
    });

    socket.on("error", () => {
      settle(false);
    });
  });
}

export type EnsureRelayConnectionResult = {
  connected: boolean;
  status: "open" | "connecting" | "closed";
};

export async function triggerPendingGmailNotificationSyncs(
  authHeader: string,
): Promise<{ checkedAccounts: number; scheduledAccounts: number }> {
  const accounts = await listGmailAccountsWithPendingNotifications();
  let scheduledAccounts = 0;

  for (const account of accounts) {
    if (await triggerSyncForAccount(authHeader, account)) {
      scheduledAccounts += 1;
    }
  }

  return { checkedAccounts: accounts.length, scheduledAccounts };
}

export async function ensureRelayConnection(
  authHeader: string,
): Promise<EnsureRelayConnectionResult> {
  if (!state) {
    state = {
      authHeader,
      socket: null,
      isConnecting: false,
      processing: Promise.resolve(),
      reconnectAttempt: 0,
      reconnectTimer: null,
    };
  } else {
    state.authHeader = authHeader;
  }

  const readyState = state.socket?.readyState;
  if (readyState === WebSocket.OPEN) {
    return { connected: true, status: "open" };
  }
  if (readyState === WebSocket.CONNECTING || state.isConnecting) {
    return { connected: false, status: "connecting" };
  }

  const ok = await connect(state);
  return { connected: ok, status: ok ? "open" : "closed" };
}
