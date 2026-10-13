import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import test from "node:test";

register("../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : nextResolve(specifier, context);
} });

test("archive APIs isolate owners and require verified role authorization for writes but not reads or deletes", async (context) => {
  let signedIn = true;
  let authorized = false;
  let saves = 0;
  let clears = 0;
  let reads = 0;
  const record = { id: "legacy", category: "normal", poolId: "p", poolName: "Pool", charId: "char", charName: "One", stars: 6, isNew: false, timestamp: Date.now() - 1000, pos: 0 };
  const history = { uid: "10001", nickname: "verified", records: [record], warnings: [], fetchedAt: new Date().toISOString() };
  await context.mock.module(new URL("./api-contract.ts", import.meta.url), { namedExports: {
    assertSameOrigin: (request: Request) => { if (request.headers.get("origin") !== "https://riic.test") throw new Error("origin"); },
    createRequestId: () => "test", enforceRateLimit: () => {}, requestClientIp: () => "127.0.0.1",
    readJsonBody: (request: Request) => request.json(), PublicApiError: class extends Error {},
    successResponse: (data: unknown) => Response.json({ success: true, data }),
    failureResponse: () => Response.json({ success: false }, { status: 400 }),
  } });
  await context.mock.module(new URL("./auth/authorization.ts", import.meta.url), { namedExports: {
    requireWebsiteSession: async () => { if (!signedIn) throw new Error("login"); return { user: { id: "owner" } }; },
  } });
  await context.mock.module(new URL("./skland/http.ts", import.meta.url), { namedExports: { assertSklandFeatureEnabled: () => {} } });
  await context.mock.module(new URL("./gacha-history.ts", import.meta.url), { namedExports: {
    gachaSession: (_request: Request, owner: string) => { assert.equal(owner, "owner"); return authorized ? { owner, roles: [{ uid: "10001", nickname: "verified" }] } : null; },
    fetchGachaHistory: async () => history, publicGachaError: (error: unknown) => error,
  } });
  await context.mock.module(new URL("./gacha-archive.ts", import.meta.url), { namedExports: {
    readGachaArchive: async (owner: string, uid: string) => { assert.equal(owner, "owner"); reads++; return uid === "10001" ? history : null; },
    saveGachaArchive: async (owner: string, value: typeof history) => { assert.equal(owner, "owner"); assert.equal(value.nickname, "verified"); saves++; return value; },
    clearGachaArchive: async (owner: string, uid: string) => { assert.equal(owner, "owner"); assert.equal(uid, "10001"); clears++; },
  } });
  const { GET, POST, DELETE } = await import("../app/api/gacha/history/route.ts");
  const request = (method: string, body?: unknown, uid = "10001", origin = "https://riic.test") => new Request(`https://riic.test/api/gacha/history?uid=${uid}`, {
    method, headers: { origin, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  signedIn = false;
  assert.equal((await GET(request("GET"))).status, 400);
  assert.equal(reads, 0);
  signedIn = true;
  const cloud = await GET(request("GET"));
  assert.equal(cloud.status, 200);
  assert.equal(cloud.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual((await cloud.json()).data, history);
  assert.equal((await POST(request("POST", { action: "refresh" }))).status, 400);
  authorized = true;
  assert.equal((await POST(request("POST", { action: "refresh" }, "10002"))).status, 400);
  assert.equal((await POST(request("POST", { action: "refresh" }, "10001", "https://evil.test"))).status, 400);
  assert.equal((await POST(request("POST", { action: "import", history: { ...history, uid: "10002" } }))).status, 400);
  assert.equal(saves, 0);
  assert.equal((await POST(request("POST", { action: "import", owner: "attacker", history: { ...history, nickname: "spoofed" } }))).status, 200);
  assert.equal((await POST(request("POST", { action: "refresh" }))).status, 200);
  assert.equal(saves, 2);
  authorized = false;
  assert.equal((await DELETE(request("DELETE", { confirmUid: "10002" }))).status, 400);
  assert.equal(clears, 0);
  assert.equal((await DELETE(request("DELETE", { confirmUid: "10001" }))).status, 200);
  assert.equal(clears, 1);
});
