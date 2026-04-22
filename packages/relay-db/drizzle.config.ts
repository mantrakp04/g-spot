import { getRelayDrizzleDbCredentials } from "@g-spot/env/relay";
import { defineConfig } from "drizzle-kit";

const { url, authToken, isRemoteLibsql } = getRelayDrizzleDbCredentials();

export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: isRemoteLibsql ? "turso" : "sqlite",
  dbCredentials: isRemoteLibsql
    ? { url, ...(authToken ? { authToken } : {}) }
    : { url },
});
