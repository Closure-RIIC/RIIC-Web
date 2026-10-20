import assert from "node:assert/strict";
import test from "node:test";

import { normalizeOperboxEntries } from "./operbox-normalization.ts";
import { normalizeImportedOperboxEntries } from "./operator-name-normalization.ts";
import type { OperBoxEntry } from "./types.ts";

function entry(overrides: Partial<OperBoxEntry> = {}): OperBoxEntry {
  return {
    id: "char_1",
    name: "测试干员",
    elite: 1,
    level: 50,
    own: true,
    potential: 1,
    rarity: 5,
    ...overrides,
  };
}

test("keeps one planner identity per operator name and prefers the stronger record", () => {
  const entries = [
    entry({ id: "char_amiya_guard", name: "阿米娅", elite: 1, level: 70 }),
    entry({ id: "char_kalts", name: "凯尔希", elite: 2, level: 60, rarity: 6 }),
    entry({ id: "char_amiya", name: "阿米娅", elite: 2, level: 80 }),
  ];

  assert.deepEqual(normalizeOperboxEntries(entries).map(({ id, name }) => ({ id, name })), [
    { id: "char_amiya", name: "阿米娅" },
    { id: "char_kalts", name: "凯尔希" },
  ]);
  assert.equal(entries[0].id, "char_amiya_guard");
});

test("omits unsupported Amiya form labels before sending data to the planner", () => {
  const entries = [
    entry({ id: "char_amiya", name: "阿米娅" }),
    entry({ id: "char_amiya_guard", name: "阿米娅（近卫）" }),
    entry({ id: "char_amiya_medic", name: "阿米娅（医疗）" }),
  ];

  assert.deepEqual(normalizeOperboxEntries(entries).map(({ name }) => name), ["阿米娅"]);
});

test("normalizes Chinese, Japanese, English and Traditional Chinese names by operator id on import", () => {
  const localizedNames = ["凯尔希", "ケルシー", "Kal'tsit", "凱爾希"];

  for (const name of localizedNames) {
    assert.equal(
      normalizeImportedOperboxEntries([entry({ id: "char_003_kalts", name })])[0]?.name,
      "凯尔希",
    );
  }

  assert.equal(
    normalizeImportedOperboxEntries([entry({ id: "003_kalts", name: "Kal'tsit" })])[0]?.name,
    "凯尔希",
  );
});

test("preserves the imported name when a newer operator id is not in the local catalog", () => {
  assert.equal(
    normalizeImportedOperboxEntries([entry({ id: "char_future", name: "未来干员" })])[0]?.name,
    "未来干员",
  );
});
