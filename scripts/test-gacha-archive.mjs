import nextEnv from "@next/env";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import process from "node:process";
import { URL } from "node:url";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

nextEnv.loadEnvConfig(process.cwd());
const configured = process.env.AUTH_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!configured) throw new Error("A local PostgreSQL connection is required.");
const url = new URL(configured);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("This test runner only creates isolated databases on localhost.");
const name = `riic_gacha_test_${randomUUID().replaceAll("-", "")}`;
const admin = new Client({ connectionString: url.toString() });
await admin.connect();
let created = false;
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  url.pathname = `/${name}`;
  const isolatedUrl = url.toString();
  const client = new Client({ connectionString: isolatedUrl });
  await client.connect();
  try { await migrate(drizzle({ client }), { migrationsFolder: "drizzle" }); }
  finally { await client.end(); }
  const status = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--test", "--experimental-strip-types", "--experimental-test-module-mocks", "--import", "./scripts/register-hooks.mjs",
      "src/server/gacha-archive.integration.test.mjs", "src/server/gacha-archive-api.test.ts", "src/server/gacha-archive-validation.test.ts",
      "src/server/gacha-skland-api.test.ts", "src/server/gacha-skland-authorization.test.ts"], {
      stdio: "inherit", env: { ...process.env, DATABASE_URL: isolatedUrl, AUTH_INTEGRATION_DATABASE_URL: isolatedUrl },
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  process.exitCode = status;
} finally {
  if (created && /^riic_gacha_test_[a-f0-9]{32}$/.test(name)) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
