import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    CORS_ORIGIN: z.url(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    STACK_PROJECT_ID: z.string().min(1),
    STACK_SECRET_SERVER_KEY: z.string().min(1),
    OPENAI_CLIENT_ID: z
      .string()
      .default("app_EMoamEEZ73f0CkXaXp7hrann"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
