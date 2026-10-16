import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
register("../../../scripts/ts-path-loader.mjs", import.meta.url);

test("attendance routes enforce feature, website login, origin and owned role before signing", async t => {
  let available = true, loggedIn = true, sameOrigin = true;
  const calls: string[] = [];
  class SklandServiceError extends Error {}
  await t.mock.module(new URL("../api-contract.ts", import.meta.url), { namedExports: {
    createRequestId: () => "test", enforceRateLimit: () => calls.push("rate"), assertEmptyBody: async () => {},
    assertSameOrigin: () => { if (!sameOrigin) throw new Error("origin"); },
    successResponse: (data: unknown) => Response.json({ success: true, data }),
  } });
  await t.mock.module(new URL("../auth/authorization.ts", import.meta.url), { namedExports: { requireWebsiteSession: () => { if (!loggedIn) throw new Error("guest"); return { user: { id: "site-owner" } }; } } });
  await t.mock.module(new URL("./http.ts", import.meta.url), { namedExports: {
    assertSklandFeatureEnabled: () => { if (!available) throw new Error("disabled"); }, assertSklandAvailable: () => {},
    readSklandAccountStore: async () => ({ accounts: [{ accountId: "owned", roles: [{ uid: "uid" }], session: { token: "original" } }] }),
    withUpdatedSklandSession: () => ({}), setSklandAccountStoreCookies: () => calls.push("cookie"),
    sklandErrorResponse: () => Response.json({ success: false }, { status: 403 }),
  } });
  await t.mock.module(new URL("./adapter.ts", import.meta.url), { namedExports: { SklandServiceError, sklandAttendance: (_session: unknown, uid: string, sign: boolean) => { calls.push(sign ? "sign" : "read"); return { session: { token: "original" }, attendance: { uid, hasToday: true, signedNow: sign } }; } } });
  const { GET, POST } = await import("../../app/api/skland/attendance/route.ts");
  const req = (account = "owned", uid = "uid") => new Request(`https://riic.test/api/skland/attendance?accountId=${account}&uid=${uid}`, { method: "POST" });
  for (const gate of ["feature", "login", "origin"]) {
    available = gate !== "feature"; loggedIn = gate !== "login"; sameOrigin = gate !== "origin";
    calls.length = 0; assert.equal((await POST(req())).status, 403); assert.equal(calls.includes("sign"), false);
  }
  available = loggedIn = sameOrigin = true;
  for (const request of [req("stolen"), req("owned", "foreign")]) { calls.length = 0; assert.equal((await POST(request)).status, 403); assert.equal(calls.includes("sign"), false); }
  calls.length = 0;
  const response = await POST(req());
  assert.equal(response.status, 200); assert.deepEqual(calls, ["rate", "sign"]); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  calls.length = 0; await GET(new Request(req().url)); assert.deepEqual(calls, ["rate", "read"]);
});
