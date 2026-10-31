import assert from "node:assert/strict";
import { register } from "node:module";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { PRIVACY_VERSION, TERMS_VERSION } from "@riic/platform/legal-policy";

register("../../../../scripts/ts-path-loader.mjs", import.meta.url);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const consent = { termsAccepted: true, privacyAccepted: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION };

test("QR lifecycle preserves admission, progress and exactly one authentication exchange", async context => {
  let now = 1_000_000;
  context.mock.method(Date, "now", () => now);
  let nextId = 0;
  let statusCalls = 0, tokenCalls = 0, signIns = 0, playerReads = 0;
  let generate = async () => ({ scanId: `scan-${++nextId}`, scanUrl: `https://example.invalid/${nextId}` });
  let readStatus = async (): Promise<{ scanCode: string; scanStatus: string }> => ({ scanCode: "", scanStatus: "waiting" });
  let exchange = async () => "fixture-oauth";
  let signIn = async () => ({ cred: "fixture-cred", token: "fixture-token", userId: "fixture-user" });
  let readInfo = async () => ({});
  const client = {
    storage: { getItem: async () => "fixture-device", setItem: async () => {} },
    collections: {
      hypergryph: {
        generateScanLoginUrl: () => generate(),
        getScanStatus: () => { statusCalls++; return readStatus(); },
        getOAuthTokenByScanCode: () => { tokenCalls++; return exchange(); },
        grantAuthorizeCode: async () => ({ code: "fixture-grant" }),
      },
      player: { getBinding: async () => { playerReads++; return {}; }, getInfo: () => readInfo() },
    },
    signIn: () => { signIns++; return signIn(); },
  };
  await context.mock.module("skland-kit", { namedExports: {
    createClient: () => client, STORAGE_CREDENTIAL_KEY: "cred", STORAGE_DID_KEY: "did",
    STORAGE_OAUTH_TOKEN_KEY: "token", STORAGE_USER_ID_KEY: "user",
  } });
  await context.mock.module(new URL("./operator-snapshot-store.ts", import.meta.url), { namedExports: { persistOperatorSnapshot: async () => {} } });
  await context.mock.module(new URL("./layout-suggestion.ts", import.meta.url), { namedExports: { sklandLayoutSuggestion: () => ({}) } });
  await context.mock.module(new URL("./normalize.ts", import.meta.url), { namedExports: {
    rolesFromBinding: () => [{ uid: "role", isDefault: true }], snapshotFromPlayerInfo: () => ({}),
    snapshotsFromPlayerInfo: () => ({ scheduleSnapshot: { roles: [] }, statusSnapshot: {} }),
  } });
  const { startScan, pollScan, pollSklandIdentity, scanCompletionSignal, SCAN_AUTH_TIMEOUT_MS, SCAN_START_TIMEOUT_MS } = await import("./adapter.ts");
  function reset() {
    for (const scan of globalThis.__infraCalcSklandScans!.values()) scan.lifecycle.abort();
    globalThis.__infraCalcSklandScans!.clear(); globalThis.__infraCalcSklandRate!.clear();
    globalThis.__infraCalcSklandScanStarts!.clear(); globalThis.__infraCalcSklandUpstreamCooldownUntil = 0;
    now += 1_000_000;
    statusCalls = tokenCalls = signIns = playerReads = 0;
    generate = async () => ({ scanId: `scan-${++nextId}`, scanUrl: `https://example.invalid/${nextId}` });
    readStatus = async () => ({ scanCode: "", scanStatus: "waiting" });
    exchange = async () => "fixture-oauth";
    signIn = async () => ({ cred: "fixture-cred", token: "fixture-token", userId: "fixture-user" });
    readInfo = async () => ({});
  }

  await context.test("refreshes generate new codes; rejected attempts preserve the current code and exact quota", async () => {
    reset(); const startedAt = now;
    const first = await startScan("owner", "ip", consent);
    assert.equal(first.refreshAfterSeconds, 10);
    now += 9_999;
    await assert.rejects(startScan("owner", "ip", consent), { code: "RATE_LIMITED", retryAfterSeconds: 1 });
    assert.equal((await pollScan(first.scanId, "owner")).response.status, "waiting");
    now++;
    const second = await startScan("owner", "ip", consent);
    assert.notEqual(second.scanId, first.scanId);
    assert.equal((await pollScan(first.scanId, "owner")).response.status, "expired");
    let latest = second;
    for (let index = 0; index < 3; index++) { now += 10_000; latest = await startScan("owner", "ip", consent); }
    assert.equal(latest.refreshAfterSeconds, 560);
    await assert.rejects(startScan("owner", "ip", consent), { retryAfterSeconds: 560 });
    assert.equal((await pollScan(latest.scanId, "owner")).response.status, "waiting");
    now = startedAt + 599_999;
    await assert.rejects(startScan("owner", "ip", consent), { retryAfterSeconds: 1 });
    now++;
    assert.notEqual((await startScan("owner", "ip", consent)).scanId, latest.scanId);
  });

  await context.test("failed and concurrent generation never replace a usable code", async () => {
    reset(); const first = await startScan("owner", "ip", consent); now += 10_000;
    const gate = deferred<{ scanId: string; scanUrl: string }>(); generate = () => gate.promise;
    const failure = startScan("owner", "ip", consent);
    await assert.rejects(startScan("owner", "ip", consent), { retryAfterSeconds: 10 });
    gate.reject(new Error("fixture unavailable"));
    await assert.rejects(failure, { retryAfterSeconds: 10 });
    assert.equal((await pollScan(first.scanId, "owner")).response.status, "waiting");
  });

  await context.test("games share account quota but keep scan ownership isolated", async () => {
    reset(); const ark = await startScan("owner", "ip", consent);
    await assert.rejects(startScan("endfield:owner", "ip", consent, "owner"), { retryAfterSeconds: 10 });
    now += 10_000;
    const endfield = await startScan("endfield:owner", "ip", consent, "owner");
    assert.equal((await pollScan(endfield.scanId, "owner")).response.status, "expired");
    assert.equal((await pollSklandIdentity(ark.scanId, "endfield:owner")).status, "expired");
    assert.equal((await pollScan(ark.scanId, "owner")).response.status, "waiting");
  });

  await context.test("query calls deduplicate and scanned state never regresses", async () => {
    reset(); const qr = await startScan("owner", "ip", consent);
    const gate = deferred<{ scanCode: string; scanStatus: string }>(); readStatus = () => gate.promise;
    const first = pollScan(qr.scanId, "owner"); now += 1500;
    const second = pollScan(qr.scanId, "owner");
    assert.equal(statusCalls, 1);
    gate.resolve({ scanCode: "", scanStatus: "scanned" });
    assert.equal((await first).response.status, "scanned"); assert.equal((await second).response.status, "scanned");
    readStatus = async () => ({ scanCode: "", scanStatus: "waiting" }); now += 1500;
    assert.equal((await pollScan(qr.scanId, "owner")).response.status, "scanned");
  });

  await context.test("fast confirmation is visible before exchange; overlapping polls exchange only once", async () => {
    reset(); const qr = await startScan("owner", "ip", consent);
    readStatus = async () => ({ scanCode: "fixture-code", scanStatus: "confirmed" });
    const gate = deferred<string>(); exchange = () => gate.promise;
    assert.deepEqual((await pollScan(qr.scanId, "owner")).response, { success: true, status: "scanned", processing: true });
    assert.equal(tokenCalls, 0);
    await pollScan(qr.scanId, "owner"); now += 1500; await pollScan(qr.scanId, "owner");
    assert.equal(statusCalls, 1); assert.equal(tokenCalls, 1);
    gate.resolve("fixture-oauth"); await setImmediate();
    assert.equal((await pollScan(qr.scanId, "owner")).response.status, "authenticated");
    assert.equal(signIns, 1);
  });

  await context.test("an aborted HTTP request retains successful authentication", async () => {
    reset(); const qr = await startScan("owner", "ip", consent); const abort = new AbortController();
    readStatus = async () => ({ scanCode: "fixture-code", scanStatus: "confirmed" });
    await pollScan(qr.scanId, "owner");
    const gate = deferred<string>(); exchange = () => gate.promise;
    await pollScan(qr.scanId, "owner", abort.signal); abort.abort(); gate.resolve("fixture-oauth"); await setImmediate();
    assert.equal((await pollScan(qr.scanId, "owner")).response.status, "authenticated");
    assert.equal(tokenCalls, 1); assert.equal(signIns, 1);
  });

  await context.test("a replacement invalidates old work and its binding signal", async () => {
    reset(); const old = await startScan("owner", "ip", consent);
    readStatus = async () => ({ scanCode: "fixture-code", scanStatus: "confirmed" });
    await pollScan(old.scanId, "owner"); const gate = deferred<string>(); exchange = () => gate.promise;
    await pollScan(old.scanId, "owner"); const completion = scanCompletionSignal(old.scanId, "owner");
    now += 10_000; const latest = await startScan("owner", "ip", consent);
    assert.equal(completion.aborted, true);
    gate.resolve("fixture-oauth"); await setImmediate();
    assert.equal((await pollScan(old.scanId, "owner")).response.status, "expired");
    assert.equal(signIns, 0, "Replacement stops subsequent authorization steps");
    assert.equal((await pollScan(latest.scanId, "owner")).response.status, "scanned");
    assert.throws(() => scanCompletionSignal(old.scanId, "owner"), { code: "AUTH_EXPIRED" });
  });

  await context.test("upstream cooldown before exchange keeps the confirmed code retryable", async () => {
    reset(); const qr = await startScan("owner", "ip", consent);
    readStatus = async () => ({ scanCode: "fixture-code", scanStatus: "confirmed" });
    assert.deepEqual((await pollScan(qr.scanId, "owner")).response, { success: true, status: "scanned", processing: true });
    globalThis.__infraCalcSklandUpstreamCooldownUntil = now + 60_000;
    await assert.rejects(pollScan(qr.scanId, "owner"), error => {
      assert.equal((error as { code?: string }).code, "RATE_LIMITED");
      assert.equal((error as { status?: number }).status, 429);
      assert.equal((error as { retryAfterSeconds?: number }).retryAfterSeconds, 60);
      assert.notEqual((error as { retryable?: boolean }).retryable, false);
      return true;
    });
    assert.equal(tokenCalls, 0);
    now += 60_000;
    assert.deepEqual((await pollScan(qr.scanId, "owner")).response, { success: true, status: "scanned", processing: true });
    await setImmediate();
    assert.equal((await pollScan(qr.scanId, "owner")).response.status, "authenticated");
    assert.equal(tokenCalls, 1); assert.equal(signIns, 1); assert.equal(statusCalls, 1);
  });

  await context.test("authentication errors are terminal and cached without reusing the scan code", async () => {
    reset(); const qr = await startScan("owner", "ip", consent);
    readStatus = async () => ({ scanCode: "fixture-code", scanStatus: "confirmed" });
    exchange = async () => { throw new Error("fixture upstream unavailable"); };
    await pollScan(qr.scanId, "owner"); await pollScan(qr.scanId, "owner"); await setImmediate();
    await assert.rejects(pollScan(qr.scanId, "owner"), { retryable: false });
    await assert.rejects(pollScan(qr.scanId, "owner"), { retryable: false });
    assert.equal(tokenCalls, 1);
  });

  await context.test("authentication has a total deadline and ignores late upstream success", async child => {
    reset(); child.mock.timers.enable({ apis: ["setTimeout"] });
    const qr = await startScan("owner", "ip", consent);
    readStatus = async () => ({ scanCode: "fixture-code", scanStatus: "confirmed" });
    const gate = deferred<string>(); exchange = () => gate.promise;
    await pollScan(qr.scanId, "owner"); await pollScan(qr.scanId, "owner");
    child.mock.timers.tick(SCAN_AUTH_TIMEOUT_MS); await setImmediate();
    await assert.rejects(pollScan(qr.scanId, "owner"), { retryable: false, status: 504 });
    gate.resolve("fixture-oauth"); await setImmediate();
    await assert.rejects(pollScan(qr.scanId, "owner"), { retryable: false, status: 504 });
    assert.equal(signIns, 0); assert.equal(tokenCalls, 1);
  });

  await context.test("generation has a total deadline and late results cannot replace the active code", async child => {
    reset(); const old = await startScan("owner", "ip", consent); now += 10_000;
    child.mock.timers.enable({ apis: ["setTimeout"] });
    const gate = deferred<{ scanId: string; scanUrl: string }>(); generate = () => gate.promise;
    const start = startScan("owner", "ip", consent);
    const rejected = assert.rejects(start, { status: 504 });
    child.mock.timers.tick(SCAN_START_TIMEOUT_MS); await rejected;
    gate.resolve({ scanId: "late", scanUrl: "https://example.invalid/late" }); await setImmediate();
    assert.equal((await pollScan(old.scanId, "owner")).response.status, "waiting");
    assert.equal(globalThis.__infraCalcSklandScanStarts!.size, 0);
    assert.equal((await pollScan("late", "owner")).response.status, "expired");
  });

  await context.test("Endfield authentication keeps the same progress and cancellation guarantees without player reads", async () => {
    reset(); const qr = await startScan("endfield:owner", "ip", consent, "owner");
    readStatus = async () => ({ scanCode: "fixture-code", scanStatus: "confirmed" });
    assert.deepEqual(await pollSklandIdentity(qr.scanId, "endfield:owner"), { status: "scanned", processing: true });
    const abort = new AbortController(); const gate = deferred<string>(); exchange = () => gate.promise;
    await pollSklandIdentity(qr.scanId, "endfield:owner", abort.signal); abort.abort(); gate.resolve("fixture-oauth"); await setImmediate();
    const authenticated = await pollSklandIdentity(qr.scanId, "endfield:owner");
    assert.equal(authenticated.status, "authenticated"); assert.equal(authenticated.session?.accountOAuthToken, undefined);
    assert.equal(playerReads, 0); assert.equal(tokenCalls, 1);
    now += 10_000; await startScan("endfield:owner", "ip", consent, "owner");
    assert.equal((await pollSklandIdentity(qr.scanId, "endfield:owner")).status, "expired");
  });
});
