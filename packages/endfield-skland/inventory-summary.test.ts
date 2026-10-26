import assert from "node:assert/strict";
import test from "node:test";
import type { EndfieldInventory } from "./inventory.ts";
import { inventoryExperienceSummary } from "./inventory-summary.ts";

const item = (id: string, group: "charExpMaterials" | "weaponExpMaterials", count: number | null) => ({
  id, name: id, group, count,
});

test("inventory experience totals use raw item EXP and separate carriers from battle records", () => {
  const inventory: EndfieldInventory = { status: "ready", items: [
    item("item_expcard_stage2_high", "charExpMaterials", 826),
    item("item_expcard_stage2_low", "charExpMaterials", 5_442),
    item("item_expcard_stage1_high", "charExpMaterials", 263),
    item("item_expcard_stage1_mid", "charExpMaterials", 981),
    item("item_expcard_stage1_low", "charExpMaterials", 958),
    item("item_weapon_expcard_high", "weaponExpMaterials", 798),
    item("item_weapon_expcard_mid", "weaponExpMaterials", 312),
    item("item_weapon_expcard_low", "weaponExpMaterials", 523),
  ] };
  assert.deepEqual(inventoryExperienceSummary(inventory), {
    operator: { carriers: 13_702_000, records: 3_802_600 },
    weapon: 8_396_600,
  });
});

test("inventory experience totals stay hidden when an EXP count or item identity is unknown", () => {
  const inventory: EndfieldInventory = { status: "partial", items: [
    item("item_expcard_stage2_high", "charExpMaterials", null),
    item("item_expcard_stage1_high", "charExpMaterials", 10),
    item("item_weapon_expcard_high", "weaponExpMaterials", 10),
    item("future_weapon_exp", "weaponExpMaterials", 10),
  ] };
  assert.deepEqual(inventoryExperienceSummary(inventory), { operator: null, weapon: null });
  assert.deepEqual(inventoryExperienceSummary(undefined), { operator: null, weapon: null });
});
