import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import test from "node:test";
import { canAccessFeature, featureAccessMode } from "../../feature-access.ts";

register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) {
  return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context);
} });

test("rollout defaults closed and supports independent public/disabled modes", () => {
  for (const value of [undefined, "", "typo", "PUBLIC"]) {
    assert.equal(featureAccessMode("agent", { AGENT_ACCESS_MODE: value }), "admin");
  }
  assert.equal(featureAccessMode("agent", { AGENT_ACCESS_MODE: "public", BILLING_ACCESS_MODE: "disabled" }), "public");
  assert.equal(featureAccessMode("billing", { AGENT_ACCESS_MODE: "public", BILLING_ACCESS_MODE: "disabled" }), "disabled");
  for (const admin of [true, false]) {
    assert.equal(canAccessFeature("public", admin), true);
    assert.equal(canAccessFeature("disabled", admin), false);
    assert.equal(canAccessFeature("admin", admin), admin);
  }
});

test("database roles guard all Agent/billing APIs before reads, writes or model calls", async (t) => {
  const originalEnv = { ...process.env };
  t.after(() => { process.env = originalEnv; });
  let session: { user: { id: string; role?: string } } | null = null;
  let record: { role: string; banned: boolean } | null = { role: "user", banned: false };
  let effects = 0;
  const effect = async () => { effects++; return { totalPoints: 10 }; };
  class ApiError extends Error { code: string; constructor(code: string) { super(code); this.code = code; } }
  const statusFor = (code: string) => code === "AIC-AUTH-2008" ? 401 : code === "AIC-AUTH-2007" ? 404 : 403;
  await t.mock.module(new URL("../../../../../packages/platform-server/src/api-contract.ts", import.meta.url), { namedExports: {
    PublicApiError: ApiError, assertSameOrigin: () => {}, createRequestId: () => "test",
    enforceRateLimit: () => {},
    readJsonBody: (request: Request) => request.json(),
    failureResponse: (error: ApiError) => Response.json({ code: error.code }, { status: statusFor(error.code) }),
    successResponse: (data: unknown) => Response.json({ data }),
  } });
  await t.mock.module(new URL("../../../../../packages/platform-server/src/auth/index.ts", import.meta.url), { namedExports: { websiteSession: async () => session } });
  await t.mock.module(new URL("../../../../../packages/platform-server/src/db/index.ts", import.meta.url), { namedExports: { getDatabase: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => record ? [record] : [] }) }) }),
  }), getDatabasePool: () => { effects++; throw new Error("Denied requests must not open the accounting pool"); } } });
  await t.mock.module(new URL("../../../../../packages/platform-server/src/db/schema.ts", import.meta.url), { namedExports: { user: { id: "id", role: "role", banned: "banned" } } });
  await t.mock.module(new URL("../billing/service.ts", import.meta.url), { namedExports: {
    BillingError: class extends Error {}, createBillingOrder: effect, getWallet: effect,
    listBillingProducts: () => [], listLedger: effect, listOrders: effect, listUsage: effect,
    issueGiftCdk: effect, redeemGiftCdk: effect, fulfillBillingOrder: effect, getOrder: effect,
    createAgentUsage: effect, finalizeAgentUsage: effect, hidePendingOrder: effect, hideAllPendingOrders: effect,
  } });
  await t.mock.module(new URL("../agent/plan-artifact.ts", import.meta.url), { namedExports: { getAgentPlanArtifact: effect } });
  await t.mock.module(new URL("../agent/config.ts", import.meta.url), { namedExports: { agentLlmSettings: () => ({ configured: false }), agentModelChoices: () => [] } });
  await t.mock.module(new URL("../agent/llm.ts", import.meta.url), { namedExports: { getAgentModel: effect } });
  await t.mock.module(new URL("../agent/persona.ts", import.meta.url), { namedExports: { buildAgentSystemPrompt: effect } });
  await t.mock.module(new URL("../agent/resources.ts", import.meta.url), { namedExports: { activeAgentResources: effect } });
  await t.mock.module(new URL("../agent/tools.ts", import.meta.url), { namedExports: { buildAgentTools: effect } });
  const { getFeatureAccess, requireFeatureSession } = await import("./feature-access.ts");
  const billing = await import("../../app/api/billing/route.ts");
  const cdk = await import("../../app/api/billing/cdk/route.ts");
  const orders = await import("../../app/api/billing/orders/[id]/route.ts");
  const simulate = await import("../../app/api/billing/orders/[id]/simulate-paid/route.ts");
  const plans = await import("../../app/api/agent/plan/[id]/route.ts");
  const chat = await import("../../app/api/agent/chat/route.ts");
  const context = { params: Promise.resolve({ id: "test-id" }) };
  const get = () => new Request("https://riic.test/api/test");
  const post = () => new Request("https://riic.test/api/test", { method: "POST", body: "{}" });
  const handlers = [() => billing.GET(get()), () => billing.POST(post()), () => billing.DELETE(new Request("https://riic.test/api/test", { method: "DELETE" })), () => cdk.POST(post()),
    () => orders.GET(get(), context), () => orders.DELETE(new Request("https://riic.test/api/test", { method: "DELETE" }), context), () => simulate.POST(post(), context),
    () => plans.GET(get(), context), () => chat.GET(get()), () => chat.POST(post())];
  process.env.AGENT_ACCESS_MODE = "admin";
  process.env.BILLING_ACCESS_MODE = "admin";
  process.env.BILLING_PROTOTYPE_MODE = "1";
  process.env.BETTER_AUTH_ADMIN_USER_IDS = "bootstrap-admin";
  for (const identity of ["anonymous", "user", "reviewer", "forged-admin"]) {
    session = identity === "anonymous" ? null : { user: { id: identity, role: "admin" } };
    record = { role: identity === "reviewer" ? "reviewer" : "user", banned: false };
    assert.deepEqual(await getFeatureAccess(get()), { agent: false, billing: false });
    for (const call of handlers) {
      assert.equal((await call()).status, identity === "anonymous" ? 401 : 403, identity);
    }
  }
  assert.equal(effects, 0, "denied requests must not touch billing, plans or model execution");
  session = { user: { id: "admin", role: "user" } };
  record = { role: "admin", banned: false };
  assert.equal((await requireFeatureSession(get(), "agent")).user.id, "admin");
  assert.deepEqual(await getFeatureAccess(get()), { agent: true, billing: true });
  const adminBilling = await billing.GET(get());
  assert.equal(adminBilling.status, 200);
  assert.equal((await adminBilling.json()).data.canSimulatePayment, true);
  effects = 0;
  record.role = "user";
  await assert.rejects(requireFeatureSession(get(), "agent"), { code: "AIC-AUTH-2009" });
  session.user.id = "bootstrap-admin";
  assert.equal((await requireFeatureSession(get(), "billing")).user.id, "bootstrap-admin");
  record.banned = true;
  await assert.rejects(requireFeatureSession(get(), "agent"), { code: "AIC-AUTH-2009" });
  record = null;
  await assert.rejects(requireFeatureSession(get(), "agent"), { code: "AIC-AUTH-2009" });
  record = { role: "user", banned: false };
  session.user.id = "member";
  process.env.AGENT_ACCESS_MODE = "public";
  assert.equal((await requireFeatureSession(get(), "agent")).user.id, "member");
  assert.deepEqual(await getFeatureAccess(get()), { agent: true, billing: false });
  process.env.BILLING_ACCESS_MODE = "public";
  const memberBilling = await billing.GET(get());
  assert.equal(memberBilling.status, 200);
  assert.equal((await memberBilling.json()).data.canSimulatePayment, false);
  effects = 0;
  assert.equal((await simulate.POST(post(), context)).status, 403, "public billing must not expose simulated credits");
  assert.equal(effects, 0);
  session = null;
  await assert.rejects(requireFeatureSession(get(), "agent"), { code: "AIC-AUTH-2008" });
  process.env.AGENT_ACCESS_MODE = "disabled";
  await assert.rejects(requireFeatureSession(get(), "agent"), { code: "AIC-AUTH-2007" });
});
