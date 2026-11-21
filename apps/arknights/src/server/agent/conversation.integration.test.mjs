import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { register, registerHooks } from "node:module";
import test from "node:test";
import process from "node:process";
import { URL } from "node:url";
import { Buffer } from "node:buffer";
import { ReadableStream } from "node:stream/web";
import { setTimeout } from "node:timers";
import { MockLanguageModelV4 } from "ai/test";
const { Request, AbortController } = globalThis;
register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) { return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context); } });
const url = process.env.AUTH_INTEGRATION_DATABASE_URL;
if (!url || !new URL(url).pathname.startsWith("/riic_conversations_") || !new URL(url).pathname.endsWith("_test")) throw new Error("An isolated conversation *_test database is required");
const { getDatabasePool } = await import("@riic/platform-server/db");
const { ConversationStore, archiveUserMessage } = await import("./conversation-store.ts");
const { ConversationRecorder, beginConversationRecording } = await import("./conversation-stream.ts");
const { PublicApiError } = await import("@riic/platform-server/api-contract");
const pool = getDatabasePool();
const store = new ConversationStore(pool);
const user = text => ({ id: randomUUID(), role: "user", parts: [{ type: "text", text }] });
const assistant = text => ({ id: randomUUID(), role: "assistant", parts: [{ type: "text", text }] });
const chunks = (text = "真实回复") => [
  { type: "start", messageId: randomUUID() }, { type: "text-start", id: "text" }, { type: "text-delta", id: "text", delta: text },
  { type: "text-end", id: "text" }, { type: "finish", finishReason: "stop" },
];
const stream = values => new ReadableStream({ start(output) { for (const value of values) output.enqueue(value); output.close(); } });
const collect = async source => { const out = []; for await (const chunk of source) out.push(chunk); return out; };

