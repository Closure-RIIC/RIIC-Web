import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("../../../../scripts/ts-path-loader.mjs", import.meta.url);

test("page readiness coalesces probes while deployment health always probes and preserves failures", async (context) => {
  let calls = 0;
  let ready = true;
  await context.mock.module(new URL("./public-health.ts", import.meta.url), {
    namedExports: { probePublicHealth: async () => {
      calls++;
      return { status: ready ? "ready" : "unavailable", plannerReady: ready,
        taskQueue: { enabled: true, ready, releaseMatched: ready },
        features: { debugTools: false, rateLimit: true } };
    } },
  });
  const health = await import("../app/api/health/route.ts");
  const readiness = await import("../app/api/readiness/route.ts");
  const responses = await Promise.all([readiness.GET(), readiness.GET(), readiness.GET()]);
  assert.equal(calls, 1);
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  await health.GET();
  await health.GET();
  assert.equal(calls, 3);
  ready = false;
  const failure = await health.GET();
  assert.equal(failure.status, 503);
  assert.equal(failure.headers.get("Cache-Control"), "no-store");
  assert.equal((await failure.json()).data.taskQueue.releaseMatched, false);
  assert.equal(calls, 4);
});
