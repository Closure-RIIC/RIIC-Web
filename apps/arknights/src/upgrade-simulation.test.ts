import assert from "node:assert/strict";
import test from "node:test";

import type { OperBoxEntry } from "./types.ts";
import { hasOperboxEliteStateChange, upgradeSimulationBoxSource } from "./upgrade-simulation.ts";

function operator(overrides: Partial<OperBoxEntry> = {}): OperBoxEntry {
  return {
    id: "char_test",
    name: "测试干员",
    own: true,
    elite: 1,
    level: 1,
    potential: 1,
    rarity: 6,
    ...overrides,
  };
}

test("精英化阶段发生变化时允许试算", () => {
  assert.equal(hasOperboxEliteStateChange([operator()], [operator({ elite: 2 })]), true);
});

test("未拥有与已拥有之间的变化也属于精英化状态变化", () => {
  assert.equal(hasOperboxEliteStateChange([operator({ own: false, elite: 0 })], [operator({ own: true, elite: 0 })]), true);
  assert.equal(hasOperboxEliteStateChange([operator()], [operator({ own: false })]), true);
});

test("只有等级变化时不允许试算", () => {
  assert.equal(hasOperboxEliteStateChange([operator()], [operator({ level: 80 })]), false);
});

test("试算保留森空岛数据归属，只有示例 Box 转为 MAA 来源", () => {
  assert.equal(upgradeSimulationBoxSource("skland"), "skland");
  assert.equal(upgradeSimulationBoxSource("maa"), "maa");
  assert.equal(upgradeSimulationBoxSource("sample"), "maa");
});
