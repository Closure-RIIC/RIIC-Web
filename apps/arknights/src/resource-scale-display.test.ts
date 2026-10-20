import assert from "node:assert/strict";
import test from "node:test";
import { formatScaledAmount } from "./resource-scale-display.ts";

test("zh scale keeps one decimal below yi and two decimals above", () => {
  assert.equal(formatScaledAmount(9_999), null);
  assert.equal(formatScaledAmount(19_320), "1.9万");
  assert.equal(formatScaledAmount(193_200), "19.3万");
  assert.equal(formatScaledAmount(20_000), "2万");
  assert.equal(formatScaledAmount(99_999_999), "1.00亿");
  assert.equal(formatScaledAmount(100_000_000), "1.00亿");
  assert.equal(formatScaledAmount(190_002_000), "1.90亿");
  assert.equal(formatScaledAmount(1_950_000_000), "19.50亿");
  assert.equal(formatScaledAmount(-50_000), null);
});

test("en scale uses compact notation", () => {
  assert.equal(formatScaledAmount(193_200, "en"), "193.2K");
  assert.equal(formatScaledAmount(190_002_000, "en"), "190M");
  assert.equal(formatScaledAmount(9_999, "en"), null);
});
