import type { StackAuthHeaders } from "./stack-server";

import { env } from "@g-spot/env/server";
import { z } from "zod";
import WebSocket from "ws";

import { processGmailPushNotification } from "./gmail-push";

type RelayAck = {
  type: "ack";
  id: string;
};

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

type RelayClientState = {
  authHeaders: StackAuthHeaders;
  socket: WebSocket | null;
  processing: Promise<void>;
  isConnecting: boolean;
};

function buildRelaySocketBaseUrl(): URL | null {
  if (!env.GMAIL_PUSH_RELAY_URL) return null;
  const url = new URL(env.GMAIL_PUSH_RELAY_URL);
  if (url.pathname === "/" || url.pathname === "") {
    url.pathname = "/api/ws";
  }
  return url;
}

function normalizeRelayAuthHeaders(headers: StackAuthHeaders): StackAuthHeaders {
  return Object.fromEntries(
    Object.entries(headers).filter(([key, value]) =>
      value
      && (
        key === "authorization"
        || key === "cookie"
        || key.startsWith("x-stack-")
      )),
  );
}

function headersForWs(headers: StackAuthHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string" && value.length > 0) {
      out[key] = value;
    }
  }
  return out;
}

let relayClientState: RelayClientState | null = null;

function getOrCreateRelayClientState(
  authHeaders: StackAuthHeaders,
): RelayClientState {
  if (relayClientState) {
    relayClientState.authHeaders = authHeaders;
    return relayClientState;
  }

  relayClientState = {
    authHeaders,
    socket: null,
    processing: Promise.resolve(),
    isConnecting: false,
  };
  return relayClientState;
}

async function handleRelayMessage(state: RelayClientState, raw: string) {
  const parsed: unknown = JSON.parse(raw);

  const hello = relayHelloSchema.safeParse(parsed);
  if (hello.success) {
    return;
  }

  const message = relayPushEventSchema.parse(parsed);
  if (message.type !== "gmail.push") return;

  await processGmailPushNotification(
    {
      emailAddress: message.event.emailAddress,
      historyId: message.event.historyId,
    },
    message.event.publishTime ?? message.event.receivedAt,
    {
      authHeaders: state.authHeaders,
    },
  );

  const ack: RelayAck = {
    type: "ack",
    id: message.event.id,
  };

  state.socket?.send(JSON.stringify(ack));
}

async function openRelaySocket(
  url: string,
  headers: Record<string, string>,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = new WebSocket(url, { headers });

    const settle = () => {
      if (settled) return false;
      settled = true;
      socket.removeAllListeners();
      socket.on("error", () => {});
      return true;
    };

    socket.once("open", () => {
      if (settle()) resolve(socket);
    });

    socket.once("error", () => {
      if (settle()) reject(new Error("Relay socket failed to open"));
    });

    socket.once("close", () => {
      if (settle()) reject(new Error("Relay socket closed before opening"));
    });
  });
}

async function connectRelaySocket(state: RelayClientState): Promise<boolean> {
  if (state.isConnecting) return false;

  const normalizedHeaders = normalizeRelayAuthHeaders(state.authHeaders);
  if (!Object.keys(normalizedHeaders).length) {
    return false;
  }

  const baseUrl = buildRelaySocketBaseUrl();
  if (!baseUrl) {
    return false;
  }

  state.isConnecting = true;
  try {
    const socket = await openRelaySocket(
      baseUrl.toString(),
      headersForWs(normalizedHeaders),
    );
    state.socket = socket;

    socket.on("message", (data) => {
      const raw = typeof data === "string" ? data : data.toString("utf8");

      state.processing = state.processing
        .then(() => handleRelayMessage(state, raw))
        .catch((error) => {
          console.error("[gmail-relay-client] Failed to process relay event:", error);
          socket.close();
        });
    });

    socket.on("close", () => {
      if (state.socket === socket) {
        state.socket = null;
      }
    });

    socket.on("error", (error) => {
      console.error("[gmail-relay-client] Socket error:", error);
    });
    return true;
  } catch (error) {
    state.socket = null;
    console.error("[gmail-relay-client] Failed to open socket:", error);
    return false;
  } finally {
    state.isConnecting = false;
  }
}

export async function ensureGmailPushRelayConnection(
  authHeaders: StackAuthHeaders,
): Promise<boolean> {
  if (!env.GMAIL_PUSH_RELAY_URL) return false;

  const state = getOrCreateRelayClientState(normalizeRelayAuthHeaders(authHeaders));
  const readyState = state.socket?.readyState;
  if (readyState === WebSocket.OPEN) {
    return true;
  }

  if (readyState === WebSocket.CONNECTING) {
    return false;
  }

  return connectRelaySocket(state);
}
