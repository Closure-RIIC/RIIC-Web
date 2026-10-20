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
if (!configured) throw new Error("A local PostgreSQL connection is required.");
const url = new URL(configured);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Only an isolated localhost database may be created.");
const name = `riic_agent_${randomUUID().replaceAll("-", "")}_test`;
const admin = new Client({ connectionString: url.toString() });
await admin.connect(); let created = false;
try {
  await admin.query(`CREATE DATABASE "${name}"`); created = true; url.pathname = `/${name}`;
  const connectionString = url.toString();
  const client = new Client({ connectionString }); await client.connect();
  try { await migrate(drizzle({ client }), { migrationsFolder: "drizzle" }); } finally { await client.end(); }
  const code = await new Promise((resolve, reject) => {
    const args = process.argv.includes("--browser") ? ["node_modules/@playwright/test/cli.js","test","--config=playwright.agent-billing.config.ts"]
      : ["--experimental-transform-types", "--test", "apps/arknights/src/server/billing/agent-accounting.integration.test.mjs", "apps/arknights/src/server/billing/cdk.integration.test.mjs"];
    const child = spawn(process.execPath, args, {
      stdio: "inherit", env: { ...process.env, DATABASE_URL: connectionString, AUTH_INTEGRATION_DATABASE_URL: connectionString },
    }); child.once("error", reject); child.once("exit", resolve);
  }); process.exitCode = Number(code ?? 1);
} finally {
  if (created && /^riic_agent_[a-f0-9]{32}_test$/.test(name)) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
