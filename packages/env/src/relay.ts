import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

export const relayDatabasePath = resolve(
  fileURLToPath(new URL("../../..", import.meta.url)),
  "apps/gmail-relay/relay.db",
);

export function relayLibsqlAuthToken(): string | undefined {
  const t = process.env.LIBSQL_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN;
  return t ? t : undefined;
}

export function relayDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? `file:${relayDatabasePath}`;
}

export function relayDbIsRemoteLibsql(url: string): boolean {
  return (
    url.startsWith("libsql:") ||
    url.startsWith("http://") ||
    url.startsWith("https://")
  );
}

export function getRelayDrizzleDbCredentials(): {
  url: string;
  authToken?: string;
  isRemoteLibsql: boolean;
} {
  const url = relayDatabaseUrl();
  const authToken = relayLibsqlAuthToken();
  return {
    url,
    ...(authToken ? { authToken } : {}),
    isRemoteLibsql: relayDbIsRemoteLibsql(url),
  };
}

// `RELAY_DRIZZLE_ONLY=1`: Drizzle Kit only (`relay-db` db:* scripts). Never set for gmail-relay / runtime.
export const env = createEnv({
  server: {
    RELAY_HOST: z.string().min(1).default("localhost"),
    RELAY_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    DATABASE_URL: z.string().min(1).default(`file:${relayDatabasePath}`),
    LIBSQL_AUTH_TOKEN: z.string().optional(),
    TURSO_AUTH_TOKEN: z.string().optional(),
    STACK_PROJECT_ID: z.string().min(1),
    STACK_SECRET_SERVER_KEY: z.string().min(1),
    GMAIL_PUBSUB_TOPIC_NAME: z.string().min(1),
    GMAIL_PUBSUB_VERIFICATION_TOKEN: z.string().min(1),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  skipValidation: process.env.RELAY_DRIZZLE_ONLY === "1",
});
