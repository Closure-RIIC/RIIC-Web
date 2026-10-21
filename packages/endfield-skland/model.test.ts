import assert from "node:assert/strict";
import test from "node:test";
import { endfieldFacilityLevels, endfieldRolesFromBinding, matchEndfieldRoster, normalizeEndfieldSnapshot } from "./model.ts";
import { catalog, nonSchedulableOperators, validateOptions, DEFAULT_OPTIONS, parseRoster } from "../endfield-solver/model.mjs";

const detail = () => ({
  base: { roleId: "role-a", name: "测试管理员", charNum: 2, serverName: "官服", level: 30 },
  chars: [
    { id: "char-a", charData: { id: "char-a", name: "译名 A" }, evolvePhase: 2, level: 60 },
    { id: "char-unknown", charData: { id: "char-unknown", name: "新干员" }, evolvePhase: 0, level: 1 },
  ],
  config: { charSwitch: true },
  domain: [{ spaceShip: { rooms: [
    { id: "center", type: 0, level: 5 }, { id: "mfg1", type: 1, level: 3 }, { id: "mfg2", type: 1, level: 3 },
    { id: "grow", type: 2, level: 3 }, { id: "guest-display", type: 3, level: 1 }, { id: "guest", type: 5, level: 3 },
  ] } }],
});
test("binding parser selects only available Endfield roles, including distinct servers", () => {
  const role = { roleId: "r", serverId: "s1", nickname: "N", serverName: "S", isDefault: true };
  const result = endfieldRolesFromBinding({ list: [
    { appCode: "arknights", bindingList: [{ uid: "arknights", roles: [role] }] },
    { appCode: "endfield", bindingList: [
      { uid: "deleted", isDelete: true, roles: [role] },
      { uid: "u", roles: [role, role, { ...role, serverId: "s2" }, { ...role, roleId: "banned", isBanned: true }] },
    ] },
  ] });
  assert.deepEqual(result.map(item => [item.uid, item.roleId, item.serverId]), [["u", "r", "s1"], ["u", "r", "s2"]]);
});
test("detail envelopes normalize only whitelisted fields and match authoritative IDs", () => {
  const raw = detail();
  const snapshot = normalizeEndfieldSnapshot({ code: 0, data: { detail: { ...raw, cred: "must-not-copy" } } }, 123);
  assert.equal(snapshot.fetchedAt, 123);
  assert.equal(JSON.stringify(snapshot).includes("must-not-copy"), false);
  assert.deepEqual(matchEndfieldRoster(snapshot, [{ id: "char-a", name: "标准名" }, { id: "different-id", name: "另一个干员" }]), {
    operators: [{ name: "标准名", elite: 2 }], unsupported: ["新干员"], excluded: [],
  });
  assert.deepEqual(endfieldFacilityLevels(snapshot), { center: 5, mfg1: 3, mfg2: 3, grow: 3, guest: 3 });
});
test("rejects wrong-game/invalid characters and marks hidden or partial rosters unsafe to import", () => {
  assert.throws(() => normalizeEndfieldSnapshot({ chars: [{ charId: "arknights" }] }), /终末地/);
  assert.throws(() => normalizeEndfieldSnapshot({ code: 1, data: { detail: detail() } }), /错误/);
  const hidden = detail(); hidden.config.charSwitch = false;
  assert.equal(normalizeEndfieldSnapshot(hidden).rosterComplete, false);
  const partial = detail(); partial.chars.pop();
  assert.equal(normalizeEndfieldSnapshot(partial).rosterComplete, false);
  const duplicate = detail(); duplicate.chars[1] = duplicate.chars[0];
  assert.throws(() => normalizeEndfieldSnapshot(duplicate), /ID/);
  const invalid = detail(); invalid.chars[0].evolvePhase = 5;
  assert.throws(() => normalizeEndfieldSnapshot(invalid), /精英化/);
});
test("incomplete or incompatible facilities never replace current solver configuration", () => {
  const snapshot = normalizeEndfieldSnapshot(detail());
  assert.equal(endfieldFacilityLevels({ ...snapshot, rooms: [] }), null);
  assert.equal(endfieldFacilityLevels({ ...snapshot, rooms: snapshot.rooms.map(r => r.type === 0 ? { ...r, level: 1 } : r) }), null);
  assert.equal(endfieldFacilityLevels({ ...snapshot, rooms: snapshot.rooms.filter(r => r.id !== "mfg2") }), null);
});

