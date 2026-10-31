import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { PRIVACY_VERSION, TERMS_VERSION } from "@riic/platform/legal-policy";
import { createSklandStoredAccount, sealOwnedSklandAccount, unsealOwnedSklandAccount, websiteUserOwnerTag, type SklandSessionPayload } from "./session.ts";
import { PublicApiError } from "../api-contract.ts";
register("../../../../scripts/ts-path-loader.mjs", import.meta.url);

test("Endfield API authenticates, enforces consent/ownership, encrypts cookies and preserves Arknights selection", async context => {
  const originalSecret = process.env.SKLAND_SESSION_SECRET;
  process.env.SKLAND_SESSION_SECRET = "isolated-test-secret-do-not-use-0123456789";
  context.after(() => { if (originalSecret === undefined) delete process.env.SKLAND_SESSION_SECRET; else process.env.SKLAND_SESSION_SECRET = originalSecret; });
  let signedIn = true;
  const cookies: Record<string, string> = {};
  const calls: unknown[][] = [];
  const roles = [{ uid: "endfield-uid", roleId: "endfield-role", serverId: "endfield-server", nickname: "Endfield only", serverName: "Test", isDefault: true }];
  const session: SklandSessionPayload = { version: 3, cred: "private-cred", token: "private-token", dId: "device",
    userId: "skland-user", selectedUid: "arknights-role", refreshedAt: Date.now(), expiresAt: Date.now() + 3600000,
    policyConsent: { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, acceptedAt: Date.now() } };
  const original = createSklandStoredAccount(session, [{ uid: "arknights-role", nickname: "Ark", channelName: "Official", isDefault: true }], "account-12345678");
  const returnedSnapshot = { game: "endfield", role: { roleId: "endfield-role" }, characters: [], rooms: [], fetchedAt: Date.now() };
  await context.mock.module(new URL("../request-context.ts", import.meta.url), { namedExports: { getCookies: () => cookies } });
  await context.mock.module(new URL("../auth/authorization.ts", import.meta.url), { namedExports: {
    requireWebsiteSession: async () => { if (!signedIn) throw new PublicApiError("AIC-AUTH-2008"); return { user: { id: "owner-a" } }; },
  } });
  await context.mock.module(new URL("./bindings.ts", import.meta.url), { namedExports: {
    bindSklandAccount: async (...args: unknown[]) => { calls.push(["bind", ...args]); },
  } });
  await context.mock.module(new URL("./http.ts", import.meta.url), { namedExports: {
    assertSklandAvailable: () => {},
    readSklandAccountStore: async (owner: string) => { assert.equal(owner, "owner-a"); return { accounts: [original], activeAccountId: original.accountId }; },
    sklandErrorResponse: (error: unknown) => Response.json({ success: false, error: { message: error instanceof Error ? error.message : "Error" } }, { status: error instanceof PublicApiError ? error.status : 500 }),
  } });
  await context.mock.module(new URL("./endfield-adapter.ts", import.meta.url), { namedExports: {
    endfieldScanCompletionSignal: () => new AbortController().signal,
    invalidateEndfieldSnapshots: () => {},
    endfieldCredential: async () => ({ session: { ...session, selectedUid: "" }, result: roles }),
    endfieldRoles: async (value: SklandSessionPayload) => ({ session: { ...value, token: "refreshed-token" }, result: roles }),
    endfieldSync: async (value: SklandSessionPayload, selected: unknown) => { calls.push(["sync", selected]); return { session: value, result: returnedSnapshot }; },
    startEndfieldScan: async (...args: unknown[]) => { calls.push(["qr", ...args]); return { scanId: "scan-a", scanUrl: "https://example.invalid/scan", expiresInSeconds: 600 }; },
    pollEndfieldScan: async (...args: unknown[]) => { calls.push(["poll", ...args]); return { status: "authenticated", session, result: roles }; },
    consumeEndfieldScan: (...args: unknown[]) => { calls.push(["consume", ...args]); },
  } });
  const { handleEndfieldSkland, ENDFIELD_SKLAND_COOKIE } = await import("./endfield-api.ts");
  const request = (body: unknown, origin = "https://riic.test") => new Request("https://riic.test/api/endfield/skland/action", {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const accepted = { termsAccepted: true, privacyAccepted: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION };
  signedIn = false;
  assert.equal((await handleEndfieldSkland(request({}), "roles")).status, 401);
  signedIn = true;
  assert.equal((await handleEndfieldSkland(request({}, "https://evil.invalid"), "roles")).status, 403);
  assert.equal((await handleEndfieldSkland(request({ credential: "c,t" }), "credential")).status, 400);
  assert.equal((await handleEndfieldSkland(request({ credential: "null,undefined", consent: accepted }), "credential")).status, 400);
  assert.equal((await handleEndfieldSkland(request({ accountId: "not-owned" }), "roles")).status, 401);
  const other = sealOwnedSklandAccount(original, websiteUserOwnerTag("owner-b"));
  cookies[ENDFIELD_SKLAND_COOKIE] = other;
  const denied = await handleEndfieldSkland(request({ accountId: "endfield-direct" }), "roles");
  assert.equal(denied.status, 401); assert.match(denied.headers.get("cache-control")!, /no-store/);
  delete cookies[ENDFIELD_SKLAND_COOKIE];

  const credential = await handleEndfieldSkland(request({ credential: "fixture,fixture-token", consent: accepted }), "credential");
  assert.equal(credential.status, 200);
  const body = await credential.json();
  const directId = body.data.accountId;
  assert.match(directId, /^[A-Za-z0-9_-]{8,64}$/);
  assert.doesNotMatch(JSON.stringify(body), /private-cred|private-token/);
  const value = credential.headers.getSetCookie()[0];
  assert.ok(value.startsWith(`skland_endfield_account_v1_${directId}=`)); assert.match(value, /HttpOnly/); assert.match(value, /Secure/);
  const sealed = value.split(";")[0].split("=")[1];
  assert.doesNotMatch(sealed, /private-cred/);
  assert.equal(unsealOwnedSklandAccount(sealed, websiteUserOwnerTag("owner-a"))?.session.userId, "skland-user");
  assert.equal(unsealOwnedSklandAccount(sealed, websiteUserOwnerTag("owner-b")), null);
  assert.deepEqual(calls.find(item => item[0] === "bind"), ["bind", "owner-a", "skland-user"]);
  cookies[`skland_endfield_account_v1_${directId}`] = sealed;
  const accountList = await handleEndfieldSkland(new Request("https://riic.test/api/endfield/skland/accounts"), "accounts");
  assert.equal((await accountList.json()).data.accounts.length, 1, "Same Skland identity is not listed twice");

  const loaded = await handleEndfieldSkland(request({ accountId: original.accountId }), "roles");
  assert.equal(loaded.status, 200);
  assert.equal(loaded.headers.getSetCookie().length, 1);
  assert.match(loaded.headers.getSetCookie()[0], /^skland_account_v3_account-12345678=/);
  const refreshed = unsealOwnedSklandAccount(loaded.headers.getSetCookie()[0].split(";")[0].split("=")[1], websiteUserOwnerTag("owner-a"));
  assert.equal(refreshed?.session.selectedUid, "arknights-role");
  assert.deepEqual(refreshed?.roles, original.roles);
  assert.equal(original.session.token, "private-token", "Existing store is not mutated");
  const sync = await handleEndfieldSkland(request({ accountId: directId, roleId: "endfield-role", serverId: "endfield-server" }), "sync");
  assert.equal(sync.status, 200);
  assert.deepEqual((await sync.json()).data.snapshot, returnedSnapshot);

  assert.equal((await handleEndfieldSkland(request({ consent: accepted }), "qr")).status, 200);
  const qr = await handleEndfieldSkland(request({ scanId: "scan-a" }), "qr-status");
  assert.equal(qr.status, 200);
  const qrBody = await qr.json();
  assert.equal(qrBody.data.status, "authenticated");
  assert.equal(qrBody.data.accountId, directId, "Logging in again preserves the account identity");
  assert.deepEqual(calls.find(item => item[0] === "consume"), ["consume", "scan-a", "owner-a"]);
  assert.equal((await handleEndfieldSkland(request({ accountId: "not-owned" }), "disconnect")).status, 401);
  const disconnect = await handleEndfieldSkland(request({ accountId: directId }), "disconnect");
  assert.equal(disconnect.headers.getSetCookie().length, 1);
  assert.ok(disconnect.headers.getSetCookie()[0].startsWith(`skland_endfield_account_v1_${directId}=;`));
  assert.match(disconnect.headers.getSetCookie()[0], /Max-Age=0/);
});
