import { loadEnvConfig } from "./load-env.mjs";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import process from "node:process";
import { URL } from "node:url";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

loadEnvConfig(process.env.RIIC_TEST_ENV_DIR || process.cwd());
const configured = process.env.AUTH_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!configured) throw new Error("A localhost PostgreSQL connection is required; set RIIC_TEST_ENV_DIR to the directory containing local configuration.");
const url = new URL(configured);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Only an isolated localhost database may be created.");
const name = `riic_permissions_${randomUUID().replaceAll("-", "")}_test`;
const admin = new Client({ connectionString: url.toString() });
await admin.connect();
let created = false;
try {
  await admin.query(`CREATE DATABASE "${name}"`); created = true;
  url.pathname = `/${name}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try { await migrate(drizzle({ client }), { migrationsFolder: "drizzle" }); } finally { await client.end(); }
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-hooks.mjs", "--experimental-test-module-mocks", "--test", "apps/arknights/src/server/reviewer-role.integration.test.mjs"], {
      stdio: "inherit", env: { ...process.env, DATABASE_URL: url.toString(), AUTH_INTEGRATION_DATABASE_URL: url.toString(), AGENT_CONVERSATION_STORAGE_ENABLED: "1" },
    });
    child.once("error", reject); child.once("exit", resolve);
  });
  process.exitCode = Number(code ?? 1);
} finally {
  if (created && /^riic_permissions_[a-f0-9]{32}_test$/.test(name)) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
