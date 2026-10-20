import { loadEnvConfig } from "./load-env.mjs";
import { Pool } from "pg";

import { requireAuthBaseUrl, requireAuthSecret } from "../apps/arknights/src/server/auth/config.ts";
import { requireAuthEmailConfig } from "../apps/arknights/src/server/auth/email-config.ts";


loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required for authentication readiness checks.");
requireAuthSecret();
requireAuthBaseUrl();
requireAuthEmailConfig();

const expectedTables = ["account", "rateLimit", "session", "skland_binding", "user", "verification"];
const expectedBusinessTables = [
  "feedback",
  "feedback_event",
  "operbox_snapshot",
  "plan_cache",
  "plan_cache_reference",
  "plan_run",
  "plan_task",
  "plan_worker_heartbeat",
  "policy_consent",
  "saved_plan",
  "telemetry_event",
  "user_workspace",
  "workspace_revision",
];
function secretBytes(value: string): number {
  return value.startsWith("base64:") ? Buffer.from(value.slice(7), "base64").byteLength : Buffer.byteLength(value);
}
const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 5_000,
  query_timeout: 10_000,
  statement_timeout: 10_000,
});

try {
  const result = await pool.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
    [expectedTables],
  );
  const found = new Set(result.rows.map((row) => row.table_name));
  const missing = expectedTables.filter((table) => !found.has(table));
  if (missing.length > 0) throw new Error(`Authentication database is missing committed tables: ${missing.join(", ")}`);
  const businessResult = await pool.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'app' AND table_name = ANY($1::text[])",
    [expectedBusinessTables],
  );
  const businessFound = new Set(businessResult.rows.map((row) => row.table_name));
  const missingBusiness = expectedBusinessTables.filter((table) => !businessFound.has(table));
  if (missingBusiness.length > 0) throw new Error(`Business database is missing committed tables: ${missingBusiness.join(", ")}`);
  if (process.env.PLAN_TASK_QUEUE_ENABLED === "1" && process.env.BETA_BUSINESS_DB_ENABLED !== "1") {
    throw new Error("PLAN_TASK_QUEUE_ENABLED requires BETA_BUSINESS_DB_ENABLED=1.");
  }
  if (process.env.ACCOUNT_CLOUD_SYNC_ENABLED === "1" || process.env.PLAN_TASK_QUEUE_ENABLED === "1") {
    const active = process.env.WORKSPACE_ACTIVE_KEY_VERSION?.trim();
    const raw = process.env.WORKSPACE_MASTER_KEYS?.trim();
    if (!active || !raw) throw new Error("Cloud sync and task encryption require versioned workspace encryption keys.");
    const keys = JSON.parse(raw) as Record<string, unknown>;
    const activeKey = keys[active];
    if (typeof activeKey !== "string") throw new Error("The active workspace encryption key version is unavailable.");
    if (secretBytes(activeKey) !== 32) throw new Error("The active workspace encryption key must contain exactly 32 bytes.");
  }
  if (process.env.PLAN_CACHE_ENABLED === "1" || process.env.PLAN_TASK_QUEUE_ENABLED === "1") {
    const key = process.env.PLAN_CACHE_HMAC_KEY?.trim() ?? "";
    if (secretBytes(key) < 32) throw new Error("PLAN_CACHE_HMAC_KEY must contain at least 32 bytes.");
  }
  console.log("Authentication and business-data runtime readiness check passed.");
} finally {
  await pool.end();
}
