import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const databasePath = resolve(
  fileURLToPath(new URL("../../..", import.meta.url)),
  "apps/server/local.db",
);

const serverConfig = createEnv({
  server: {
    SERVER_HOST: z.string().min(1).default("localhost"),
    SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

export const env = createEnv({
  extends: [serverConfig],
  server: {
    DATABASE_URL: z.string().min(1).default(`file:${databasePath}`),
    CORS_ORIGIN: z.url().default("http://localhost:3001"),
    NODE_ENV: z.enum(["development", "production", "test", "preview"]).default("development"),
    STACK_PROJECT_ID: z.string().min(1).default("528293a9-a93a-4511-92a9-0df356161cc7"),
    // Gmail sync
    GMAIL_SYNC_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(20),
    GMAIL_PUSH_RELAY_URL: z.string().min(1).default(
      process.env.NODE_ENV === "production"
        ? "ws://gmail-relay.g-spot.dev"
        : process.env.NODE_ENV === "test"
          ? "ws://gmail-relay-test.g-spot.dev"
          : process.env.NODE_ENV === "preview"
            ? "ws://gmail-relay-preview.g-spot.dev"
          : "ws://dev-proxy.g-spot.dev"
    ),
    MEMORY_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(8),
    GMAIL_RATE_LIMIT_RPS: z.coerce.number().int().min(1).max(100).default(20),
    SKILLS_API_URL: z.string().url().default("https://skills.sh"),
    EMBEDDING_MODEL: z
      .string()
      .min(1)
      .default("onnx-community/embeddinggemma-300m-ONNX"),
    // chat-sdk state store path
    CHAT_STATE_SQLITE_PATH: z.string().optional(),
    // Optional platform adapters: absent creds = adapter not registered
    SLACK_SIGNING_SECRET: z.string().optional(),
    SLACK_BOT_TOKEN: z.string().optional(),
    DISCORD_TOKEN: z.string().optional(),
    DISCORD_APPLICATION_ID: z.string().optional(),
    DISCORD_PUBLIC_KEY: z.string().optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_APP_SECRET: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
