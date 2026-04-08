import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const serverConfig = createEnv({
  server: {
    SERVER_HOST: z.string().min(1).default("localhost"),
    SERVER_PORT: z.number().default(3000),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
})

export const env = createEnv({
  extends: [serverConfig],
  server: {
    DATABASE_URL: z.string().min(1),
    CORS_ORIGIN: z.url(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    STACK_PROJECT_ID: z.string().min(1),
    STACK_SECRET_SERVER_KEY: z.string().min(1),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