test("the reported roster uses template IDs instead of instance IDs and recognizes all 26 schedulable operators", () => {
  const names = "艾尔黛拉、祀、洁尔佩塔、梨诺、别礼、伊冯、汤汤、骏卫、狼卫、赛希、埃特拉、陈千语、管理员、余烬、黎风、莱万汀、昼雪、佩丽卡、萤石、大潘、阿列什、噗切娜、秋栗、卡契尔、艾维文娜、弧光、安塔尔".split("、");
  const entries = [...catalog, ...nonSchedulableOperators];
  const chars = names.map((name, index) => {
    const operator = entries.find(item => item.name === name);
    assert.ok(operator, `Reported operator must exist in pinned Arr_Solver data: ${name}`);
    return { id: `owned-instance-${index}`, charData: { id: operator.id, name }, evolvePhase: index % 5, level: 60 };
  });
  const snapshot = normalizeEndfieldSnapshot({
    ...detail(), base: { ...detail().base, charNum: chars.length }, chars,
    spaceShip: { rooms: [
      { id: "control_center", type: 0, level: 5 }, { id: "manufacturing_1", type: "1", level: "3" },
      { id: "manufacturing_2", type: 1, level: 2 }, { id: "grow", type: 2, level: 3 },
      { id: "reception", type: 3, level: 1 }, { id: "clue", type: 5, level: 3 },
    ] },
    domain: [],
  });
  assert.equal(snapshot.characters[0].id, catalog.find(item => item.name === names[0])!.id);
  const matched = matchEndfieldRoster(snapshot, catalog, nonSchedulableOperators);
  assert.equal(matched.operators.length, 26);
  assert.deepEqual(matched.unsupported, []);
  assert.deepEqual(matched.excluded, ["管理员"]);
  assert.deepEqual(matched.operators.map(item => item.elite), chars.filter(item => item.charData.name !== "管理员").map(item => item.evolvePhase));
  assert.doesNotThrow(() => parseRoster(matched.operators));
  const levels = endfieldFacilityLevels(snapshot);
  assert.deepEqual(levels, { center: 5, mfg1: 3, mfg2: 2, grow: 3, guest: 3 });
  assert.doesNotThrow(() => validateOptions({ ...DEFAULT_OPTIONS, levels: levels! }));
});

test("API identifier variants use only unambiguous exact Endfield names; IDs still win", () => {
  const snapshot = normalizeEndfieldSnapshot(detail());
  snapshot.characters[0] = { id: "api-specific-id", name: catalog[0].name, elite: 3, level: 60 };
  assert.deepEqual(matchEndfieldRoster(snapshot, catalog).operators, [{ name: catalog[0].name, elite: 3 }]);
  assert.deepEqual(matchEndfieldRoster(snapshot, [
    { id: "first", name: catalog[0].name }, { id: "second", name: catalog[0].name },
  ]).operators, [], "Ambiguous names are not guessed");
  snapshot.characters[0].id = catalog[1].id;
  assert.equal(matchEndfieldRoster(snapshot, catalog).operators[0].name, catalog[1].name, "Known template ID is authoritative");
  snapshot.characters[1] = { ...snapshot.characters[0], id: "different-instance", name: catalog[1].name };
  assert.throws(() => matchEndfieldRoster(snapshot, catalog), /重复干员/);
});

test("top-level ship rooms are authoritative, and malformed facilities never silently lower configuration", () => {
  const nested = detail();
  assert.deepEqual(endfieldFacilityLevels(normalizeEndfieldSnapshot(nested)), { center: 5, mfg1: 3, mfg2: 3, grow: 3, guest: 3 });
  const root = { ...nested, spaceShip: { rooms: [
    { id: 0, type: "0", level: "1" }, { id: 1, type: "1", level: "1" }, { id: 2, type: "1", level: "1" },
  ] } };
  assert.deepEqual(endfieldFacilityLevels(normalizeEndfieldSnapshot(root)), { center: 1, mfg1: 1, mfg2: 1, grow: 0, guest: 0 });
  assert.equal(endfieldFacilityLevels(normalizeEndfieldSnapshot({ ...root, spaceShip: { rooms: [] } })), null, "Do not use stale nested rooms");
  assert.equal(endfieldFacilityLevels(normalizeEndfieldSnapshot({
    ...root, spaceShip: { rooms: [...root.spaceShip.rooms, { id: "grow", type: 2, level: null }] },
  })), null);
  assert.equal(endfieldFacilityLevels(normalizeEndfieldSnapshot({
    ...root, spaceShip: { rooms: [...root.spaceShip.rooms, { id: 1, type: 1, level: 2 }] },
  })), null, "Conflicting duplicate IDs are not discarded as if complete");
});
