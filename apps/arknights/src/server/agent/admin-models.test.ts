import assert from "node:assert/strict";
import test from "node:test";
import { register, registerHooks } from "node:module";
register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) { return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context); } });
const { adminModelDirectory } = await import("./admin-models.ts");

test("model inventory is visible before pricing is configured and does not claim loaded routes", () => {
  const models = adminModelDirectory([]);
  assert.equal(models.length, 4);
  assert.equal(models[2].model, "deepseek-flash");
  assert.deepEqual(models.map(row => row.order), [1, 2, 3, 4]);
  assert.ok(models.every(row => !row.rateConfigured && row.routeConfigured === null));
});

test("only active prices set pricing status and private policy fields never reach the inventory", () => {
  const initial = adminModelDirectory([]);
  const payload = { key: "private-test-value", models: [initial[0], initial[2]] };
  const models = adminModelDirectory([
    { kind: "rates", status: "draft", payload: { models: initial } },
    { kind: "rates", status: "active", payload },
  ]);
  assert.deepEqual(models.map(row => row.rateConfigured), [true, false, true, false]);
  assert.ok(models.every(row => row.routeConfigured === null));
  assert.ok(!JSON.stringify(models).includes("private-test-value"));
});
