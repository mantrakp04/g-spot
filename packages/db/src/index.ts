import { env } from "@g-spot/env/server";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "./schema";

const client = createClient({
  url: env.DATABASE_URL,
});

export function createDb() {
  return drizzle({ client, schema });
}

export const db = createDb();
export { client };
