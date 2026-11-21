import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import test from "node:test";

register("../../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) { return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context); } });

test("referral summary uses the session identity and remains private for guests and users", async t => {
  let userId: string | null = null;
  const seen: Array<string | null> = [];
  await t.mock.module(new URL("../../../../packages/platform-server/src/auth/index.ts", import.meta.url), { namedExports: { websiteSession: async () => userId ? { user: { id: userId } } : null } });
  await t.mock.module(new URL("../../../../packages/platform-server/src/referral/service.ts", import.meta.url), { namedExports: {
    ReferralError: class extends Error {},
    getReferralSummary: async (id: string | null) => { seen.push(id); return { enabled: true, account: id ? { code: "OWN-CODE" } : null }; },
  } });
  await t.mock.module(new URL("../../../../packages/platform-server/src/api-contract.ts", import.meta.url), { namedExports: {
    PublicApiError: class extends Error {}, createRequestId: () => "request", enforceRateLimit: () => {}, successResponse: (data: unknown) => Response.json({ data }), failureResponse: () => Response.json({ error: "denied" }, { status: 403 }),
  } });
  const { GET } = await import("../app/api/referral/route.ts");
  const guest = await GET(new Request("https://riic.test/api/referral?userId=forged"));
  assert.equal((await guest.json()).data.account, null);
  assert.match(guest.headers.get("Cache-Control")!, /private, no-store/);
  userId = "actual-user";
  const user = await GET(new Request("https://riic.test/api/referral?userId=someone-else"));
  assert.equal((await user.json()).data.account.code, "OWN-CODE");
  assert.deepEqual(seen, [null, "actual-user"]);
});