test("conversation archive storage, streaming, ownership and complete exports", { timeout: 90_000 }, async t => {
  const ids = Object.fromEntries(["alice", "bob", "admin", "root"].map(name => [name, `archive-${name}-${randomUUID()}`]));
  let actor = ids.alice;
  let impersonatedBy;
  const originalEnv = { ...process.env };
  process.env.AGENT_CONVERSATION_STORAGE_ENABLED = "1";
  process.env.BETTER_AUTH_URL = "https://riic.test";
  process.env.BETA_PUBLIC_ORIGIN = "https://riic.test";
  process.env.BETA_STORAGE_DIR = "";
  process.env.BETTER_AUTH_ADMIN_USER_IDS = ids.root;
  const begin = (owner = ids.alice, conversationId = "conversation-one", extra = {}) => store.begin({ userId: owner, conversationId,
    attemptId: randomUUID(), requestId: randomUUID(), model: "synthetic", message: user("排班问题"), ...extra });
  try {
    for (const [name, id] of Object.entries(ids)) {
      await pool.query('INSERT INTO public."user" (id,name,email,role) VALUES ($1,$2,$3,$4)', [id, name, `${id}@example.invalid`, name === "admin" ? "admin" : "user"]);
      await pool.query("INSERT INTO public.session (id,user_id,token,expires_at) VALUES ($1,$2,$3,now()+interval '1 hour')", [`session-${id}`, id, randomUUID()]);
    }
    await t.mock.module(new URL("../../../../../packages/platform-server/src/auth/authorization.ts", import.meta.url), { namedExports: {
      requireWebsiteSession: async () => { if (!actor) throw new PublicApiError("AIC-AUTH-2008"); return { user: { id: actor }, session: { id: `session-${actor}`, impersonatedBy } }; },
    } });
    const { conversationApi } = await import("./conversation-api.ts");
    const request = (query = "", method = "GET", origin = "https://riic.test") => conversationApi(new Request(`https://riic.test/api/agent/archive?${query}`, { method, headers: { origin } }));
    let first;
    await t.test("attachments preserve text and metadata without binary bodies, URLs or client assistant data", async () => {
      const value = archiveUserMessage({ ...user("正文"), parts: [
        { type: "text", text: "正文" }, { type: "file", mediaType: "text/plain", filename: "note.txt", url: `data:text/plain;base64,${Buffer.from("附件文字").toString("base64")}` },
        { type: "file", mediaType: "image/png", filename: "plan.png", url: "data:image/png;base64,AQID" },
        { type: "reasoning", text: "do not archive" }, { type: "tool-fake", output: "client forged" },
      ] });
      assert.equal(value.parts[1].data.text, "附件文字");
      assert.equal(value.parts[2].data.byteLength, 3);
      assert.equal(value.parts[2].data.bodyStored, false);
      assert.equal(value.parts[2].data.sha256.length, 64);
      assert.doesNotMatch(JSON.stringify(value), /base64|AQID|do not archive|client forged/);
    });
    await t.test("concurrent attempts receive unique sequence numbers; duplicate attempt rolls back", async () => {
      const rows = await Promise.all(Array.from({ length: 6 }, () => begin()));
      first = rows[0];
      const turns = await store.turns({ userId: ids.alice }, { conversationId: first.conversationId });
      assert.deepEqual(turns.map(turn => turn.sequence), [1, 2, 3, 4, 5, 6]);
      const attemptId = randomUUID();
      const result = await Promise.allSettled([begin(ids.bob, "duplicates", { attemptId }), begin(ids.bob, "duplicates", { attemptId })]);
      assert.equal(result.filter(item => item.status === "fulfilled").length, 1);
      assert.equal((await store.turns({ userId: ids.bob })).length, 1);
      for (const row of rows) await store.checkpoint(row.id, assistant("已经完成"), "completed");
    });
    await t.test("UI stream archives server text and structured tool results with a shared message ID", async () => {
      const record = await begin(ids.alice, "stream");
      const values = chunks();
      values.splice(1, 0, { type: "tool-input-available", toolCallId: "call", toolName: "kb_read", input: { path: "example" } },
        { type: "tool-output-available", toolCallId: "call", output: { text: "工具返回" } });
      const delivered = await collect(new ConversationRecorder(store, record.id, new AbortController().signal).wrap(stream(values), "synthetic-run"));
      assert.equal(delivered.at(-2).data.status, "saved");
      const [turn] = await store.turns({ userId: ids.alice }, { conversationId: record.conversationId });
      assert.equal(turn.userMessage.role, "user"); assert.equal(turn.assistantMessage.role, "assistant");
      assert.equal(turn.assistantMessage.id, values[0].messageId);
      assert.equal(turn.assistantText, "真实回复"); assert.equal(turn.status, "completed");
      assert.equal(turn.runId, "synthetic-run");
      assert.match(JSON.stringify(turn.assistantMessage), /工具返回/);
    });
    await t.test("stream errors, explicit cancellation and premature close retain partial responses", async () => {
      for (const [kind, expected] of [["error", "failed"], ["abort", "cancelled"], ["close", "interrupted"]]) {
        const record = await begin(ids.alice, `terminal-${kind}`);
        const values = chunks("部分回复").slice(0, 4);
        if (kind === "error") values.push({ type: "error", errorText: "模拟传输失败" });
        if (kind === "abort") values.push({ type: "abort" });
        const delivered = await collect(new ConversationRecorder(store, record.id, new AbortController().signal).wrap(stream(values)));
        const [turn] = await store.turns({ userId: ids.alice }, { conversationId: record.conversationId });
        assert.equal(turn.status, expected); assert.equal(turn.assistantText, "部分回复");
        if (kind === "error" || kind === "close") assert.ok(delivered.some(value => value.type === "error"));
      }
      const record = await begin(ids.alice, "source-throw");
      let output;
      const source = new ReadableStream({ start(controller) { output = controller; } });
      const consuming = collect(new ConversationRecorder(store, record.id, new AbortController().signal).wrap(source));
      for (const value of chunks("保留内容").slice(0, 4)) output.enqueue(value);
      await new Promise(resolve => setTimeout(resolve, 20));
      output.error(new Error("synthetic raw transport secret"));
      const delivered = await consuming;
      assert.ok(delivered.some(value => value.type === "error"));
      assert.doesNotMatch(JSON.stringify(delivered), /synthetic raw transport secret/);
    });
    await t.test("stream checkpoints exist before completion; active conversations cannot be deleted", async () => {
      const record = await begin(ids.alice, "live-checkpoint");
      let output;
      const source = new ReadableStream({ start(controller) { output = controller; } });
      const consuming = collect(new ConversationRecorder(store, record.id, new AbortController().signal).wrap(source));
      for (const value of chunks("前半段").slice(0, 3)) output.enqueue(value);
      await new Promise(resolve => setTimeout(resolve, 1050));
      output.enqueue({ type: "text-delta", id: "text", delta: "后半段" });
      await new Promise(resolve => setTimeout(resolve, 100));
      const [partial] = await store.turns({ userId: ids.alice }, { conversationId: record.conversationId });
      assert.equal(partial.status, "streaming"); assert.equal(partial.assistantText, "前半段后半段");
      await assert.rejects(store.deleteOwn(record.conversationId, ids.alice));
      output.enqueue({ type: "text-end", id: "text" }); output.enqueue({ type: "finish", finishReason: "stop" }); output.close();
      await consuming;
    });
    await t.test("deletion waits for a concurrent attempt and preserves its streaming turn", async () => {
      const previous = await begin(ids.alice, "delete-race");
      await store.checkpoint(previous.id, assistant("此前已完成"), "completed");
      const staged = Promise.withResolvers();
      const commit = Promise.withResolvers();
      let writerPid;
      // Pause a real begin transaction after inserting its turn, before commit.
      const creatingStore = new ConversationStore({
        async connect() {
          const client = await pool.connect();
          writerPid = client.processID;
          return {
            async query(...args) {
              if (args[0] === "COMMIT") { staged.resolve(); await commit.promise; }
              return client.query(...args);
            },
            release() { client.release(); },
          };
        },
      });
      const beginning = creatingStore.begin({ userId: ids.alice, conversationId: "delete-race", attemptId: randomUUID(),
        requestId: randomUUID(), model: "synthetic", message: user("正在开始的新问题") });
      let deleting;
      try {
        await Promise.race([staged.promise, beginning.then(() => { throw new Error("begin must wait before commit"); })]);
        deleting = store.deleteOwn(previous.conversationId, ids.alice).then(() => null, error => error);
        let blocked = false;
        for (let poll = 0; poll < 100; poll++) {
          const result = await pool.query("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked", [writerPid]);
          if (result.rows[0].blocked) { blocked = true; break; }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(blocked, "delete must have started and be waiting for the in-flight begin transaction");
        commit.resolve();
        const current = await beginning;
        assert.match((await deleting)?.message ?? "", /仍在生成/);
        const turns = await store.turns({ userId: ids.alice }, { conversationId: current.conversationId });
        assert.equal(turns.length, 2);
        assert.equal(turns.find(turn => turn.id === current.id)?.status, "streaming");
        await store.checkpoint(current.id, assistant("新问题也已完成"), "completed");
        await store.deleteOwn(current.conversationId, ids.alice);
        assert.equal((await store.turns({ userId: ids.alice }, { conversationId: current.conversationId })).length, 0);
      } finally {
        commit.resolve();
        await Promise.allSettled([beginning, deleting]);
      }
    });
    await t.test("archive output write failures are visible; initial failure prevents a recorder", async () => {
      const recorder = new ConversationRecorder({ checkpoint: async () => { throw new Error("synthetic DB failure"); } }, "test-failure", new AbortController().signal);
      const values = await collect(recorder.wrap(stream(chunks())));
      assert.equal(values.find(chunk => chunk.type === "data-agent-archive").data.status, "failed");
      assert.ok(values.some(chunk => chunk.type === "text-delta"));
      await assert.rejects(beginConversationRecording({ userId: "missing-account", conversationId: "failure", attemptId: randomUUID(), requestId: randomUUID(), model: "synthetic", messages: [user("hi")], signal: new AbortController().signal }), /未调用模型/);
    });
    await t.test("all reads, details, downloads and deletion enforce ownership regardless of admin role", async () => {
      for (const name of ["bob", "admin"]) {
        actor = ids[name];
        assert.equal((await request("scope=all")).status, 403);
        assert.equal((await request(`action=detail&id=${first.conversationId}`)).status, 404);
        assert.equal((await request(`action=export&id=${first.conversationId}`, "POST")).status, 403);
        assert.equal((await request(`action=delete&id=${first.conversationId}`, "DELETE")).status, 404);
        assert.equal((await request(`userId=${ids.alice}`)).status, 403);
      }
      actor = ids.alice;
      assert.equal((await request("action=export", "POST")).status, 403);
      assert.equal((await request("action=access")).status, 200);
      assert.equal((await (await request("action=access")).json()).canExport, false);
      actor = ids.root; impersonatedBy = ids.admin;
      assert.equal((await request("scope=all")).status, 403);
      impersonatedBy = undefined;
      assert.equal((await request("scope=all")).status, 200);
      await pool.query('UPDATE public."user" SET banned=true WHERE id=$1', [actor]);
      assert.equal((await request("scope=all")).status, 403);
      await pool.query('UPDATE public."user" SET banned=false WHERE id=$1', [actor]);
      process.env.BETTER_AUTH_ADMIN_USER_IDS = "";
      assert.equal((await request("scope=all")).status, 403);
      process.env.BETTER_AUTH_ADMIN_USER_IDS = ids.root;
      actor = undefined; assert.equal((await request()).status, 401); actor = ids.root;
      assert.equal((await request("action=export", "POST", "https://evil.test")).status, 403);
    });
    await t.test("abandoned attempts recover as interrupted without replacing their partial reply", async () => {
      const record = await begin(ids.bob, "abandoned");
      await store.checkpoint(record.id, assistant("之前保存的片段"), "streaming");
      await pool.query("UPDATE app.agent_conversation_turn SET updated_at=now()-interval '20 minutes' WHERE id=$1", [record.id]);
      await store.recoverInterrupted({ userId: ids.bob });
      const [turn] = await store.turns({ userId: ids.bob }, { conversationId: record.conversationId });
      assert.equal(turn.status, "interrupted"); assert.equal(turn.assistantText, "之前保存的片段");
    });
    await t.test("detail and full exports paginate beyond one batch, retain sequence and audit totals", async () => {
      const conversationId = randomUUID();
      await pool.query("INSERT INTO app.agent_conversation (id,user_id,client_id,title,next_sequence) VALUES ($1,$2,'large','全量分页',237)", [conversationId, ids.alice]);
      await pool.query(`INSERT INTO app.agent_conversation_turn (id,conversation_id,user_id,sequence,attempt_id,request_id,model,status,user_message,user_text,assistant_message,assistant_text,finished_at)
        SELECT md5('turn-'||n)::uuid::text,$1,$2,n,md5('attempt-'||n),md5('request-'||n),'synthetic','completed',
          jsonb_build_object('id',n::text,'role','user','parts',jsonb_build_array(jsonb_build_object('type','text','text','问题'||n))), '问题'||n,
          jsonb_build_object('id','answer-'||n,'role','assistant','parts',jsonb_build_array(jsonb_build_object('type','text','text','回答'||n))), '回答'||n,now()
        FROM generate_series(1,237) n`, [conversationId, ids.alice]);
      actor = ids.alice;
      let after; const sequence = [];
      do {
        const response = await request(`action=detail&id=${conversationId}${after ? `&after=${after}` : ""}`);
        assert.equal(response.status, 200); const data = await response.json();
        sequence.push(...data.turns.map(turn => turn.sequence)); after = data.next;
      } while (after);
      assert.deepEqual(sequence, Array.from({ length: 237 }, (_, index) => index + 1));
      actor = ids.root;
      for (const format of ["jsonl", "json"]) {
        const response = await request(`action=export&scope=all&format=${format}`, "POST");
        assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/);
        const text = await response.text();
        const data = format === "json" ? JSON.parse(text) : text.trim().split("\n").map(line => JSON.parse(line));
        const turns = format === "json" ? data.turns : data.filter(row => row.type === "turn");
        const completion = format === "json" ? data.completion : data.at(-1);
        assert.equal(turns.filter(turn => turn.conversationId === conversationId).length, 237);
        assert.equal(new Set(turns.map(turn => turn.id)).size, turns.length);
        assert.equal(completion.recordCount, turns.length); assert.equal(completion.complete, true);
        assert.ok(turns.every(turn => turn.status !== "streaming"));
      }
      const audits = (await pool.query("SELECT * FROM app.agent_conversation_audit WHERE action='export' AND actor_id=$1 ORDER BY created_at DESC LIMIT 2", [ids.root])).rows;
      assert.equal(audits.length, 2); assert.ok(audits.every(audit => audit.result === "completed" && audit.record_count >= 237));
      const revokedExport = await request("action=export&scope=all", "POST");
      const revokedReader = revokedExport.body.getReader();
      await revokedReader.read(); await revokedReader.read();
      await pool.query("UPDATE public.session SET expires_at=now()-interval '1 minute' WHERE user_id=$1", [actor]);
      let interrupted = false;
      try { for (;;) { if ((await revokedReader.read()).done) break; } } catch { interrupted = true; }
      assert.equal(interrupted, true, "a revoked login must stop the next export batch");
      await pool.query("UPDATE public.session SET expires_at=now()+interval '1 hour' WHERE user_id=$1", [actor]);
      const roleRevokedExport = await request("action=export&scope=all", "POST");
      const roleRevokedReader = roleRevokedExport.body.getReader();
      await roleRevokedReader.read(); await roleRevokedReader.read();
      process.env.BETTER_AUTH_ADMIN_USER_IDS = "";
      let roleInterrupted = false;
      try { for (;;) { if ((await roleRevokedReader.read()).done) break; } } catch { roleInterrupted = true; }
      assert.equal(roleInterrupted, true, "removing the server-listed privilege must stop the next export batch");
      process.env.BETTER_AUTH_ADMIN_USER_IDS = ids.root;
      const exporting = store.exportSnapshot({ userId: ids.alice }, conversationId, new Date().toISOString());
      assert.equal((await exporting.next()).value.sequence, 1);
      actor = ids.alice;
      assert.equal((await request(`action=delete&id=${conversationId}`, "DELETE")).status, 200);
      let remaining = 0;
      for await (const turn of exporting) { assert.ok(turn.sequence > 1); remaining++; }
      assert.equal(remaining, 236, "concurrent deletion must not silently remove later export pages");
      assert.equal((await store.turns({ userId: ids.alice }, { conversationId })).length, 0);
    });
    await t.test("cancelled exports release the snapshot and leave a cancelled audit", async () => {
      actor = ids.root;
      const response = await request("action=export&scope=all", "POST");
      assert.equal(response.status, 200);
      const reader = response.body.getReader();
      await reader.read(); await reader.read(); await reader.cancel();
      const row = (await pool.query("SELECT result FROM app.agent_conversation_audit WHERE actor_id=$1 AND action='export' ORDER BY created_at DESC LIMIT 1", [actor])).rows[0];
      assert.equal(row.result, "cancelled");
      assert.equal((await pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'")).rows[0].n, 0);
    });
    await t.test("disabled flag blocks archive APIs and leaves existing chat behavior untouched", async () => {
      process.env.AGENT_CONVERSATION_STORAGE_ENABLED = "0";
      assert.equal((await request()).status, 404);
      assert.equal(await beginConversationRecording({}), undefined);
      process.env.AGENT_CONVERSATION_STORAGE_ENABLED = "1";
    });
    await t.test("real direct and gateway routes record server replies and reject duplicate or unsaved input before model invocation", async () => {
      let automatic = false; let modelCalls = 0; let finalized = 0; let runs = 0;
      const model = new MockLanguageModelV4({ doStream: async () => {
        modelCalls++;
        return { stream: stream([
          { type: "stream-start", warnings: [] }, { type: "text-start", id: "text" }, { type: "text-delta", id: "text", delta: "服务端实际回复" }, { type: "text-end", id: "text" },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } } },
        ]) };
      } });
      const mock = (file, namedExports) => t.mock.module(new URL(file, import.meta.url), { namedExports });
      await mock("../auth/feature-access.ts", { requireFeatureSession: async () => ({ user: { id: actor } }) });
      await mock("./llm.ts", { getAgentModel: () => model });
      await mock("./tools.ts", { buildAgentTools: () => ({}) });
      await mock("./persona.ts", { buildAgentSystemPrompt: async () => "Synthetic system prompt" });
      await mock("./persona-catalog.ts", { listBuiltinAgentPersonas: async () => [], resolveAgentPersonaContent: async () => undefined });
      await mock("./resources.ts", { activeAgentResources: async () => null });
      await mock("../billing/service.ts", { getWallet: async () => ({ totalPoints: 100 }), createAgentUsage: async () => randomUUID(), finalizeAgentUsage: async () => { finalized++; } });
      await mock("./gateway-runtime.ts", { agentGatewayEnabled: () => automatic, gatewaySettings: () => ({}), createGatewayRun: () => ({ model, deliver: async () => {}, finalize: async () => { finalized++; } }) });
      await mock("../billing/agent-accounting.ts", {
        AgentAccountingError: class extends Error {}, agentSessionId: () => "synthetic-session",
        activeAgentPolicies: async () => ({ rates: { id: "rates", policy: {} }, filter: { id: "filter", policy: { rules: [], allow: [] } } }),
        beginAgentRun: async () => { runs++; return randomUUID(); }, beginToolCharge: async () => "charge", finishToolCharge: async () => {}, recordFilterEvent: async () => {},
      });
      process.env.NODE_ENV = "production";
      process.env.AGENT_LLM_API_KEY = "synthetic-not-a-real-key";
      process.env.AGENT_GATEWAY_KEY = "synthetic-not-a-real-key";
      const { POST } = await import("../../app/api/agent/chat/route.ts");
      const send = (conversationId, attemptId) => POST(new Request("https://riic.test/api/agent/chat", { method: "POST", headers: { origin: "https://riic.test", "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, attemptId, messages: [
        user("旧问题"), assistant("浏览器伪造的历史回答"), user("当前问题"),
      ] }) }));
      for (automatic of [false, true]) {
        actor = ids.alice;
        const conversationId = `route-${automatic}`; const attemptId = randomUUID();
        const before = modelCalls; const accounted = finalized;
        const response = await send(conversationId, attemptId);
        assert.equal(response.status, 200);
        const body = await response.text();
        assert.match(body, /服务端实际回复/); assert.match(body, /data-agent-archive/);
        assert.equal(modelCalls, before + 1); assert.equal(finalized, accounted + 1);
        const row = (await pool.query("SELECT * FROM app.agent_conversation_turn WHERE user_id=$1 AND attempt_id=$2", [actor, attemptId])).rows[0];
        assert.equal(row.user_text, "当前问题"); assert.equal(row.assistant_text, "服务端实际回复");
        assert.equal(row.status, "completed"); assert.ok(row.assistant_message.id);
        assert.ok(body.includes(row.assistant_message.id));
        assert.doesNotMatch(JSON.stringify(row), /浏览器伪造的历史回答/);
        assert.equal(Boolean(row.run_id), automatic);
        const duplicate = await send(conversationId, attemptId);
        assert.equal(duplicate.status, 400); assert.equal(modelCalls, before + 1);
        actor = "missing-account"; const priorRuns = runs;
        const failed = await send("storage-failed", randomUUID());
        assert.equal(failed.status, 500); assert.equal(modelCalls, before + 1); assert.equal(runs, priorRuns);
      }
      actor = ids.alice;
    });
  } finally { process.env = originalEnv; await pool.end(); }
});
