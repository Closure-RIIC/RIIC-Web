import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEndfieldWeapons } from "./weapons.ts";

const selected = { roleId: "role", serverId: "server" };
const response = (userWeapons: unknown, identity = selected) => ({ code: 0, data: { userGameData: { ...identity, userWeapons } } });
test("weapons preserve distinct instances, zero upgrades, and unknown levels", () => {
  const result = normalizeEndfieldWeapons(response({
    a: { weaponId: "wpn_sword_0003", level: "50", breakthroughLevel: 0, refineLevel: 0, token: "hidden" },
    b: { weaponId: "wpn_sword_0003", level: 20, refineLevel: 2 },
    c: { weaponId: "wpn_future_0001" },
  }), selected);
  assert.equal(result.status, "partial");
  assert.equal(result.items.length, 3);
  assert.deepEqual(result.items[0], { instanceId: "a", id: "wpn_sword_0003", level: 50, breakthroughLevel: 0, refineLevel: 0 });
  assert.equal(result.items[2].level, null);
  assert.doesNotMatch(JSON.stringify(result), /hidden/);
});
test("rejects foreign inventory and malformed lists; an explicit empty list is valid", () => {
  assert.equal(normalizeEndfieldWeapons(response([], { ...selected, roleId: "other" }), selected).status, "unavailable");
  assert.equal(normalizeEndfieldWeapons(response([], { ...selected, serverId: "other" }), selected).status, "unavailable");
  assert.equal(normalizeEndfieldWeapons(undefined, selected).status, "unavailable");
  assert.equal(normalizeEndfieldWeapons(response("bad"), selected).status, "unavailable");
  assert.deepEqual(normalizeEndfieldWeapons(response([]), selected), { status: "ready", items: [] });
  assert.deepEqual(normalizeEndfieldWeapons(response([{ id: "unknown" }]), selected), { status: "partial", items: [] });
});
