import assert from "node:assert/strict";
import test from "node:test";
import { formatPoints } from "../../billing-points.ts";
import { roundPoints, splitPoints, sumPoints, validPoints } from "./points.ts";
import { BILLING_PRODUCTS, POINT_VALUE_RMB, SOLVE_TOOL_POINTS } from "./config.ts";

test("fractional balances, refunds and formatting preserve four places", () => {
  assert.equal(sumPoints(1, -0.9999), 0.0001);
  assert.equal(sumPoints(99.9844, 0.0156), 100);
  assert.equal(roundPoints("0.01565"), 0.0157);
  assert.equal(formatPoints(99.9844, "zh-CN"), "99.9844");
  assert.equal(formatPoints(0.0001, "en-US"), "0.0001");
  assert.equal(formatPoints(100), "100");
  for (const value of [0, 0.0001, 1, 99999.9999]) assert.ok(validPoints(value));
  for (const value of [-1, 0.00001, NaN, Infinity, "0.1", 2_000_000_001]) assert.equal(validPoints(value), false);
});

test("multiple legacy tool records share one rounded token total without overcharging", () => {
  assert.deepEqual([0, 1, 2].map(index => splitPoints(0.0001, 3, index)), [0.0001, 0, 0]);
  const shares = [0, 1, 2].map(index => splitPoints(0.0156, 3, index));
  assert.equal(sumPoints(...shares), 0.0156);
  assert.throws(() => splitPoints(0.00001, 2, 0));
});

test("tariff conversion and solver fee preserve the published credit products", () => {
  assert.equal(POINT_VALUE_RMB, 0.1);
  assert.equal(SOLVE_TOOL_POINTS, 1);
  assert.deepEqual(BILLING_PRODUCTS.map(({ id, amountFen, points }) => ({ id, amountFen, points })), [
    { id: "points_1_test", amountFen: 100, points: 10 },
    { id: "points_5", amountFen: 500, points: 50 },
    { id: "points_10", amountFen: 1000, points: 110 },
    { id: "monthly_19_9", amountFen: 1990, points: 300 },
  ]);
});
