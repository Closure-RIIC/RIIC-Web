import assert from "node:assert/strict";
import test from "node:test";

import {
  buildManualOperbox,
  manualLevelFor,
  manualStageForEntry,
  maxEliteForRarity,
} from "./manual-operbox.ts";
import type { OperBoxEntry } from "./types.ts";

test("manual Box uses the elite-stage level cap for each rarity", () => {
  assert.equal(manualLevelFor(2, 0), 30);
  assert.equal(manualLevelFor(3, 1), 55);
  assert.equal(manualLevelFor(4, 2), 70);
  assert.equal(manualLevelFor(5, 2), 80);
  assert.equal(manualLevelFor(6, 1), 80);
});

test("manual Box prevents impossible elite stages for low-rarity operators", () => {
  assert.equal(maxEliteForRarity(2), 0);
  assert.equal(maxEliteForRarity(3), 1);
  assert.equal(maxEliteForRarity(6), 2);

  const roster: OperBoxEntry[] = [
    { id: "char_two", name: "Two Star", own: true, elite: 0, level: 30, potential: 6, rarity: 2 },
    { id: "char_three", name: "Three Star", own: true, elite: 1, level: 55, potential: 6, rarity: 3 },
  ];
  const result = buildManualOperbox(roster, { char_two: "e2", char_three: "e2" });

  assert.deepEqual(result, [
    { id: "char_two", name: "Two Star", own: true, elite: 0, level: 30, potential: 1, rarity: 2 },
    { id: "char_three", name: "Three Star", own: true, elite: 1, level: 55, potential: 1, rarity: 3 },
  ]);
});

test("manual Box keeps unowned operators and restores stages from current data", () => {
  const roster: OperBoxEntry[] = [
    { id: "char_a", name: "A", own: true, elite: 2, level: 90, potential: 6, rarity: 6 },
    { id: "char_b", name: "B", own: true, elite: 2, level: 80, potential: 6, rarity: 5 },
  ];
  const result = buildManualOperbox(roster, { char_a: "e1", char_b: "none" });

  assert.equal(manualStageForEntry(result[0]), "e1");
  assert.equal(manualStageForEntry(result[1]), "none");
  assert.deepEqual(result[1], { id: "char_b", name: "B", own: false, elite: 0, level: 1, potential: 1, rarity: 5 });
});
