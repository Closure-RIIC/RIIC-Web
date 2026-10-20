import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.ts";

type Database = NodePgDatabase<typeof schema>;
const state = globalThis as typeof globalThis & { __aicPool?: Pool; __aicDb?: Database };

function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required for authentication requests.");
  return value;
}

export function getDatabase(): Database {
  if (state.__aicDb) return state.__aicDb;
  const pool = new Pool({
    connectionString: databaseUrl(),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    query_timeout: 10_000,
    statement_timeout: 10_000,
  });
  pool.on("error", () => {
    console.error(JSON.stringify({ level: "error", event: "authentication_database_pool_error" }));
  });
  state.__aicPool = pool;
  state.__aicDb = drizzle({ client: pool, schema });
  return state.__aicDb;
}

export function getDatabasePool(): Pool {
  getDatabase();
  if (!state.__aicPool) throw new Error("Database pool was not initialized.");
  return state.__aicPool;
}
