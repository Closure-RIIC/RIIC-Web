// Opt-in live-model exercise. Creates only a disposable localhost database.
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { register, registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readUIMessageStream } from "ai";
import { loadEnvConfig } from "./load-env.mjs";

const { fetch, AbortSignal, ReadableStream } = globalThis;
const verifyDirectory = process.env.RIIC_LIVE_VERIFY_OUTPUT ? path.resolve(process.env.RIIC_LIVE_VERIFY_OUTPUT) : null;
if (!verifyDirectory && process.env.RIIC_LIVE_AGENT_TEST !== "1") throw new Error("Set RIIC_LIVE_AGENT_TEST=1 to opt in to 50 real model turns and token charges.");
loadEnvConfig(process.env.RIIC_TEST_ENV_DIR || process.cwd());
register("./ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) {
  return ["server-only", "@tanstack/react-start/server-only"].includes(specifier)
    ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context);
} });
const { parseResourcePolicy } = await import("../apps/arknights/src/server/agent/resource-policy.ts");
const { DEFAULT_AGENT_SYSTEM_PROMPT } = await import("../apps/arknights/src/server/agent/persona.ts");

const originalPlan = verifyDirectory ? JSON.parse(await readFile(path.join(verifyDirectory, "plan.json"), "utf8")) : null;
const vaultPath = process.env.RIIC_LIVE_KB_DIR || originalPlan?.vault;
if (!vaultPath) throw new Error("Set RIIC_LIVE_KB_DIR to the knowledge vault used for these questions.");
const vault = path.resolve(vaultPath);
const seed = Number(process.env.RIIC_LIVE_TEST_SEED || originalPlan?.seed || 20261109);
let randomState = seed >>> 0;
const random = () => { randomState += 0x6D2B79F5; let n = randomState; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
const shuffle = items => { const out = [...items]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; };
const calibrated = [4, 25, 41, 60, 50, 35, 58, 66, 56, 67, 16, 53];
const questionSource = "meta/mirror/bilibili_comments_questions_split.md";
const questionText = await readFile(path.join(vault, questionSource), "utf8");
const questions = [...questionText.matchAll(/^\*\*(\d+)\.\*\*\s+(.+)$/gm)].map(m => ({ number: Number(m[1]), text: m[2].trim(), source: questionSource, referenceSample: calibrated.includes(Number(m[1])) }));
assert.equal(questions.length, 82);
const selected = shuffle([...questions.filter(q => q.referenceSample), ...shuffle(questions.filter(q => !q.referenceSample)).slice(0, 38)]);
assert.equal(new Set(selected.map(q => q.number)).size, 50);
const quotas = shuffle([11, 9, 7, 6, 5, 4, 3, 2, 2, 1]);
let cursor = 0;
const users = quotas.map((quota, i) => {
  const frequency = quota >= 9 ? "high" : quota >= 4 ? "normal" : "low";
  const item = { id: `live-qa-${String(i + 1).padStart(2, "0")}`, quota, frequency,
    role: i === 1 ? "admin" : "user", superAdmin: i === 0, questions: selected.slice(cursor, cursor + quota),
    delayRangeMs: frequency === "high" ? [200, 800] : frequency === "normal" ? [1500, 3000] : [12000, 18000] };
  cursor += quota; return item;
});
if (originalPlan) assert.deepEqual(originalPlan.users, users, "Verification must use the original seed and question allocation");
const runId = originalPlan?.runId || new Date().toISOString().replaceAll(/[:.]/g, "-");
const output = verifyDirectory || path.resolve("output", "agent-archive", `live-${runId}`);
await mkdir(output, { recursive: true });
const saveJson = (name, value) => writeFile(path.join(output, name), JSON.stringify(value, null, 2), "utf8");
const sourceFiles = [];
async function walk(directory) {
  for (const entry of (await readdir(path.join(vault, directory), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await walk(relative);
    else if (entry.name.endsWith(".md")) sourceFiles.push({ path: relative, content: await readFile(path.join(vault, relative), "utf8") });
  }
}
await walk("docs");
for (const filename of ["index/标题清单.md", "index/消歧字典.json"]) sourceFiles.push({ path: filename, content: await readFile(path.join(vault, filename), "utf8") });
const manifest = JSON.parse(await readFile(path.join(vault, "skill/manifest.json"), "utf8"));
const skills = await Promise.all(manifest.skills.map(async item => ({ id: item.id, title: item.title, purpose: item.purpose, enabled: true, content: await readFile(path.join(vault, item.path), "utf8") })));
const knowledgeVersion = createHash("sha256").update(JSON.stringify(sourceFiles)).digest("hex");
const policy = parseResourcePolicy({ schema: 1, systemPrompt: DEFAULT_AGENT_SYSTEM_PROMPT,
  defaultPersona: process.env.AGENT_PERSONA_CARD ? await readFile(process.env.AGENT_PERSONA_CARD, "utf8") : "基建助理，以准确、简洁的中文回答。",
  personas: [], knowledge: { version: knowledgeVersion, policy: await readFile(path.join(vault, "meta/agent/KNOWLEDGE_RULES.md"), "utf8"), files: sourceFiles }, skills });
if (!verifyDirectory) await saveJson("plan.json", { runId, seed, total: 50, vault, knowledgeVersion, knowledgeFiles: sourceFiles.length, model: process.env.AGENT_LLM_MODEL,
  mode: "local direct model route; real sessions; no account passwords; isolated PostgreSQL", maxConcurrency: 3, users });

const configured = process.env.AUTH_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!configured) throw new Error("Local PostgreSQL connection required.");
const connection = new URL(configured);
if (!["127.0.0.1", "localhost", "[::1]"].includes(connection.hostname)) throw new Error("Only localhost databases are allowed.");
const databaseName = `riic_conversations_${randomUUID().replaceAll("-", "")}_test`;
const port = Number(process.env.RIIC_LIVE_TEST_PORT || 5187);
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
const origin = `http://127.0.0.1:${port}`;
const secret = randomBytes(32).toString("base64");
const cookies = new Map();
const admin = new Client({ connectionString: connection.toString() });
await admin.connect();
let created = false;
let child;
let client;
const storage = await mkdtemp(path.join(tmpdir(), "riic-agent-live-"));
const serverLog = createWriteStream(path.join(output, verifyDirectory ? "verification-server.log" : "server.log"));
const results = [];
if (verifyDirectory) {
  for (const filename of (await readdir(output)).filter(f => /^turn-live-qa-\d{2}-\d{2}\.json$/.test(f)).sort()) {
    const item = JSON.parse(await readFile(path.join(output, filename), "utf8"));
    let reconstructed;
    for await (const message of readUIMessageStream({ stream: new ReadableStream({ start(controller) { for (const chunk of item.chunks) controller.enqueue(chunk); controller.close(); } }) })) reconstructed = message;
    assert.deepEqual(JSON.parse(JSON.stringify(reconstructed)), item.assistantMessage, "Stored client message must match reconstruction from original stream chunks");
    // Match the store's documented text projection; the exact original parts remain untouched.
    item.assistantText = item.assistantMessage.parts.filter(p => p.type === "text").map(p => p.text).join("\n");
    results.push(item);
  }
  assert.equal(results.length, 50, "Verification never creates additional model turns");
}
const startedAt = verifyDirectory ? results.map(r => r.startedAt).sort()[0] : new Date().toISOString();
let checked = false;
try {
  await admin.query(`CREATE DATABASE "${databaseName}"`); created = true;
  connection.pathname = `/${databaseName}`;
  client = new Client({ connectionString: connection.toString() });
  await client.connect();
  await migrate(drizzle({ client }), { migrationsFolder: "drizzle" });
  await client.query("INSERT INTO app.agent_policy_version (id,kind,version,status,payload,published_at) VALUES ($1,'resources',1,'active',$2,now())", [`live-resources-${runId}`, JSON.stringify(policy)]);
  for (const user of users) {
    await client.query('INSERT INTO public."user" (id,name,email,role,email_verified) VALUES ($1,$2,$3,$4,true)', [user.id, `测试账号 ${user.id.slice(-2)}`, `${user.id}@example.invalid`, user.role]);
    await client.query("INSERT INTO app.billing_wallet (user_id,paid_points) VALUES ($1,100000)", [user.id]);
    const token = randomBytes(32).toString("hex");
    await client.query("INSERT INTO public.session (id,user_id,token,expires_at) VALUES ($1,$2,$3,now()+interval '4 hours')", [randomUUID(), user.id, token]);
    const signature = createHmac("sha256", secret).update(token).digest("base64");
    cookies.set(user.id, `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`);
  }
  assert.equal(Number((await client.query('SELECT count(*) FROM public.account')).rows[0].count), 0);
  if (verifyDirectory) {
    const conversations = JSON.parse(await readFile(path.join(output, "database-conversations.json"), "utf8"));
    const turns = JSON.parse(await readFile(path.join(output, "database-turns.json"), "utf8"));
    assert.equal(turns.length, 50);
    await client.query("INSERT INTO app.agent_conversation SELECT * FROM jsonb_populate_recordset(NULL::app.agent_conversation,$1::jsonb)", [JSON.stringify(conversations)]);
    await client.query("INSERT INTO app.agent_conversation_turn SELECT * FROM jsonb_populate_recordset(NULL::app.agent_conversation_turn,$1::jsonb)", [JSON.stringify(turns)]);
  }
  const env = { ...process.env, NODE_ENV: "development", APP_DEPLOYMENT_ENV: "local", DATABASE_URL: connection.toString(),
    BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: origin, BETA_PUBLIC_ORIGIN: origin, BETTER_AUTH_ADMIN_USER_IDS: users[0].id,
    PLATFORM_API_ORIGIN: "", PLATFORM_PUBLIC_ORIGINS: "", LOCAL_TEST_AUTO_SIGN_IN: "0", BETA_STORAGE_DIR: storage,
    AUTH_COOKIE_DOMAIN: "", AGENT_ACCESS_MODE: verifyDirectory ? "disabled" : "public", BILLING_ACCESS_MODE: "disabled", ACCOUNT_CLOUD_SYNC_ENABLED: "0", AGENT_GATEWAY_ENABLED: "0",
    AGENT_CONVERSATION_STORAGE_ENABLED: "1", AGENT_KB_DIR: vault };
  if (verifyDirectory) for (const key of Object.keys(env)) if (key.startsWith("AGENT_LLM_") || key === "AGENT_GATEWAY_KEY") delete env[key];
  child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "apps/arknights", "--config", "apps/arknights/vite.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(serverLog, { end: false }); child.stderr.pipe(serverLog, { end: false });
  const stop = () => child?.kill("SIGTERM");
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  async function request(user, endpoint, options = {}) {
    return fetch(`${origin}${endpoint}`, { ...options, headers: { cookie: cookies.get(user.id), origin, ...options.headers }, signal: options.signal || AbortSignal.timeout(700_000) });
  }
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error("Vite exited; inspect server.log.");
    try { const response = await request(users[0], "/api/agent/archive?action=access", { signal: AbortSignal.timeout(5000) }); if (response.ok) { ready = true; break; } } catch { /* startup */ }
    await delay(1000);
  }
  assert.ok(ready, "Service did not become ready");
  for (const user of users) {
    const response = await request(user, "/api/agent/archive?action=access");
    assert.equal(response.status, 200); const access = await response.json();
    assert.equal(access.userId, user.id); assert.equal(access.canManageAll, user.superAdmin);
  }
  console.log(JSON.stringify({ event: "ready", origin, output, model: process.env.AGENT_LLM_MODEL, knowledgeFiles: sourceFiles.length, accounts: users.map(({ id, quota, frequency }) => ({ id, quota, frequency })) }));

  // One account never overlaps its own requests. Three accounts may generate concurrently.
  let active = 0;
  const queue = [];
  async function withSlot(fn) {
    if (active >= 3) await new Promise(resolve => queue.push(resolve)); else active++;
    try { return await fn(); } finally { if (queue.length) queue.shift()(); else active--; }
  }
  const histories = new Map();
  const conversations = new Map();
  async function ask(user, index) {
    if (index % 3 === 0) { histories.set(user.id, []); conversations.set(user.id, randomUUID()); }
    const question = user.questions[index];
    const message = { id: randomUUID(), role: "user", parts: [{ type: "text", text: `${question.text}\n\n请依据知识库回答；本轮仅问答，不执行排班求解或写入操作。` }] };
    const history = histories.get(user.id);
    const item = { userId: user.id, ordinal: index + 1, question, conversationId: conversations.get(user.id), attemptId: randomUUID(), userMessage: message, startedAt: new Date().toISOString(), chunks: [], errors: [] };
    try {
      const response = await request(user, "/api/agent/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: item.conversationId, attemptId: item.attemptId, messages: [...history, message] }) });
      item.httpStatus = response.status; item.requestId = response.headers.get("x-request-id"); item.resourceVersion = response.headers.get("x-agent-resource-version");
      if (!response.ok) { item.errors.push((await response.text()).slice(0, 4000)); }
      else {
        // Persist all SSE JSON chunks and reconstruct the browser SDK's UI message.
        const raw = await response.text();
        item.chunks = raw.split(/\r?\n/).filter(line => line.startsWith("data: ") && line !== "data: [DONE]").map(line => JSON.parse(line.slice(6)));
        item.errors.push(...item.chunks.filter(c => c.type === "error").map(c => c.errorText));
        const chunks = item.chunks;
        for await (const value of readUIMessageStream({ stream: new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }), onError(error) { item.errors.push(String(error)); } })) item.assistantMessage = value;
        item.archive = chunks.findLast(c => c.type === "data-agent-archive")?.data;
        item.assistantText = (item.assistantMessage?.parts || []).filter(p => p.type === "text").map(p => p.text).join("\n");
        history.push(message);
        if (item.assistantMessage && item.errors.length === 0) history.push(item.assistantMessage);
      }
    } catch (error) { item.errors.push(error instanceof Error ? error.message : String(error)); }
    item.finishedAt = new Date().toISOString(); item.durationMs = Date.parse(item.finishedAt) - Date.parse(item.startedAt);
    results.push(item);
    const done = results.length;
    await saveJson(`turn-${user.id}-${String(index + 1).padStart(2, "0")}.json`, item);
    console.log(JSON.stringify({ event: "turn", done, userId: user.id, question: question.number, status: item.httpStatus, archive: item.archive, chars: item.assistantText?.length || 0, durationMs: item.durationMs, errors: item.errors }));
    return item;
  }
  // First real request counts toward the requested 50, and must establish the entire path.
  if (!verifyDirectory) {
  const first = await withSlot(() => ask(users[0], 0));
  assert.equal(first.httpStatus, 200, "First real turn failed");
  assert.equal(first.errors.length, 0, "First real turn has stream errors");
  assert.equal(first.archive?.status, "saved");
  assert.ok(first.assistantText?.trim());
  await Promise.all(users.map(async (user, n) => {
    for (let index = n === 0 ? 1 : 0; index < user.quota; index++) {
      if (index > 0) await delay(Math.round(user.delayRangeMs[0] + random() * (user.delayRangeMs[1] - user.delayRangeMs[0])));
      await withSlot(() => ask(user, index));
    }
  }));
  }

  const turns = (await client.query("SELECT * FROM app.agent_conversation_turn ORDER BY created_at,id")).rows;
  if (!verifyDirectory) {
    // Save evidence before assertions, so a verifier failure never discards successful paid turns.
    await saveJson("database-turns.json", turns);
    await saveJson("database-conversations.json", (await client.query("SELECT * FROM app.agent_conversation ORDER BY created_at,id")).rows);
    await saveJson("usage.json", (await client.query("SELECT user_id,run_id,status,input_tokens,output_tokens,cached_input_tokens,points,metadata FROM app.agent_usage ORDER BY created_at")).rows);
  }
  assert.equal(results.length, 50); assert.equal(turns.length, 50);
  for (const item of results) {
    const turn = turns.find(t => t.attempt_id === item.attemptId);
    assert.ok(turn); assert.equal(turn.user_id, item.userId); assert.equal(turn.request_id, item.requestId);
    assert.deepEqual(turn.user_message, item.userMessage);
    assert.equal(turn.assistant_text, item.assistantText || "");
    if (item.assistantMessage) {
      assert.equal(turn.assistant_message.role, "assistant"); assert.equal(turn.assistant_message.id, item.assistantMessage.id);
      const meaningful = message => message.parts.filter(p => p.type !== "data-agent-archive");
      assert.deepEqual(meaningful(turn.assistant_message), meaningful(item.assistantMessage));
    }
    assert.notEqual(turn.status, "streaming");
  }
  const duplicated = (await client.query("SELECT conversation_id,sequence FROM app.agent_conversation_turn GROUP BY 1,2 HAVING count(*)>1")).rows;
  assert.equal(duplicated.length, 0);
  const isolation = [];
  for (const user of users) {
    const response = await request(user, "/api/agent/archive"); assert.equal(response.status, 200);
    const body = await response.json(); assert.ok(body.items.length > 0);
    assert.ok(body.items.every(row => row.userId === user.id));
    const detail = await request(user, `/api/agent/archive?action=detail&id=${body.items[0].id}`);
    assert.equal(detail.status, 200);
    const own = await detail.json(); assert.ok(own.turns.length > 0);
    for (const turn of own.turns) {
      assert.equal(turn.userId, user.id);
      const original = turns.find(t => t.id === turn.id); assert.ok(original);
      assert.deepEqual(turn.userMessage, original.user_message); assert.deepEqual(turn.assistantMessage, original.assistant_message);
    }
    const other = turns.find(t => t.user_id !== user.id);
    const denied = await request(user, `/api/agent/archive?action=detail&id=${other.conversation_id}`);
    assert.ok(denied.status >= 400);
    const all = await request(user, "/api/agent/archive?scope=all");
    assert.equal(all.status, user.superAdmin ? 200 : 403);
    if (!user.superAdmin) {
      const exp = await request(user, "/api/agent/archive?action=export&scope=all", { method: "POST" }); assert.equal(exp.status, 403);
    }
    isolation.push({ userId: user.id, ownList: response.status, ownDetail: detail.status, crossUserDetail: denied.status, allList: all.status });
  }
  const ownExport = await request(users[1], "/api/agent/archive?action=export&format=json", { method: "POST" });
  assert.equal(ownExport.status, 403);
  const exported = {};
  for (const format of ["json", "jsonl"]) {
    const response = await request(users[0], `/api/agent/archive?action=export&scope=all&format=${format}`, { method: "POST" });
    assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/);
    const text = await response.text(); await writeFile(path.join(output, `all-conversations.${format}`), text, "utf8");
    const data = format === "json" ? JSON.parse(text) : text.trim().split("\n").map(line => JSON.parse(line));
    const records = format === "json" ? data.turns : data.filter(row => row.type === "turn");
    const completion = format === "json" ? data.completion : data.at(-1);
    assert.equal(completion.complete, true); assert.equal(completion.recordCount, 50); assert.equal(records.length, 50);
    assert.deepEqual(new Set(records.map(r => r.attemptId)), new Set(results.map(r => r.attemptId)));
    for (const item of records) {
      const original = turns.find(t => t.attempt_id === item.attemptId);
      assert.deepEqual(item.userMessage, original.user_message); assert.deepEqual(item.assistantMessage, original.assistant_message);
    }
    exported[format] = { recordCount: records.length, complete: completion.complete };
  }
  const usage = verifyDirectory ? JSON.parse(await readFile(path.join(output, "usage.json"), "utf8")) : (await client.query("SELECT user_id,run_id,status,input_tokens,output_tokens,cached_input_tokens,points,metadata FROM app.agent_usage ORDER BY created_at")).rows;
  const audits = (await client.query("SELECT * FROM app.agent_conversation_audit ORDER BY created_at")).rows;
  await saveJson("usage.json", usage); await saveJson("audit.json", audits);
  const stats = users.map(user => {
    const items = results.filter(r => r.userId === user.id).sort((a,b) => a.startedAt.localeCompare(b.startedAt));
    const starts = items.slice(1).map((r,i) => Date.parse(r.startedAt) - Date.parse(items[i].startedAt));
    const idle = items.slice(1).map((r,i) => Date.parse(r.startedAt) - Date.parse(items[i].finishedAt));
    return { userId: user.id, role: user.role, superAdmin: user.superAdmin, frequency: user.frequency, planned: user.quota, actual: items.length,
      completed: turns.filter(t => t.user_id === user.id && t.status === "completed").length,
      sessions: new Set(items.map(r => r.conversationId)).size, delayRangeMs: user.delayRangeMs,
      meanStartIntervalMs: starts.length ? Math.round(starts.reduce((a,b) => a+b,0)/starts.length) : null,
      meanActualIdleMs: idle.length ? Math.round(idle.reduce((a,b) => a+b,0)/idle.length) : null };
  });
  const summary = { runId, startedAt, finishedAt: results.map(r => r.finishedAt).sort().at(-1), verifiedAt: new Date().toISOString(), restoredSnapshotVerification: Boolean(verifyDirectory), seed, total: results.length, databaseTurns: turns.length,
    completed: turns.filter(t => t.status === "completed").length, errors: results.filter(r => r.errors.length > 0).length,
    conversations: new Set(turns.map(t => t.conversation_id)).size, model: process.env.AGENT_LLM_MODEL, knowledgeVersion, stats,
    usage: { source: usage.every(r => r.source === "original agent_finish event") ? "original server finish events matched by request ID" : "database agent_usage snapshot", records: usage.length, inputTokens: usage.reduce((n,r) => n+Number(r.input_tokens||0),0), outputTokens: usage.reduce((n,r) => n+Number(r.output_tokens||0),0), cachedInputTokens: usage.reduce((n,r) => n+Number(r.cached_input_tokens||0),0), testPoints: usage.some(r => r.points == null) ? null : usage.reduce((n,r) => n+Number(r.points||0),0) },
    verification: { exactUserMessages: 50, exactAssistantText: 50, structuredAssistantParts: true, originalStreamReconstruction: Boolean(verifyDirectory), sequenceUnique: true, isolation, ordinaryAdminOwnExport: ownExport.status, exported, auditRecords: audits.length, accountPasswordRecords: 0 },
    limits: ["本地真实模型直连路径，未测试远端部署或网关。", "实际提问频率也受模型耗时和并发上限 3 影响。", "参考答案含草稿，本轮未对全部回答作准确率评分。", "未执行生产构建或生产规模压力测试。", ...(verifyDirectory ? ["原轮 50 次均真实生成且入库；末尾校验脚本漏拼文本片段之间的换行而失败。已保留原始流与数据库快照，修正脚本后从原始快照恢复到另一隔离库完成逐条比对和 HTTP 权限/导出验证；没有增加模型问答。计费用量来自原服务 finish 事件，未保留原计费表。"] : [])] };
  await saveJson("summary.json", summary);
  const markdown = ["# 10 账号 50 次真实 Agent 问答测试", "", `时间：${startedAt} ～ ${summary.finishedAt}`, `模型：${summary.model}；本地隔离 PostgreSQL；随机种子 ${seed}。`, "", `共 ${summary.total} 次请求，${summary.completed} 次 completed，${summary.errors} 次含错误；${summary.conversations} 个会话。`, "", "| 账号 | 计划/实际 | 频率组 | 设定间隔 | 实际平均发起间隔 |", "| --- | --- | --- | --- | --- |", ...stats.map(s => `| ${s.userId} | ${s.planned}/${s.actual} | ${s.frequency} | ${s.delayRangeMs.map(n=>n/1000).join("～")} 秒 | ${s.meanStartIntervalMs === null ? "单次" : `${(s.meanStartIntervalMs/1000).toFixed(1)} 秒`} |`), "", `输入 ${summary.usage.inputTokens}、输出 ${summary.usage.outputTokens} Token（含工具步骤及历史）；其中缓存输入 ${summary.usage.cachedInputTokens}。积分为隔离库中的测试积分。`, "", "双方消息逐条比对、账号归属与编号、10 账号隔离、普通管理员禁止全站导出、超级管理员 JSON/JSONL 各 50 条且有 completion：均通过。", "", ...summary.limits.map(s=>`- ${s}`), "", "## 完整问答", "", ...results.sort((a,b)=>a.startedAt.localeCompare(b.startedAt)).flatMap((r,i)=>[`### ${i+1}. ${r.userId} · 原题 ${r.question.number}`, "", `来源：${questionSource}，参考样例：${r.question.referenceSample ? "是" : "否"}。`, `发送 ${r.startedAt}；结束 ${r.finishedAt}；attempt ${r.attemptId}。`, "", `**用户：** ${r.question.text}`, "", "**Agent：**", "", r.assistantText || "（没有正文）", "", ...(r.errors.length ? [`错误：${r.errors.join("；")}`, ""] : [])])].join("\n");
  await writeFile(path.join(output, "report.md"), markdown, "utf8");
  checked = true;
  console.log(JSON.stringify({ event: "verified", output, total: summary.total, completed: summary.completed, errors: summary.errors, tokens: summary.usage }));
} finally {
  await saveJson(verifyDirectory ? "verification-progress.json" : "progress.json", { startedAt, endedAt: new Date().toISOString(), checked, attempted: results.length, results: results.map(item => { const value = { ...item }; delete value.chunks; return value; }) });
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([new Promise(resolve => child.once("exit", resolve)), delay(5000)]);
  }
  if (!verifyDirectory && client) {
    try {
      await saveJson("database-turns.json", (await client.query("SELECT * FROM app.agent_conversation_turn ORDER BY created_at,id")).rows);
      await saveJson("database-conversations.json", (await client.query("SELECT * FROM app.agent_conversation ORDER BY created_at,id")).rows);
      await saveJson("usage.json", (await client.query("SELECT user_id,run_id,status,input_tokens,output_tokens,cached_input_tokens,points,metadata FROM app.agent_usage ORDER BY created_at")).rows);
    } catch { console.error("Could not capture all database evidence during cleanup; inspect saved per-turn files."); }
  }
  serverLog.end();
  await client?.end();
  if (created && /^riic_conversations_[a-f0-9]{32}_test$/.test(databaseName)) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  await admin.end();
  const resolved = path.resolve(storage);
  if (path.dirname(resolved) === path.resolve(tmpdir()) && path.basename(resolved).startsWith("riic-agent-live-")) await rm(resolved, { recursive: true, force: true });
}
