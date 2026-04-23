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

export function relayDatabaseFilePath(): string {
  const raw = process.env.DATABASE_URL ?? relayDatabasePath;
  return raw.startsWith("file:") ? raw.slice("file:".length) : raw;
}

export const env = createEnv({
  server: {
    RELAY_HOST: z.string().min(1).default("localhost"),
    RELAY_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    DATABASE_URL: z.string().min(1).default(relayDatabasePath),
    STACK_PROJECT_ID: z.string().min(1),
    STACK_SECRET_SERVER_KEY: z.string().min(1),
    GMAIL_PUBSUB_TOPIC_NAME: z.string().min(1),
    GMAIL_PUBSUB_VERIFICATION_TOKEN: z.string().min(1),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
