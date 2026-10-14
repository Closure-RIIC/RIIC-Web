import { loadEnvConfig } from "./load-env.mjs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";


const ONLINE_PLAN_TASK_INDEX_MANIFEST_VERSION = 1;
const MIGRATION_ADVISORY_LOCK_NAME = "riic-web:migrate-db:v1";
const onlinePlanTaskIndexes = [
  {
    name: "plan_task_active_expires_idx",
    columns: ["status", "expires_at"],
  },
  {
    name: "plan_task_account_active_idx",
    columns: ["account_class", "status", "expires_at"],
  },
  {
    name: "plan_task_ip_active_idx",
    columns: ["request_ip_hmac", "status", "expires_at"],
  },
] as const;

function normalizeIndexDefinition(value: string): string {
  return value.replaceAll('"', "").replace(/\s+/g, " ").trim().toLowerCase();
}

function onlineIndexSql(index: typeof onlinePlanTaskIndexes[number]) {
  const columns = index.columns.map((column) => `"${column}"`).join(",");
  return {
    create: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${index.name}" ON "app"."plan_task" USING btree (${columns})`,
    drop: `DROP INDEX CONCURRENTLY IF EXISTS "app"."${index.name}"`,
    expected: normalizeIndexDefinition(
      `CREATE INDEX ${index.name} ON app.plan_task USING btree (${index.columns.join(", ")})`,
    ),
  };
}

async function ensureOnlinePlanTaskIndexes(client: PoolClient): Promise<void> {
  await client.query("SET statement_timeout = 0");
  await client.query("SET lock_timeout = '5s'");
  for (const index of onlinePlanTaskIndexes) {
    const sql = onlineIndexSql(index);
    const existing = await client.query<{ valid: boolean; definition: string }>(
      `SELECT pg_index.indisvalid AS valid, pg_get_indexdef(pg_index.indexrelid) AS definition
       FROM pg_index
       JOIN pg_class ON pg_class.oid = pg_index.indexrelid
       JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
       WHERE pg_namespace.nspname = 'app' AND pg_class.relname = $1`,
      [index.name],
    );
    const current = existing.rows[0];
    if (current && (!current.valid || normalizeIndexDefinition(current.definition) !== sql.expected)) {
      await client.query(sql.drop);
    }
    await client.query(sql.create);
    const verified = await client.query<{ valid: boolean; definition: string }>(
      `SELECT pg_index.indisvalid AS valid, pg_get_indexdef(pg_index.indexrelid) AS definition
       FROM pg_index
       JOIN pg_class ON pg_class.oid = pg_index.indexrelid
       JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
       WHERE pg_namespace.nspname = 'app' AND pg_class.relname = $1`,
      [index.name],
    );
    const installed = verified.rows[0];
    if (
      installed?.valid !== true
      || normalizeIndexDefinition(installed.definition) !== sql.expected
    ) {
      throw new Error(`Online index manifest v${ONLINE_PLAN_TASK_INDEX_MANIFEST_VERSION} did not install ${index.name}.`);
    }
  }
}

loadEnvConfig(process.cwd());
const url = process.env.DATABASE_MIGRATION_URL?.trim();
if (!url) throw new Error("DATABASE_MIGRATION_URL is required to run committed migrations.");
const pool = new Pool({ connectionString: url, max: 1 });
const client = await pool.connect();
let migrationLockHeld = false;
try {
  await client.query("SELECT pg_advisory_lock(hashtext($1))", [MIGRATION_ADVISORY_LOCK_NAME]);
  migrationLockHeld = true;
  await client.query("SET lock_timeout = '5s'");
  await client.query("SET statement_timeout = '5min'");
  await migrate(drizzle({ client }), { migrationsFolder: "drizzle" });
  await ensureOnlinePlanTaskIndexes(client);
  const runtimeUrl = process.env.DATABASE_URL?.trim();
  if (runtimeUrl) {
    const runtimeRole = decodeURIComponent(new URL(runtimeUrl).username);
    if (!runtimeRole) throw new Error("DATABASE_URL must include the runtime role name.");
    const role = `"${runtimeRole.replaceAll('"', '""')}"`;
    await client.query(`GRANT USAGE ON SCHEMA app TO ${role}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO ${role}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO ${role}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO ${role}`);
  }
  console.log("Committed database migrations applied.");
} finally {
  if (migrationLockHeld) {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [MIGRATION_ADVISORY_LOCK_NAME]).catch(() => undefined);
  }
  client.release();
  await pool.end();
}
