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
        ? "ws://gmail-relay.g-spot.app"
        : process.env.NODE_ENV === "test"
          ? "ws://gmail-relay-test.g-spot.app"
          : process.env.NODE_ENV === "preview"
            ? "ws://gmail-relay-preview.g-spot.app"
          : "ws://dev-proxy.g-spot.dev"
    ),
    MEMORY_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(8),
    GMAIL_RATE_LIMIT_RPS: z.coerce.number().int().min(1).max(100).default(20),
    SKILLS_API_URL: z.string().url().default("https://skills.sh"),
    EMBEDDING_MODEL: z
      .string()
      .min(1)
      .default("onnx-community/embeddinggemma-300m-ONNX"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
