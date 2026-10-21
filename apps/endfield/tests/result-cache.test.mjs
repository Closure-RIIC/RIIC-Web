import test from "node:test";
import assert from "node:assert/strict";
import { catalog, DEFAULT_OPTIONS, solve, parseWorkspace } from "../../../packages/endfield-solver/index.mjs";
import { encodeResultCache, restoreResultCache, workspaceKey } from "../src/result-cache.ts";

const workspace = {
  version: 1,
  operators: catalog.slice(0, 8).map(op => ({ name: op.name, elite: 0 })),
  options: { ...DEFAULT_OPTIONS, levels: { center: 1, mfg1: 1, mfg2: 1, grow: 0, guest: 0 }, grow: { 晶植: 0, 菌类: 0, 矿物: 0 } },
};
const result = solve(workspace);
const encoded = encodeResultCache(workspace, result);

test("a verified result survives workspace restoration and equivalent sync data", () => {
  assert.ok(encoded);
  const restored = parseWorkspace(JSON.stringify(workspace));
  assert.equal(workspaceKey(restored), workspaceKey(workspace));
  assert.deepEqual(restoreResultCache(encoded, restored), result);
  const reorderedFields = structuredClone(workspace);
  reorderedFields.options.levels = { guest: 0, mfg2: 1, center: 1, grow: 0, mfg1: 1 };
  assert.equal(workspaceKey(reorderedFields), workspaceKey(workspace));
  assert.deepEqual(restoreResultCache(encoded, reorderedFields), result);
});

test("roster, elite stages, facilities, production, priorities and manual changes invalidate saved results", () => {
  const changes = [
    next => next.operators.pop(),
    next => next.operators[0].elite++,
    next => next.options.levels.center++,
    next => next.options.mfg = "2干员",
    next => next.options.grow.晶植++,
    next => next.options.priority.reverse(),
    next => next.options.assist = true,
    next => next.options.budget++,
    next => next.options.time++,
    next => next.manual = [{ key: "中枢", slots: 1, hour: 12, a: [], b: [] }],
    next => next.rosterSource = "another-source",
  ];
  for (const change of changes) {
    const next = structuredClone(workspace);
    change(next);
    assert.equal(restoreResultCache(encoded, next), null);
  }
});

test("old, corrupt, failed and malformed result caches are safely discarded", () => {
  assert.equal(encodeResultCache(workspace, null), null);
  assert.equal(encodeResultCache(workspace, { ...result, center: null }), null);
  assert.equal(encodeResultCache(workspace, { ...result, verification: { ok: false, errors: ["failed"] } }), null);
  for (const raw of [null, "", "{broken", "null", "[]", "{}"]) assert.equal(restoreResultCache(raw, workspace), null);
  for (const change of [
    next => next.version++,
    next => next.result.revision = "obsolete",
    next => delete next.result.status,
    next => next.result.center.a = null,
    next => next.result.rooms[0].daily = null,
    next => delete next.result.rooms[0].bonusA,
    next => next.result.rooms[0].assist = { cycle: null },
    next => next.result.scores = { bad: "not-a-number" },
  ]) {
    const next = JSON.parse(encoded);
    change(next);
    assert.equal(restoreResultCache(JSON.stringify(next), workspace), null);
  }
});
