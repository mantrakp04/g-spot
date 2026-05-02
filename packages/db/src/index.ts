import { env } from "@g-spot/env/server";
import type { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

import { runMigrations } from "./migrate";
import { openNativeDb, resolveDbFilePath } from "./native-sqlite";
import * as schema from "./schema";

runMigrations();

const client: Database = openNativeDb(resolveDbFilePath(env.DATABASE_URL));

export function createDb() {
  return drizzle(client, { schema });
}

export const db = createDb();
export { client };
