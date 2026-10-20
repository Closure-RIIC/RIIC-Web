import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEndfieldInventory } from "./inventory.ts";

const selected = { roleId: "role-a", serverId: "1" };
const response = (data: unknown) => ({ code: 0, data });
const catalog = response({
  materials: { gold: { id: "gold", name: "折金", icon: "https://bbs.hycdn.cn/gold.png" }, exp: { id: "exp", name: "经验" } },
  charExpMaterials: { exp: { id: "exp", name: "干员经验", exp: 1000 } },
  weaponExpMaterials: { weapon: { id: "weapon", name: "武器经验" } },
  priorities: [{ ids: ["exp", "weapon", "gold"] }],
});
const stock = (itemCount: unknown, identity: unknown = selected) => response({ userGameData: { ...Object(identity), itemCount } });

test("catalog groups merge by ID, preserve zero, parse integer strings and follow display priorities", () => {
  const inventory = normalizeEndfieldInventory(catalog, stock({ gold: "123456", exp: 0, weapon: "25" }), selected);
  assert.equal(inventory.status, "ready");
  assert.deepEqual(inventory.items.map(item => [item.id, item.group, item.count]), [
    ["exp", "charExpMaterials", 0], ["weapon", "weaponExpMaterials", 25], ["gold", "materials", 123456],
  ]);
  assert.equal(inventory.items[2].icon, "https://bbs.hycdn.cn/gold.png");
});

test("missing or invalid stock never becomes zero; unfamiliar IDs remain visible", () => {
  const inventory = normalizeEndfieldInventory(catalog, stock({ gold: -1, weapon: "1.5", extra: 7 }), selected);
  assert.equal(inventory.status, "partial");
  assert.equal(inventory.issue, "incomplete");
  assert.deepEqual(inventory.items.map(item => item.count), [null, null, null, 7]);
  assert.equal(inventory.items.at(-1)?.name, "extra");
  for (const value of [null, "", false, Number.MAX_SAFE_INTEGER + 1, Infinity, {}, "NaN"]) {
    assert.equal(normalizeEndfieldInventory(catalog, stock({ gold: value }), selected).items.find(item => item.id === "gold")?.count, null);
  }
});

test("upstream failures degrade independently without treating error envelopes as inventory", () => {
  const failed = { code: 10002, message: "private-credential" };
  const missingStock = normalizeEndfieldInventory(catalog, failed, selected);
  assert.equal(missingStock.issue, "counts");
  assert.ok(missingStock.items.every(item => item.count === null));
  const missingCatalog = normalizeEndfieldInventory(failed, stock({ gold: 0 }), selected);
  assert.deepEqual(missingCatalog, { status: "partial", issue: "catalog", items: [{ id: "gold", name: "gold", count: 0, group: "other" }] });
  assert.equal(normalizeEndfieldInventory(failed, failed, selected).status, "unavailable");
  assert.doesNotMatch(JSON.stringify(missingStock), /private-credential/);
});

test("rejects a mismatched role or server; official header-selected responses may omit identity", () => {
  for (const identity of [{ ...selected, roleId: "other" }, { ...selected, serverId: "2" }, { roleId: null }]) {
    assert.deepEqual(normalizeEndfieldInventory(catalog, stock({ gold: 100 }, identity), selected), {
      status: "unavailable", issue: "identity", items: [],
    });
  }
  assert.equal(normalizeEndfieldInventory(catalog, stock({ gold: 1, exp: 2, weapon: 3 }, {}), selected).status, "ready");
});

test("keeps all 40 materials and future additions without a hard-coded count", () => {
  for (const length of [40, 41]) {
    const materials = Object.fromEntries(Array.from({ length }, (_, i) => [`item-${i}`, { id: `item-${i}`, name: `Item ${i}` }]));
    const counts = Object.fromEntries(Object.keys(materials).map((id, i) => [id, i]));
    const inventory = normalizeEndfieldInventory(response({ materials }), stock(counts), selected);
    assert.equal(inventory.items.length, length);
    assert.equal(inventory.status, "ready");
  }
});

test("bounds item collections and strips unsafe metadata and image URLs", () => {
  const tooLarge = Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`item${i}`, i]));
  assert.equal(normalizeEndfieldInventory(catalog, stock(tooLarge), selected).status, "unavailable");
  const unsafe = response({ materials: {
    gold: { id: "gold", name: "Gold", icon: "https://example.test/a?token=secret", cred: "hidden" },
    other: { id: "other", name: "Other", icon: "javascript:alert(1)" },
    mismatch: { id: "gold", name: "Wrong" },
  } });
  const inventory = normalizeEndfieldInventory(unsafe, stock({ gold: 1, other: 2 }), selected);
  assert.equal(inventory.items.length, 2);
  assert.ok(inventory.items.every(item => item.icon === undefined));
  assert.doesNotMatch(JSON.stringify(inventory), /secret|hidden|javascript|Wrong/);
});
