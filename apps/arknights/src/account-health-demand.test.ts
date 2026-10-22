import assert from "node:assert/strict";
import test from "node:test";
import {
  healthDemandStorageKey,
  loadHealthDemand,
  normalizeHealthDemand,
  persistHealthDemand,
} from "./account-health-demand.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test("demand normalization preserves only explicit supported answers", () => {
  assert.deepEqual(normalizeHealthDemand({
    orundumPlan: "considering",
    outputPriority: "maximize",
    shiftTolerance: "twice-daily",
    twoPowerPlants: "nope",
    loginCadence: null,
    unknown: "accepted",
  }), { outputPriority: "maximize" });
  assert.equal(normalizeHealthDemand({}), null);
  assert.equal(normalizeHealthDemand([]), null);
});

test("preferences persist separately for each account and role", () => {
  const storage = memoryStorage();
  persistHealthDemand(storage, '["user-a","account-a","role-1"]', {
    orundumPlan: "planned", layoutChange: "keep", twoPowerPlants: "avoid", loginCadence: "irregular",
  });
  persistHealthDemand(storage, '["user-a","account-a","role-2"]', {
    outputPriority: "maximize", twoPowerPlants: "accept",
  });
  assert.deepEqual(loadHealthDemand(storage, '["user-a","account-a","role-1"]'), {
    orundumPlan: "planned", layoutChange: "keep", twoPowerPlants: "avoid", loginCadence: "irregular",
  });
  assert.deepEqual(loadHealthDemand(storage, '["user-a","account-a","role-2"]'), {
    outputPriority: "maximize", twoPowerPlants: "accept",
  });
  assert.equal(loadHealthDemand(storage, '["user-b","account-a","role-1"]'), null);
  persistHealthDemand(storage, '["user-a","account-a","role-1"]', {});
  assert.equal(storage.getItem(healthDemandStorageKey('["user-a","account-a","role-1"]')), null);
});

test("malformed stored preferences are treated as unknown", () => {
  const storage = memoryStorage();
  storage.setItem(healthDemandStorageKey("role"), "{broken");
  assert.equal(loadHealthDemand(storage, "role"), null);
});
