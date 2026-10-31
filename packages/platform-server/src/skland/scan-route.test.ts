import assert from "node:assert/strict";
import { register } from "node:module";
import { setImmediate } from "node:timers/promises";
import test from "node:test";

register("../../../../scripts/ts-path-loader.mjs", import.meta.url);

test("QR status commits only a current scan and exposes confirmed processing", async context => {
  let lifetime = new AbortController();
  let mode: "authenticated" | "processing" = "authenticated";
  let release!: () => void;
  let wait = new Promise<void>(resolve => { release = resolve; });
  let cookieWrites = 0, consumed = 0, finalizations = 0;
  let invalidateAtResponse = false;
  const completed = { previous: {}, next: {}, data: { scheduleSnapshot: {}, statusSnapshot: {}, accounts: [], activeAccountId: "account" } };
  await context.mock.module(new URL("../api-contract.ts", import.meta.url), { namedExports: {
    assertSameOrigin: () => {}, createRequestId: () => "fixture-request", requestClientIp: () => "fixture-ip",
    readJsonBody: (request: Request) => request.json(), PublicApiError: class extends Error {},
    successResponse: (data: unknown) => { if (invalidateAtResponse) lifetime.abort(); return Response.json({ success: true, data }); },
  } });
  await context.mock.module(new URL("../auth/authorization.ts", import.meta.url), { namedExports: { requireWebsiteSession: async () => ({ user: { id: "owner" } }) } });
  await context.mock.module(new URL("./poll-rate-limit.ts", import.meta.url), { namedExports: { enforceSklandPollRateLimit: () => {} } });
  await context.mock.module(new URL("./adapter.ts", import.meta.url), { namedExports: {
    pollScan: async () => mode === "processing" ? { response: { status: "scanned", processing: true } }
      : { session: {}, response: { status: "authenticated", scheduleSnapshot: {}, statusSnapshot: {} } },
    scanCompletionSignal: (_scan: string, owner: string, request?: AbortSignal) => {
      assert.equal(owner, "owner"); lifetime.signal.throwIfAborted();
      return AbortSignal.any([lifetime.signal, ...(request ? [request] : [])]);
    },
    consumeScan: () => { consumed++; },
  } });
  await context.mock.module(new URL("./auth-completion.ts", import.meta.url), { namedExports: {
    finalizeSklandAuthentication: async (_owner: string, _result: unknown, signal: AbortSignal) => {
      finalizations++; await wait; signal.throwIfAborted(); return completed;
    },
  } });
  await context.mock.module(new URL("./http.ts", import.meta.url), { namedExports: {
    assertSklandAvailable: () => {}, assertSklandFeatureEnabled: () => {},
    setSklandAccountStoreCookies: () => { cookieWrites++; },
    sklandErrorResponse: () => Response.json({ success: false }, { status: 401 }),
  } });
  const { POST } = await import("../http/skland/auth/qr/status/route.ts");
  const request = () => new Request("https://riic.test/api/skland/auth/qr/status", { method: "POST", body: JSON.stringify({ scanId: "scan" }) });

  const stale = POST(request()); await setImmediate();
  assert.equal(finalizations, 1); lifetime.abort(); release();
  assert.equal((await stale).status, 401); assert.equal(cookieWrites, 0); assert.equal(consumed, 0);

  lifetime = new AbortController(); wait = Promise.resolve(); invalidateAtResponse = true;
  assert.equal((await POST(request())).status, 401, "The scan is checked again immediately before writing cookies");
  assert.equal(cookieWrites, 0); assert.equal(consumed, 0);

  lifetime = new AbortController(); invalidateAtResponse = false;
  assert.equal((await POST(request())).status, 200); assert.equal(cookieWrites, 1); assert.equal(consumed, 1);

  mode = "processing";
  assert.deepEqual((await (await POST(request())).json()).data, { status: "scanned", processing: true });
  assert.equal(cookieWrites, 1); assert.equal(consumed, 1);
});
