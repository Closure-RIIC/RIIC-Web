import assert from "node:assert/strict";
import test from "node:test";
import { parseReproductionPackage, readReproductionPackage, reproductionInputKey } from "./reproduction-package.ts";

const box = [{ id: "char_test", name: "测试", elite: 2, level: 90, potential: 6, rarity: 6, own: true }];
const original = { diagnosticId: "run-1", operbox: box, layout: { template: "243", drone_cap: 235, scenario: {}, rooms: [{ id: "control", kind: "control_center", level: 5 }, { id: "power_1", kind: "power_plant", level: 3 }] }, rotation: "abc_12_6_6", fiammetta_enable: false };

test("legacy exports and versioned packages round trip without changing settings", () => {
  const parsed = parseReproductionPackage(original);
  assert.deepEqual(readReproductionPackage(JSON.stringify(parsed)), parsed);
  assert.equal(parsed.rotation, original.rotation);
  assert.notEqual(parsed.layout, original.layout);
  assert.deepEqual(parsed.operbox, box);
});

test("box-only inputs need explicit settings and full packages ignore box defaults", () => {
  assert.throws(() => parseReproductionPackage(box), /请先选择布局/);
  const full = parseReproductionPackage(original);
  const settings = { layout: full.layout, rotation: "main_backup_12_12" as const, fiammetta_enable: true };
  assert.equal(parseReproductionPackage(box, settings).rotation, settings.rotation);
  assert.equal(parseReproductionPackage(original, settings).rotation, original.rotation);
});

test("invalid, unknown, incomplete, and oversized packages fail explicitly", () => {
  assert.throws(() => readReproductionPackage("{"), /JSON/);
  assert.throws(() => parseReproductionPackage({ ...original, format: "riic-reproduction", version: 2 }), /版本/);
  assert.throws(() => parseReproductionPackage({ ...original, rotation: undefined }), /轮换/);
  assert.throws(() => parseReproductionPackage({ ...original, fiammetta_enable: undefined }), /菲亚梅塔/);
  assert.throws(() => parseReproductionPackage({ ...original, unknown_solver_option: true }), /不能静默忽略/);
  assert.throws(() => readReproductionPackage(" ".repeat(2 * 1024 * 1024 + 1)), /2 MiB/);
});

test("deduplication uses complete input, excludes source, and ignores object key order", () => {
  const first = parseReproductionPackage(original);
  const second = parseReproductionPackage({ ...original, diagnosticId: "run-2" });
  assert.equal(reproductionInputKey(first), reproductionInputKey(second));
  assert.notEqual(reproductionInputKey(first), reproductionInputKey({ ...second, fiammetta_enable: true }));
  assert.notEqual(reproductionInputKey(first), reproductionInputKey({ ...second, rotation: "main_backup_12_12" }));
  const reversed = Object.fromEntries(Object.entries(first.layout).reverse());
  assert.equal(reproductionInputKey(first), reproductionInputKey({ ...second, layout: reversed as typeof first.layout }));
});
