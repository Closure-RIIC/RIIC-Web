import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import test from "node:test";

register("../../../../scripts/ts-path-loader.mjs", import.meta.url);
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : nextResolve(specifier, context);
  },
});
process.once("exit", () => hook.deregister());

test("report API stores three integer days and permits blank metrics", async (context) => {
  const writes: unknown[] = [];
  await context.mock.module(new URL("../../../../packages/platform-server/src/api-contract.ts", import.meta.url), { namedExports: {
    assertEmptyBody: async () => {},
    assertSameOrigin: () => {},
    createRequestId: () => "request-id",
    enforceRateLimit: () => {},
    failureResponse: () => Response.json({ success: false }, { status: 400 }),
    PublicApiError: class extends Error {},
    readJsonBody: (request: Request) => request.json(),
    requestClientIp: () => "127.0.0.1",
    successResponse: (data: unknown) => Response.json({ success: true, data }),
  } });
  await context.mock.module(new URL("../../../../packages/platform-server/src/auth/authorization.ts", import.meta.url), { namedExports: {
    requireWebsiteSession: async () => ({ user: { id: "verified-user" } }),
  } });
  await context.mock.module(new URL("./game-report-store.ts", import.meta.url), { namedExports: {
    latestGameReport: async (userId: string) => ({ userId }),
    saveGameReport: async (...args: unknown[]) => { writes.push(args); return { id: "saved" }; },
  } });
  const { handleGetGameReport, handlePostGameReport } = await import("./game-report-api.ts");
  const days = Array.from({ length: 3 }, () => ({ experience: 0, goldValue: 50000, lmd: 75000, orderCount: 39, orundum: 0 }));
  const post = (body: unknown) => new Request("https://riic.test/api/account/game-report", { method: "POST", body: JSON.stringify(body) });
  assert.equal((await handlePostGameReport(post({ sourceType: "manual", days }))).status, 200);
  assert.deepEqual(writes, [["verified-user", "manual", days]]);
  assert.equal((await handlePostGameReport(post({ sourceType: "manual", days: days.slice(0, 1) }))).status, 400);
  assert.equal((await handlePostGameReport(post({ sourceType: "manual", days: days.map((day) => ({
    experience: day.experience, goldValue: day.goldValue, lmd: day.lmd, orundum: day.orundum,
  })) }))).status, 200);
  assert.equal((await handlePostGameReport(post({ sourceType: "manual", days: [{}, {}, {}] }))).status, 400);
  assert.equal((await handlePostGameReport(post({ sourceType: "screenshot", days: [{ ...days[0], lmd: 1.5 }, days[1], days[2]] }))).status, 400);
  assert.equal(writes.length, 2);
  assert.deepEqual((await (await handleGetGameReport(new Request("https://riic.test/api/account/game-report"))).json()).data, { userId: "verified-user" });
});
