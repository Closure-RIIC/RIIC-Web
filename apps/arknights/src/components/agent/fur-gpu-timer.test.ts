import assert from "node:assert/strict";
import test from "node:test";
import { createFurGpuTimer } from "./fur-gpu-timer.ts";

function driver(supported = true) {
  const results = new Map<WebGLQuery, { available: boolean; ns: number }>();
  const deleted: WebGLQuery[] = [];
  let disjoint = false, lost = false, ended = 0, resultReads = 0;
  const gl = {
    QUERY_RESULT_AVAILABLE: 1, QUERY_RESULT: 2,
    getExtension: () => supported ? { TIME_ELAPSED_EXT: 3, GPU_DISJOINT_EXT: 4 } : null,
    getParameter: () => disjoint,
    createQuery() { const query = {}; results.set(query, { available: false, ns: 0 }); return query; },
    beginQuery() {},
    endQuery() { ended++; },
    getQueryParameter(query: WebGLQuery, parameter: number) {
      const result = results.get(query)!;
      if (parameter === 1) return result.available;
      resultReads++;
      assert.equal(result.available, true, "must never wait for an unavailable query result");
      return result.ns;
    },
    deleteQuery(query: WebGLQuery) { deleted.push(query); },
    isContextLost: () => lost,
  };
  return {
    gl, results, deleted,
    disjoint(value: boolean) { disjoint = value; },
    lose() { lost = true; },
    reads: () => resultReads,
    ended: () => ended,
  };
}

test("GPU queries do not read results until available and convert nanoseconds to milliseconds", () => {
  const fake = driver(), timer = createFurGpuTimer(fake.gl);
  timer.begin(); timer.end();
  assert.equal(timer.milliseconds(), null);
  assert.equal(fake.reads(), 0);
  const result = [...fake.results.values()][0];
  result.available = true; result.ns = 8_750_000;
  assert.equal(timer.milliseconds(), 8.75);
  assert.equal(fake.deleted.length, 1);
  timer.dispose();
  assert.equal(fake.deleted.length, 1);
  assert.equal(timer.milliseconds(), null);
});

test("slow drivers have a bounded query queue and recover once results arrive", () => {
  const fake = driver(), timer = createFurGpuTimer(fake.gl);
  for (let i = 0; i < 20; i++) { timer.begin(); timer.end(); }
  assert.equal(fake.results.size, 3);
  assert.equal(fake.reads(), 0);
  for (const result of fake.results.values()) { result.available = true; result.ns = 2_000_000; }
  timer.begin(); timer.end();
  assert.equal(fake.results.size, 4);
  assert.equal(fake.deleted.length, 3);
  assert.equal(timer.milliseconds(), 2);
  timer.dispose();
  assert.equal(fake.deleted.length, 4);
});

test("disjoint timing invalidates both completed measurements and pending work", () => {
  const fake = driver(), timer = createFurGpuTimer(fake.gl);
  timer.begin(); timer.end();
  const result = [...fake.results.values()][0];
  result.available = true; result.ns = 5_000_000;
  assert.equal(timer.milliseconds(), 5);
  timer.begin(); timer.end();
  fake.disjoint(true);
  assert.equal(timer.milliseconds(), null);
  timer.begin(); timer.end();
  assert.equal(fake.results.size, 2);
  assert.equal(fake.deleted.length, 2);
  fake.disjoint(false);
  timer.begin(); timer.end();
  assert.equal(fake.results.size, 3);
  timer.dispose();
});

test("unsupported timer extensions leave rendering and telemetry optional", () => {
  const fake = driver(false), timer = createFurGpuTimer(fake.gl);
  timer.begin(); timer.end();
  assert.equal(timer.milliseconds(), null);
  assert.equal(fake.results.size, 0);
  timer.dispose(); timer.dispose();
});

test("active queries are ended on disposal, but never after context loss", () => {
  const fake = driver(), timer = createFurGpuTimer(fake.gl);
  timer.begin(); timer.begin();
  assert.equal(fake.results.size, 1);
  timer.dispose(); timer.dispose();
  assert.equal(fake.ended(), 1);
  assert.equal(fake.deleted.length, 1);
  timer.begin(); timer.end();
  assert.equal(fake.results.size, 1);
  const lostFake = driver(), lostTimer = createFurGpuTimer(lostFake.gl);
  lostTimer.begin(); lostFake.lose(); lostTimer.dispose();
  assert.equal(lostFake.ended(), 0);
  assert.equal(lostFake.deleted.length, 1);
});
