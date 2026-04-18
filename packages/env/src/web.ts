import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const clientEnv = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_SERVER_URL: z.url(),
    VITE_STACK_PROJECT_ID: z.string().min(1),
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
