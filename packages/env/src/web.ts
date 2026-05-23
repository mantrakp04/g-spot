import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { devUrls } from "./dev-ports";

const clientEnv = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_SERVER_URL: z.url().default(devUrls.server),
    VITE_STACK_PROJECT_ID: z.string().min(1).default("528293a9-a93a-4511-92a9-0df356161cc7"),
  },
  runtimeEnv: (import.meta as any).env,
  emptyStringAsUndefined: true,
});

export const env = {
  ...clientEnv,
  DEV: import.meta.env.DEV,
  PROD: import.meta.env.PROD,
  MODE: import.meta.env.MODE,
} as const;
