import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import test from "node:test";
import { TERMS_VERSION, PRIVACY_VERSION } from "@riic/platform/legal-policy";

register("../../../../scripts/ts-path-loader.mjs", import.meta.url);
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : nextResolve(specifier, context);
} });
process.once("exit", () => hook.deregister());

test("Skland reuse requires consent and an owned login, and returns only public role data", async (context) => {
  let authenticated = true;
  let connected = false;
  let existing = false;
  let exchanges = 0;
  const owners: string[] = [];
  await context.mock.module(new URL("../../../../packages/platform-server/src/api-contract.ts", import.meta.url), { namedExports: {
    assertSameOrigin: (request: Request) => { if (request.headers.get("origin") !== "https://riic.test") throw new Error("origin"); },
    createRequestId: () => "test-id", enforceRateLimit: () => {}, requestClientIp: () => "127.0.0.1",
    readJsonBody: (request: Request) => request.json(),
    PublicApiError: class extends Error {},
    failureResponse: () => Response.json({ success: false }, { status: 400 }),
    successResponse: (data: unknown) => Response.json({ success: true, data }),
  } });
  await context.mock.module(new URL("../../../../packages/platform-server/src/auth/authorization.ts", import.meta.url), { namedExports: {
    requireWebsiteSession: async () => { if (!authenticated) throw new Error("login"); return { user: { id: "verified-owner" } }; },
  } });
  await context.mock.module(new URL("../../../../packages/platform-server/src/skland/http.ts", import.meta.url), { namedExports: {
    assertSklandFeatureEnabled: () => {},
    readSklandAccountStore: async (owner: string) => { owners.push(owner); return { accounts: connected ? [
      { accountId: "second", session: { selectedUid: "10002", cred: "second-cred" }, roles: [{ uid: "10002" }] },
    ] : [] }; },
    activeSklandAccount: () => connected ? { session: { selectedUid: "10001", cred: "private-cred" } } : null,
  } });
  await context.mock.module(new URL("./gacha-history.ts", import.meta.url), { namedExports: {
    gachaCookieName: () => "aic_gacha_session",
    gachaSession: (_request: Request, owner: string) => { assert.equal(owner, "verified-owner"); return existing ? { roles: [{ uid: "10001" }] } : null; },
    publicGachaRoles: () => [{ uid: "10001", nickname: "test" }], publicGachaError: (error: unknown) => error,
    authorizeGachaFromSkland: async (owner: string, session: { cred: string }) => {
      assert.equal(owner, "verified-owner"); assert.ok(["private-cred", "second-cred"].includes(session.cred)); exchanges++;
      const uid = session.cred === "second-cred" ? "10002" : "10001";
      return { sessionId: "opaque-session", selectedUid: uid, roles: [{ uid, nickname: "test" }] };
    },
  } });
  const { POST } = await import("../app/api/gacha/skland/route.ts");
  const consent = { termsAccepted: true, privacyAccepted: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION };
  const body = { consent, gachaConsent: true, owner: "spoofed-owner", cred: "spoofed-cred" };
  const request = (value: unknown, origin = "https://riic.test") => new Request("https://riic.test/api/gacha/skland", {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(value),
  });
  assert.equal((await POST(request(body, "https://other.test"))).status, 400);
  authenticated = false;
  assert.equal((await POST(request(body))).status, 400);
  authenticated = true;
  assert.equal((await POST(request({ consent, gachaConsent: false }))).status, 400);
  assert.equal((await POST(request(null))).status, 400);
  assert.equal(owners.length, 0);
  assert.equal((await POST(request(body))).status, 400);
  assert.equal(exchanges, 0);
  connected = true;
  const response = await POST(request(body));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, data: { roles: [{ uid: "10001", nickname: "test" }], selectedUid: "10001" } });
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(response.headers.getSetCookie(), ["aic_gacha_session=opaque-session; Max-Age=3600; Path=/api/gacha; HttpOnly; Secure; SameSite=Lax"]);
  assert.equal(exchanges, 1);
  existing = true;
  const reused = await POST(request(body));
  assert.equal(reused.status, 200);
  assert.equal(exchanges, 1);
  assert.deepEqual(reused.headers.getSetCookie(), []);
  assert.equal((await POST(request({ ...body, accountId: "other-owner-account" }))).status, 400);
  assert.equal((await POST(request({ ...body, accountId: "second", uid: "10003" }))).status, 400);
  const second = await POST(request({ ...body, accountId: "second", uid: "10002" }));
  assert.equal(second.status, 200);
  assert.equal((await second.json()).data.selectedUid, "10002");
  assert.equal(exchanges, 2);
  assert.ok(owners.every((owner) => owner === "verified-owner"));
});
