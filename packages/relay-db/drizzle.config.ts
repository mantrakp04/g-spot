import { getRelayDrizzleDbCredentials } from "@g-spot/env/relay";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "sqlite",
  dbCredentials: getRelayDrizzleDbCredentials(),
});
