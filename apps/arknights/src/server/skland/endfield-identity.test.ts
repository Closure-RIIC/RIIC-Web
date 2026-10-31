import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { PRIVACY_VERSION, TERMS_VERSION } from "@riic/platform/legal-policy";
register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);

test("QR identity exchange is owner-scoped, deduplicated, retryable after abort and game-independent", async context => {
  let reads = 0, signIns = 0;
  let finish!: () => void;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  const abort = new AbortController();
  const client = {
    storage: { getItem: async () => "test-device", setItem: async () => {} },
    collections: { hypergryph: {
      generateScanLoginUrl: async () => ({ scanId: "scan-fixture", scanUrl: "https://example.invalid/scan" }),
      getScanStatus: async () => { reads++; await wait; return { scanCode: "code" }; },
      getOAuthTokenByScanCode: async () => "private-oauth",
      grantAuthorizeCode: async () => ({ code: "grant" }),
    } },
    signIn: async () => { signIns++; abort.abort(); return { cred: "private-cred", token: "private-token", userId: "skland-user" }; },
  };
  await context.mock.module("skland-kit", { namedExports: {
    createClient: () => client, STORAGE_CREDENTIAL_KEY: "cred", STORAGE_DID_KEY: "did",
    STORAGE_OAUTH_TOKEN_KEY: "token", STORAGE_USER_ID_KEY: "uid",
  } });
  await context.mock.module(new URL("../../../../../packages/platform-server/src/skland/operator-snapshot-store.ts", import.meta.url), { namedExports: { persistOperatorSnapshot: async () => { throw new Error("Must not read or persist Arknights data"); } } });
  await context.mock.module(new URL("../../../../../packages/platform-server/src/skland/layout-suggestion.ts", import.meta.url), { namedExports: { sklandLayoutSuggestion: () => { throw new Error("Must not evaluate Arknights layout"); } } });
  const { startScan, pollSklandIdentity, pollScan, consumeScan } = await import("@riic/platform-server/skland/adapter");
  await startScan("endfield:owner", "fixture", { termsAccepted: true, privacyAccepted: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION });
  assert.equal((await pollSklandIdentity("scan-fixture", "other")).status, "expired");
  assert.equal((await pollScan("scan-fixture", "owner")).response.status, "expired", "Arknights cannot consume Endfield scan");
  assert.equal(reads, 0);
  const first = pollSklandIdentity("scan-fixture", "endfield:owner", abort.signal);
  const duplicate = pollSklandIdentity("scan-fixture", "endfield:owner");
  finish();
  assert.deepEqual(await first, { status: "scanned", processing: true });
  assert.deepEqual(await duplicate, { status: "scanned", processing: true });
  assert.deepEqual(await pollSklandIdentity("scan-fixture", "endfield:owner", abort.signal), { status: "scanned", processing: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(abort.signal.aborted, true);
  const retried = await pollSklandIdentity("scan-fixture", "endfield:owner");
  assert.equal(retried.status, "authenticated");
  assert.equal(retried.session?.selectedUid, "");
  assert.equal(retried.session?.accountOAuthToken, undefined, "Unused OAuth is not persisted");
  assert.equal(signIns, 1); assert.equal(reads, 1);
  consumeScan("scan-fixture", "other");
  assert.equal((await pollSklandIdentity("scan-fixture", "endfield:owner")).status, "authenticated");
  consumeScan("scan-fixture", "endfield:owner");
  assert.equal((await pollSklandIdentity("scan-fixture", "endfield:owner")).status, "expired");
});
