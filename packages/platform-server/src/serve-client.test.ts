import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CappedTextLog,
  InfraCliServeClient,
  NdjsonLineBuffer,
  parseMatchingServeResponse,
} from "./serve-client.ts";

const FAKE_WORKER = String.raw`
import { existsSync, writeFileSync } from "node:fs";
import readline from "node:readline";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

lines.on("line", async (line) => {
  const request = JSON.parse(line);
  if (request.method === "env") {
    process.stdout.write(JSON.stringify({id:request.id,ok:true,result:{rayon:process.env.RAYON_NUM_THREADS}})+"\n");
    return;
  }
  if (request.method === "hang") {
    process.stdout.write("hung stdout\n");
    process.stderr.write("hung stderr\n");
    return;
  }
  if (request.method === "crash_once" && !existsSync(request.params.marker)) {
    writeFileSync(request.params.marker, "crashed", "utf8");
    process.stdout.write("first-attempt stdout\n");
    process.stderr.write("first-attempt stderr\n");
    process.exit(23);
  }
  if (request.method === "logs") {
    process.stdout.write("stage one");
    await delay(5);
    process.stdout.write(" done\r\n");
    process.stdout.write(JSON.stringify({ phase: "search" }) + "\n");
    process.stdout.write(JSON.stringify({ id: request.id + 999, ok: true }) + "\n");
    process.stdout.write(JSON.stringify({ id: request.id, ok: "yes" }) + "\n");
    process.stdout.write("null\n");
    process.stderr.write("stage diagnostic\r\n");
  }

  const response = JSON.stringify({ id: request.id, ok: true, result: { method: request.method } }) + "\r\n";
  process.stdout.write(response.slice(0, 9));
  await delay(5);
  process.stdout.write(response.slice(9));
});
`;

async function createTestClient(context: test.TestContext, childEnv?: Record<string,string>) {
  const root = await mkdtemp(path.join(tmpdir(), "arkinfra-serve-client-"));
  const workerPath = path.join(root, "fake-worker.mjs");
  await writeFile(workerPath, FAKE_WORKER, "utf8");
  const client = new InfraCliServeClient({
    resolveCliPath: () => process.execPath,
    resolveRuntimeDataDir: () => null,
    timeoutMs: 3_000,
    serveArgs: [workerPath],
    cwd: () => root,
    childEnv,
  });
  context.after(async () => {
    client.stop();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return { client, root };
}

test("matches only object responses with the current id and a boolean ok", () => {
  assert.equal(parseMatchingServeResponse("plain text", 7), null);
  assert.equal(parseMatchingServeResponse("null", 7), null);
  assert.equal(parseMatchingServeResponse("[]", 7), null);
  assert.equal(parseMatchingServeResponse('{"phase":"search"}', 7), null);
  assert.equal(parseMatchingServeResponse('{"id":8,"ok":true}', 7), null);
  assert.equal(parseMatchingServeResponse('{"id":7,"ok":"true"}', 7), null);
  assert.deepEqual(parseMatchingServeResponse('{"id":7,"ok":false}', 7), { id: 7, ok: false });
});

test("fallback thread limits are scoped to its child process",async context=>{
  const previous=process.env.RAYON_NUM_THREADS;
  const {client}=await createTestClient(context,{RAYON_NUM_THREADS:"1"});
  assert.deepEqual((await client.send("env",{})).response.result,{rayon:"1"});
  assert.equal(process.env.RAYON_NUM_THREADS,previous);
});

test("termination waits for the actual process to disappear before fallback",async context=>{
  const {client}=await createTestClient(context);
  await client.send("ok",{});
  const pid=client.info().pid;
  assert.ok(pid);
  const hanging=client.send("hang",{});
  const rejected=assert.rejects(hanging,/isolated/);
  await client.stopAndWait("isolated");
  await rejected;
  assert.throws(()=>process.kill(pid,0));
});

test("buffers split NDJSON lines and accepts CRLF", () => {
  const buffer = new NdjsonLineBuffer(128);
  assert.deepEqual(buffer.push("stage"), []);
  assert.deepEqual(buffer.push(" one\r\n{\"id\":"), ["stage one\r"]);
  assert.deepEqual(buffer.push("1,\"ok\":true}\r\n"), ['{"id":1,"ok":true}\r']);
  assert.deepEqual(buffer.push('next stage\n{"id":2,"ok":false}\n'), [
    "next stage",
    '{"id":2,"ok":false}',
  ]);

  const small = new NdjsonLineBuffer(8);
  assert.deepEqual(small.push("0123456789"), []);
  assert.deepEqual(small.push("discarded\nnext\n"), ["next"]);
});

test("retains a capped UTF-8 tail with an explicit stream marker", () => {
  const log = new CappedTextLog("stdout", 128);
  log.append("开".repeat(100));
  log.append("TAIL");
  const value = log.value();

  assert.match(value, /^\[\.\.\. stdout truncated;/);
  assert.equal(value.endsWith("TAIL"), true);
  assert.equal(value.includes("�"), false);
  assert.equal(Buffer.byteLength(value, "utf8") <= 128, true);

  log.reset();
  log.append("new attempt\n");
  assert.equal(log.value(), "new attempt\n");
});

test("keeps stdout logs on stdout, records stderr, and isolates queued requests", async (context) => {
  const { client } = await createTestClient(context);
  const firstPromise = client.send("logs", {});
  const secondPromise = client.send("ok", {});
  const [first, second] = await Promise.all([firstPromise, secondPromise]);

  assert.match(first.stdout, /stage one done\r\n/);
  assert.match(first.stdout, /"phase":"search"/);
  assert.match(first.stdout, new RegExp(`"id":${first.request.id + 999},"ok":true`));
  assert.match(first.stdout, new RegExp(`"id":${first.request.id},"ok":"yes"`));
  assert.match(first.stdout, /null\n/);
  assert.match(first.stdout, new RegExp(`"id":${first.request.id},"ok":true`));
  assert.equal(first.stderr, "stage diagnostic\r\n");
  assert.deepEqual(first.response, {
    id: first.request.id,
    ok: true,
    result: { method: "logs" },
  });

  assert.doesNotMatch(second.stdout, /stage one|phase|999/);
  assert.equal(second.stderr, "");
  assert.deepEqual(second.response, {
    id: second.request.id,
    ok: true,
    result: { method: "ok" },
  });
});

test("resets request logs when a Worker restart retries the active request", async (context) => {
  const { client, root } = await createTestClient(context);
  const marker = path.join(root, "crashed-once");
  const result = await client.send("crash_once", { marker });

  assert.equal(result.response.ok, true);
  assert.doesNotMatch(result.stdout, /first-attempt/);
  assert.equal(result.stderr, "");
  assert.equal(client.info().restartCount >= 2, true);
});

test("times out a silent request and does not leak its logs after restart", async (context) => {
  const { client } = await createTestClient(context);
  await assert.rejects(client.send("hang", {}, { timeoutMs: 80 }), /请求超时/);

  const result = await client.send("ok", {});
  assert.doesNotMatch(result.stdout, /hung stdout/);
  assert.doesNotMatch(result.stderr, /hung stderr/);
  assert.equal(result.response.ok, true);
  assert.equal(client.info().restartCount >= 2, true);
});
