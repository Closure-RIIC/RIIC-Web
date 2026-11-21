import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import test from "node:test";
register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) { return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context); } });

test("billing capability matrix rejects sensitive requests before reads or writes", async t => {
  let role = "guest"; let originAllowed = true;
  const calls: string[] = [];
  class PublicApiError extends Error {} class BillingAdminError extends Error {}
  const effect = (name: string) => () => { calls.push(name); return {}; };
  await t.mock.module(new URL("../../../../../packages/platform-server/src/api-contract.ts", import.meta.url), { namedExports: {
    PublicApiError, createRequestId: () => "test",
    assertSameOrigin: () => { calls.push("origin"); if (!originAllowed) throw new Error("origin denied"); },
    enforceRateLimit: effect("rate"), readJsonBody: (r: Request) => r.json(),
    successResponse: (data: unknown) => Response.json({ data }), failureResponse: () => Response.json({ error: "denied" }, { status: 403 }),
  } });
  await t.mock.module(new URL("../../../../../packages/platform-server/src/auth/authorization.ts", import.meta.url), { namedExports: {
    requireWebsiteAdmin: async () => { calls.push("auth"); if (!["admin", "super"].includes(role)) throw new Error("denied"); return { session: { user: { id: "real-admin" } }, isSuperAdmin: role === "super" }; },
    requireWebsiteSuperAdmin: async () => { calls.push("super"); if (role !== "super") throw new Error("denied"); return {}; },
  } });
  await t.mock.module(new URL("../../../../../packages/platform-server/src/referral/service.ts", import.meta.url), { namedExports: {
    ReferralError: class extends Error {}, getReferralCampaign: effect("referral-read"),
    setReferralCampaign: (actor: string) => { assert.equal(actor, "real-admin"); calls.push("referral-write"); return {}; },
  } });
  await t.mock.module(new URL("./monthly-report.ts", import.meta.url), { namedExports: {
    BillingMonthlyError: class extends Error {}, billingMonthlyRange: () => ({ from: new Date(), to: new Date() }), billingMonthly: effect("monthly"),
  } });
  await t.mock.module(new URL("./admin.ts", import.meta.url), { namedExports: {
    BillingAdminError, billingRange: () => ({ from: new Date(), to: new Date() }), billingOverview: effect("summary"),
    listBilling: effect("list"), billingRunDetail: effect("run"), getAgentPolicies: effect("policies"),
    adjustBilling: (actor: string) => { assert.equal(actor, "real-admin"); calls.push("adjust"); return {}; },
    changeAgentPolicy: effect("policy-write"), resolveBillingReview: effect("review"), testAgentFilter: effect("filter-test"),
  } });
  const { GET, POST } = await import("../../app/api/admin/billing/route.ts");
  const request = (section: string, method = "GET") => new Request(`https://riic.test/api/admin/billing?section=${section}`, {
    method, ...(method === "GET" ? {} : { body: JSON.stringify({ enabled: true, actor: "forged" }) }),
  });
  for (role of ["guest", "user", "reviewer"]) {
    for (const [section, method] of [["wallets", "GET"], ["access", "GET"], ["summary", "GET"], ["referral", "POST"], ["adjust", "POST"]]) {
      calls.length = 0;
      assert.equal((await (method === "GET" ? GET : POST)(request(section, method))).status, 403);
      assert.deepEqual(calls, ["auth"]);
    }
  }
  role = "admin";
  assert.deepEqual((await (await GET(request("access"))).json()).data, { isSuperAdmin: false });
  for (const section of ["wallets", "ledger", "orders", "reviews"]) {
    calls.length = 0; assert.equal((await GET(request(section))).status, 200); assert.deepEqual(calls, ["auth", "list"]);
  }
  for (const section of ["summary", "monthly", "usage", "run", "attempts", "filters", "audit", "policies", "referral", "unknown"]) {
    calls.length = 0; assert.equal((await GET(request(section))).status, 403, section); assert.deepEqual(calls, ["auth", "super"]);
  }
  for (const section of ["policies", "referral", "filter-test", "unknown"]) {
    calls.length = 0; assert.equal((await POST(request(section, "POST"))).status, 403, section); assert.deepEqual(calls, ["auth", "super"]);
  }
  for (const section of ["adjust", "review"]) {
    calls.length = 0; assert.equal((await POST(request(section, "POST"))).status, 200); assert.deepEqual(calls, ["auth", "origin", "rate", section]);
  }
  originAllowed = false; calls.length = 0;
  assert.equal((await POST(request("adjust", "POST"))).status, 403); assert.deepEqual(calls, ["auth", "origin"]);
  role = "super";
  for (const section of ["summary", "monthly", "referral", "policies", "run"]) {
    calls.length = 0; const response = await GET(request(section)); assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control")!, /private, no-store/); assert.deepEqual(calls, ["auth", "super", section === "referral" ? "referral-read" : section]);
  }
  calls.length = 0;
  assert.equal((await POST(request("referral", "POST"))).status, 403); assert.deepEqual(calls, ["auth", "super", "origin"]);
  originAllowed = true; calls.length = 0;
  assert.equal((await POST(request("referral", "POST"))).status, 200); assert.deepEqual(calls, ["auth", "super", "origin", "rate", "referral-write"]);
});
