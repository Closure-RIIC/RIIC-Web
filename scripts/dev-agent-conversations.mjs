// Disposable local demo: no production database changes, account passwords or real model calls.
import { loadEnvConfig } from "./load-env.mjs";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import console from "node:console";
import { URL } from "node:url";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

loadEnvConfig(process.env.RIIC_TEST_ENV_DIR || process.cwd());
const configured = process.env.AUTH_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!configured) throw new Error("A local PostgreSQL connection is required.");
const connection = new URL(configured);
if (!["127.0.0.1", "localhost", "[::1]"].includes(connection.hostname)) throw new Error("Demo requires localhost PostgreSQL.");
const databaseName = `riic_conversations_${randomUUID().replaceAll("-", "")}_test`;
const port = Number(process.env.AGENT_ARCHIVE_DEMO_PORT || 5186);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid demo port");
const admin = new Client({ connectionString: connection.toString() });
const storage = await mkdtemp(path.join(tmpdir(), "riic-agent-archive-demo-"));
await admin.connect();
let created = false;
let child;
try {
  await admin.query(`CREATE DATABASE "${databaseName}"`); created = true;
  connection.pathname = `/${databaseName}`;
  const client = new Client({ connectionString: connection.toString() });
  await client.connect();
  try {
    await migrate(drizzle({ client }), { migrationsFolder: "drizzle" });
    for (const id of ["local-test-user", "demo-other-user"]) {
      await client.query('INSERT INTO public."user" (id,name,email,role,email_verified) VALUES ($1,$2,$3,\'user\',true)', [id, id === "local-test-user" ? "本地演示用户" : "演示用户 B", `${id}@example.invalid`]);
      const conversation = randomUUID();
      await client.query("INSERT INTO app.agent_conversation (id,user_id,client_id,title,next_sequence) VALUES ($1,$2,$3,$4,2)", [conversation, id, randomUUID(), id === "local-test-user" ? "示例：排班建议与重试记录" : "示例：其他账号的对话"]);
      for (let sequence = 1; sequence <= 2; sequence++) {
        const userMessage = { id: randomUUID(), role: "user", parts: [{ type: "text", text: "请解释一下制造站的排班思路。" }] };
        const response = { id: randomUUID(), role: "assistant", parts: [{ type: "text", text: sequence === 1 ? "先根据你的干员池筛选制造站技能，再检查轮换和宿舍恢复。此内容为本地合成示例。" : "这是第二次尝试，前一次回答仍独立保留。此内容为本地合成示例。" }] };
        await client.query(`INSERT INTO app.agent_conversation_turn (id,conversation_id,user_id,sequence,attempt_id,request_id,model,status,user_message,user_text,assistant_message,assistant_text,finished_at)
          VALUES ($1,$2,$3,$4,$5,$6,'demo/synthetic','completed',$7,$8,$9,$10,now())`, [randomUUID(), conversation, id, sequence, randomUUID(), randomUUID(), JSON.stringify(userMessage), userMessage.parts[0].text, JSON.stringify(response), response.parts[0].text]);
      }
    }
  } finally { await client.end(); }
  const origin = `http://127.0.0.1:${port}`;
  const demoEnv = { ...process.env, NODE_ENV: "development", APP_DEPLOYMENT_ENV: "local", DATABASE_URL: connection.toString(),
    BETTER_AUTH_SECRET: randomBytes(32).toString("base64"), BETTER_AUTH_URL: origin, BETA_PUBLIC_ORIGIN: origin,
    BETTER_AUTH_ADMIN_USER_IDS: "local-test-user", LOCAL_TEST_AUTO_SIGN_IN: "1", BETA_STORAGE_DIR: storage,
    AGENT_CONVERSATION_STORAGE_ENABLED: "1", AGENT_GATEWAY_ENABLED: "0", PLATFORM_API_ORIGIN: "",
    AGENT_ACCESS_MODE: "disabled", BILLING_ACCESS_MODE: "disabled", ACCOUNT_CLOUD_SYNC_ENABLED: "0" };
  for (const key of Object.keys(demoEnv)) if (key.startsWith("AGENT_LLM_") || key === "AGENT_GATEWAY_KEY") delete demoEnv[key];
  console.log(`Disposable archive demo: ${origin}/agent-archive and ${origin}/admin/agent-archive`);
  console.log("Synthetic data only; no model credentials loaded. Stop this process to remove the demo database.");
  // Bypass run-vite: its development wrapper reloads .env.local with override=true.
  child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "apps/arknights", "--config", "apps/arknights/vite.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { env: demoEnv, windowsHide: true, stdio: "inherit" });
  const stop = () => child.kill("SIGTERM");
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  process.exitCode = Number(await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", code => resolve(code ?? 0)); }));
} finally {
  if (created && /^riic_conversations_[a-f0-9]{32}_test$/.test(databaseName)) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  await admin.end();
  const resolvedStorage = path.resolve(storage);
  if (path.dirname(resolvedStorage) === path.resolve(tmpdir()) && path.basename(resolvedStorage).startsWith("riic-agent-archive-demo-")) await rm(resolvedStorage, { recursive: true, force: true });
}
