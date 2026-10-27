import assert from "node:assert/strict";
import test from "node:test";
import { physicalStrengthPercent, shipFavorability, shipRoomsForDisplay, sortShipCrewByMood } from "./presentation.ts";

test("ship mood converts Skland physical strength from a 0-10000 scale to a two-decimal percentage", () => {
  assert.equal(physicalStrengthPercent(10_000), "100%");
  assert.equal(physicalStrengthPercent(3_449.2324), "34.49%");
  assert.equal(physicalStrengthPercent(9_872.267), "98.72%");
  assert.equal(physicalStrengthPercent(0), "0%");
  assert.equal(physicalStrengthPercent(5_000), "50%");
  assert.equal(physicalStrengthPercent("5000"), "50%");
  assert.equal(physicalStrengthPercent(12_345), "100%");
  assert.equal(physicalStrengthPercent(null), null);
  assert.equal(physicalStrengthPercent(-1), null);
});

test("ship favorability scales 0-1500 points to 0-200 percent with relation levels", () => {
  assert.deepEqual(shipFavorability(0), { percent: "0%", level: "friendly" });
  assert.deepEqual(shipFavorability(299), { percent: "99%", level: "friendly" });
  assert.deepEqual(shipFavorability(300), { percent: "100%", level: "close" });
  assert.deepEqual(shipFavorability(340), { percent: "103%", level: "close" });
  assert.deepEqual(shipFavorability(690), { percent: "132%", level: "close" });
  assert.deepEqual(shipFavorability(1_499), { percent: "199%", level: "close" });
  assert.deepEqual(shipFavorability(1_500), { percent: "200%", level: "trusted" });
  assert.deepEqual(shipFavorability(2_000), { percent: "200%", level: "trusted" });
  assert.equal(shipFavorability(null), null);
});

test("ship crew sorts by mood from low to high with missing values last", () => {
  const high = { charId: "high", physicalStrength: 10_000 };
  const low = { charId: "low", physicalStrength: 2_100 };
  const tieA = { charId: "tie-a", physicalStrength: 5_000 };
  const tieB = { charId: "tie-b", physicalStrength: "5000" };
  const missing = { charId: "missing" };
  const invalid = { charId: "invalid", physicalStrength: "unknown" };
  const crew = [high, missing, low, tieA, invalid, tieB];
  assert.deepEqual(sortShipCrewByMood(crew), [low, tieA, tieB, high, missing, invalid]);
  assert.deepEqual(crew, [high, missing, low, tieA, invalid, tieB]);
});

test("ship rooms hide the empty reception placeholder when a clue room is present", () => {
  const placeholder = { id: "reception", type: 3, level: 1 };
  const clueRoom = { id: "guest", type: 5, level: 3 };
  assert.deepEqual(shipRoomsForDisplay([placeholder, clueRoom]), [clueRoom]);
  assert.deepEqual(shipRoomsForDisplay([placeholder]), [placeholder]);
});
