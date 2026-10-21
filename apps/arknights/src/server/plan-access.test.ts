import assert from "node:assert/strict";
import test from "node:test";
import { planAccessMode } from "./plan-access.ts";

test("anonymous sample requests cannot inject an operbox", () => {
  assert.equal(planAccessMode("sample", false), "trusted-sample");
  assert.throws(() => planAccessMode("sample", true), /服务端提供/);
});

test("MAA, Skland, and legacy requests require authenticated access", () => {
  assert.equal(planAccessMode("maa", true), "authenticated");
  assert.equal(planAccessMode("skland", true), "authenticated");
  assert.equal(planAccessMode(undefined, true), "authenticated");
  assert.throws(() => planAccessMode("forged", true));
});
