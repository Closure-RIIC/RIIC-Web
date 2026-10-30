import assert from "node:assert/strict";
import test from "node:test";
import { createReadAdmission } from "./read-admission.ts";

test("300 callers cannot create more than eight simultaneous upstream reads", async () => {
  let active = 0, peak = 0;
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const admit = createReadAdmission(8, () => new Error("busy"));
  const results = Promise.allSettled(Array.from({ length: 300 }, () => admit(async () => {
    peak = Math.max(peak, ++active);
    await barrier;
    active--;
    return "ok";
  })));
  assert.equal(peak, 8);
  release();
  const values = await results;
  assert.equal(values.filter(value => value.status === "fulfilled").length, 8);
  assert.equal(values.filter(value => value.status === "rejected").length, 292);
  assert.equal(await admit(async () => "recovered"), "recovered");
});

test("upstream failure, timeout and synchronous exceptions release capacity", async () => {
  const admit = createReadAdmission(1, () => new Error("busy"));
  for (const error of [new Error("upstream"), new DOMException("timeout", "TimeoutError")]) {
    await assert.rejects(admit(() => { throw error; }), value => value === error);
    assert.equal(await admit(async () => 1), 1);
  }
});
