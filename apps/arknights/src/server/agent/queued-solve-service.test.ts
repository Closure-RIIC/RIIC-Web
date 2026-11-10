import assert from "node:assert/strict";
import test from "node:test";
import type { PublicPlanData } from "@riic/arknights-domain/types";

test("Agent uses the existing task admission route with original auth headers", async t => {
  const result = { diagnosticId: "cached" } as PublicPlanData;
  await t.mock.module(new URL("../../app/api/tasks/route.ts", import.meta.url).href, { namedExports: { POST: async (request: Request) => {
    assert.equal(new URL(request.url).pathname, "/api/tasks");
    assert.equal(request.headers.get("cookie"), "test-session=opaque");
    assert.equal(request.headers.get("origin"), "http://localhost");
    assert.deepEqual(await request.json(), { boxSource: "sample" });
    return Response.json({ success: true, data: { status: "done", result } });
  } } });
  await t.mock.module(new URL("../plan-task.ts", import.meta.url).href, { namedExports: {
    getPlanTask: async () => { throw Error("cached result must not poll"); },
    cancelPlanTask: async () => { throw Error("cached result must not cancel"); },
  } });
  const { runAgentQueuedPlan } = await import("./queued-solve-service.ts");
  const request = new Request("http://localhost/api/agent/chat", { headers: { cookie: "test-session=opaque", origin: "http://localhost" } });
  assert.deepEqual(await runAgentQueuedPlan(request, "test-user", { boxSource: "sample" }, request.signal), result);
});
