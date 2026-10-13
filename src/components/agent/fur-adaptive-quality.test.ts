import assert from "node:assert/strict";
import test from "node:test";
import { newFurQualityObservation, observeFurQuality } from "./fur-adaptive-quality.ts";

test("isolated stalls and invalid timing cannot demote sustained healthy rendering", () => {
  const state = newFurQualityObservation();
  for (let i = 0; i < 20; i++) {
    assert.equal(observeFurQuality("quality", state, i % 2 ? 16 : 100, i * 200), "quality");
  }
  assert.equal(observeFurQuality("quality", state, NaN, 5000), "quality");
  assert.equal(observeFurQuality("quality", state, 0, 6000), "quality");
});

test("sustained expensive draws step down without promoting again on a fast sample", () => {
  const state = newFurQualityObservation();
  let tier: "quality" | "balanced" | "saver" | "static" = "quality";
  for (let i = 0; i < 8; i++) tier = observeFurQuality(tier, state, 65, i * 200);
  assert.equal(tier, "balanced");
  assert.equal(observeFurQuality(tier, state, 8, 1700), "balanced");
  for (let i = 0; i < 8; i++) tier = observeFurQuality(tier, state, 65, 2000 + i * 200);
  assert.equal(tier, "saver");
  for (let i = 0; i < 8; i++) tier = observeFurQuality(tier, state, 140, 4000 + i * 200);
  assert.equal(tier, "static");
});

test("a catastrophic completed draw enters static immediately; quick bursts do not demote", () => {
  const state = newFurQualityObservation();
  for (let i = 0; i < 20; i++) assert.equal(observeFurQuality("quality", state, 40, i * 40), "quality");
  assert.equal(observeFurQuality("saver", state, 1600, 1000), "static");
  assert.equal(observeFurQuality("static", state, 5, 2000), "static");
});
