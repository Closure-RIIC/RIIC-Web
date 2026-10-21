import assert from "node:assert/strict";
import test from "node:test";

import { loadTrainingInventory, saveTrainingInventory } from "./training-planner-store.ts";

test("stores inventory overrides separately from older full inventory snapshots", () => {
  const values = new Map<string, string>([
    ["arknights-infra-training-planner-v1:inventory:account-a", JSON.stringify({ "30011": 99 })],
  ]);
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } },
  });

  try {
    assert.deepEqual(loadTrainingInventory("account-a"), {});
    assert.equal(saveTrainingInventory("account-a", { "30012": 4 }), true);
    assert.deepEqual(loadTrainingInventory("account-a"), { "30012": 4 });
    assert.equal(values.get("arknights-infra-training-planner-v1:inventory:account-a"), JSON.stringify({ "30011": 99 }));
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});
