import type { OAuthAuthInfo, OAuthPrompt } from "@mariozechner/pi-ai";
import { nanoid } from "nanoid";

import type { PiOAuthProviderSummary } from "@g-spot/types";

import {
  createPiAuthStorage,
  getPiOAuthProviderCatalog,
  upsertPiCredential,
} from "./pi";

type PiOAuthSessionStatus =
  | "running"
  | "waiting_for_prompt"
  | "waiting_for_manual_code"
  | "completed"
  | "error"
  | "cancelled";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

type PiOAuthPromptState = OAuthPrompt;
type PiOAuthAuthState = OAuthAuthInfo;

type PiOAuthSessionRecord = {
  id: string;
  providerId: string;
  providerName: string;
  usesCallbackServer: boolean;
  status: PiOAuthSessionStatus;
  createdAt: number;
  updatedAt: number;
  progress: string[];
  auth?: PiOAuthAuthState;
  prompt?: PiOAuthPromptState;
  errorMessage?: string;
  abortController: AbortController;
  pendingPrompt?: Deferred<string>;
  pendingManualCode?: Deferred<string>;
};

const OAUTH_SESSION_TTL_MS = 15 * 60 * 1000;
const oauthSessions = new Map<string, PiOAuthSessionRecord>();

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

function touch(record: PiOAuthSessionRecord) {
  record.updatedAt = Date.now();
}

function cleanupOauthSessions() {
  const cutoff = Date.now() - OAUTH_SESSION_TTL_MS;

  for (const [sessionId, record] of oauthSessions) {
    if (record.updatedAt >= cutoff) {
      continue;
    }

    record.abortController.abort();
    oauthSessions.delete(sessionId);
  }
}

function toPublicSession(record: PiOAuthSessionRecord) {
  return {
    id: record.id,
    providerId: record.providerId,
    providerName: record.providerName,
    usesCallbackServer: record.usesCallbackServer,
    status: record.status,
    createdAt: new Date(record.createdAt).toISOString(),
    updatedAt: new Date(record.updatedAt).toISOString(),
    progress: [...record.progress],
    auth: record.auth,
    prompt: record.prompt,
    errorMessage: record.errorMessage,
  };
}

async function runOauthSession(record: PiOAuthSessionRecord) {
  const authStorage = await createPiAuthStorage();

  try {
    await authStorage.login(record.providerId, {
      onAuth: (info: OAuthAuthInfo) => {
        record.auth = info;
        touch(record);
      },
      onPrompt: async (prompt: OAuthPrompt) => {
        record.prompt = prompt;
        record.status = "waiting_for_prompt";
        record.pendingPrompt = createDeferred<string>();
        touch(record);

        try {
          const value = await record.pendingPrompt.promise;
          record.pendingPrompt = undefined;
          record.prompt = undefined;
          record.status = "running";
          touch(record);
          return value;
        } catch (error) {
          throw error;
        }
      },
      onProgress: (message: string) => {
        record.progress.push(message);
        touch(record);
      },
      onManualCodeInput: async () => {
        record.status = "waiting_for_manual_code";
        record.pendingManualCode = createDeferred<string>();
        touch(record);

        try {
          const value = await record.pendingManualCode.promise;
          record.pendingManualCode = undefined;
          record.status = "running";
          touch(record);
          return value;
        } catch (error) {
          throw error;
        }
      },
      signal: record.abortController.signal,
    });

    const credential = authStorage.get(record.providerId);
    if (!credential) {
      throw new Error("Pi login finished without storing credentials.");
    }

    await upsertPiCredential(record.providerId, credential);
    record.status = "completed";
    touch(record);
  } catch (error) {
    if (record.abortController.signal.aborted) {
      record.status = "cancelled";
      record.errorMessage = "Login cancelled.";
    } else {
      record.status = "error";
      record.errorMessage =
        error instanceof Error ? error.message : "Pi login failed.";
    }

    touch(record);
  } finally {
    record.pendingPrompt = undefined;
    record.pendingManualCode = undefined;
  }
}

export function listPiOAuthProviders(): PiOAuthProviderSummary[] {
  return getPiOAuthProviderCatalog();
}

export function getPiOAuthSession(sessionId: string) {
  cleanupOauthSessions();

  const record = oauthSessions.get(sessionId);
  return record ? toPublicSession(record) : null;
}

export async function startPiOAuthSession(providerId: string) {
  cleanupOauthSessions();

  const provider = listPiOAuthProviders().find(
    (entry: { id: string }) => entry.id === providerId,
  );
  if (!provider) {
    throw new Error(`Unknown Pi OAuth provider: ${providerId}`);
  }

  const record: PiOAuthSessionRecord = {
    id: nanoid(),
    providerId,
    providerName: provider.name,
    usesCallbackServer: provider.usesCallbackServer,
    status: "running",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    progress: [],
    abortController: new AbortController(),
  };

  oauthSessions.set(record.id, record);
  void runOauthSession(record);

  return toPublicSession(record);
}

export function submitPiOAuthPrompt(sessionId: string, value: string) {
  const record = oauthSessions.get(sessionId);
  if (!record?.pendingPrompt) {
    throw new Error("This Pi auth session is not waiting for a prompt response.");
  }

  record.pendingPrompt.resolve(value);
  record.pendingPrompt = undefined;
  record.prompt = undefined;
  record.status = "running";
  touch(record);

  return toPublicSession(record);
}

export function submitPiOAuthManualCode(sessionId: string, value: string) {
  const record = oauthSessions.get(sessionId);
  if (!record?.pendingManualCode) {
    throw new Error("This Pi auth session is not waiting for manual code input.");
  }

  record.pendingManualCode.resolve(value);
  record.pendingManualCode = undefined;
  record.status = "running";
  touch(record);

  return toPublicSession(record);
}

export function cancelPiOAuthSession(sessionId: string) {
  const record = oauthSessions.get(sessionId);
  if (!record) {
    return null;
  }

  record.abortController.abort();
  record.pendingPrompt?.reject(new Error("Login cancelled."));
  record.pendingManualCode?.reject(new Error("Login cancelled."));
  record.pendingPrompt = undefined;
  record.pendingManualCode = undefined;
  record.status = "cancelled";
  record.errorMessage = "Login cancelled.";
  touch(record);

  return toPublicSession(record);
}
