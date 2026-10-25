import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_OPTIONS, manualTemplate, parseWorkspace } from "@riic/endfield-solver/model.mjs";
import { restoreSklandRoster, rosterMatchTables, sklandRosterSource, syncSklandWorkspace } from "../src/skland-workspace.ts";
import { workspaceKey } from "../src/result-cache.ts";

const role = { roleId: "role-a", serverId: "server-a" };
const source = sklandRosterSource("owner-a", "account-a", role);
const base = () => ({ version: 1, operators: [], options: structuredClone(DEFAULT_OPTIONS) });
const character = (index, elite = 1) => ({ id: testCatalog[index].id, name: testCatalog[index].name, elite, level: 60 });
const snapshot = (extra = {}) => ({ game: "endfield", role: { ...role, name: "Fixture", serverName: "Server", level: 1 },
  characters: [character(0, 2), character(1, 3)], rosterComplete: true, facilitiesComplete: true, fetchedAt: 1,
  rooms: [{ id: "center", type: 0, level: 1 }, { id: "m1", type: 1, level: 1 }, { id: "m2", type: 1, level: 1 }], ...extra });
// Fixture roster shaped like catalog.json. Names must exist in the solver's skill table
// because parseRoster validates them, so these mirror real Endfield operators.
const entry = (id, name, enName, rarity, profession, enProfession, skillId, unlock, room, enRoom, effectKey) => ({
  id, name, enName, rarity, profession, enProfession, icon: "",
  skills: [{ id: skillId, name, enName, description: "", enDescription: "", unlock, roomType: 0, room, enRoom, effectKey, effectName: "", enEffectName: "", icon: "" }],
});
const FIXTURE_CATALOG = [
  entry("chr_0004_pelica", "佩丽卡", "Perlica", 5, "术师", "Caster", "spaceship_skill_chr_0004_pelica_1_1", 1, "中枢", "Control center", "MoodRecoveryAll"),
  entry("chr_0005_chen", "陈千语", "Chen", 6, "近卫", "Guard", "spaceship_skill_chr_0005_chen_1_1", 2, "制造舱", "Manufacturing", "ManufactureEfficiencyUp"),
  entry("chr_0006_wolfgd", "狼卫", "Wolfguard", 5, "先锋", "Vanguard", "spaceship_skill_chr_0006_wolfgd_1_1", 1, "培养舱", "Growth", "GrowSpeedUp"),
  { id: "chr_9000_endmin", name: "管理员", enName: "Endministrator", rarity: 6, profession: "近卫", enProfession: "Guard", icon: "", skills: [] },
];
const testCatalog = FIXTURE_CATALOG;
const { nonSchedulable: testNonSchedulable } = rosterMatchTables(testCatalog);

const sync = (current, data = snapshot(), identity = source) => syncSklandWorkspace(current, data, identity, role.roleId, testCatalog);

test("first sync populates the roster and actual elite stages, applies facilities and persists its source", () => {
  const current = base();
  const before = structuredClone(current);
  const { workspace, status } = sync(current);
  assert.deepEqual(workspace.operators, [{ name: testCatalog[0].name, elite: 2 }, { name: testCatalog[1].name, elite: 3 }]);
  assert.deepEqual(workspace.options.levels, { center: 1, mfg1: 1, mfg2: 1, grow: 0, guest: 0 });
  assert.equal(status.facilitiesApplied, true);
  assert.equal(parseWorkspace(JSON.stringify(workspace)).rosterSource, source);
  assert.deepEqual(current, before);
  assert.equal(parseWorkspace(JSON.stringify(current)).rosterSource, undefined, "legacy archives still work");
  assert.throws(() => parseWorkspace(JSON.stringify({ ...current, rosterSource: {} })), /来源/);
});

test("same-source refresh updates progression and membership without invalidating reordered equivalent data", () => {
  const current = sync(base()).workspace;
  current.manual = manualTemplate(current.options);
  current.manual[0].a = [testCatalog[0].name];
  const reordered = sync(current, snapshot({ characters: [character(1, 3), character(0, 2)] })).workspace;
  assert.equal(workspaceKey(reordered), workspaceKey(current));
  assert.deepEqual(reordered.manual, current.manual);
  const changed = sync(current, snapshot({ characters: [character(0, 4), character(2)] })).workspace;
  assert.deepEqual(changed.operators, [{ name: testCatalog[0].name, elite: 4 }, { name: testCatalog[2].name, elite: 1 }]);
  assert.notEqual(workspaceKey(changed), workspaceKey(current));
});

test("partial data merges only into the same saved identity and survives reload", () => {
  const current = parseWorkspace(JSON.stringify(sync(base()).workspace));
  const partial = snapshot({ characters: [character(1, 4), character(2)], rosterComplete: false });
  const merged = sync(current, partial);
  assert.deepEqual(merged.workspace.operators, [{ name: testCatalog[0].name, elite: 2 }, { name: testCatalog[1].name, elite: 4 }, { name: testCatalog[2].name, elite: 1 }]);
  assert.equal(merged.status.partial, true);
  for (const identity of [sklandRosterSource("owner-b", "account-a", role), sklandRosterSource("owner-a", "account-b", role), sklandRosterSource("owner-a", "account-a", { ...role, serverId: "server-b" })]) {
    const blocked = sync(current, partial, identity);
    assert.equal(blocked.status.blocked, "partial");
    assert.equal(blocked.workspace, current);
  }
  assert.equal(sync(base(), partial).status.blocked, "partial", "unbound partial data must not silently claim a full roster");
});

test("changing source replaces the roster, clears the old manual plan and invalidates even identical results", () => {
  const current = sync(base()).workspace;
  current.manual = manualTemplate(current.options);
  current.manual[0].a = [testCatalog[0].name];
  const nextSource = sklandRosterSource("owner-a", "account-b", role);
  const sameRoster = sync(current, snapshot(), nextSource).workspace;
  assert.equal(sameRoster.manual, undefined);
  assert.notEqual(workspaceKey(sameRoster), workspaceKey(current));
  const different = sync(current, snapshot({ characters: [character(2)] }), nextSource).workspace;
  assert.deepEqual(different.operators, [{ name: testCatalog[2].name, elite: 1 }]);
});

test("incomplete facilities, unsupported operators and skill-less operators are reported", () => {
  const data = snapshot({ facilitiesComplete: false, characters: [character(0), { ...testNonSchedulable[0], elite: 4, level: 90 }, { id: "unknown", name: "Unknown", elite: 0, level: 1 }] });
  const current = base();
  const { workspace, status } = sync(current, data);
  assert.equal(workspace.options, current.options);
  assert.equal(status.facilitiesApplied, false);
  assert.deepEqual(status.unsupported, ["Unknown"]);
  assert.deepEqual(status.excluded, [testNonSchedulable[0].name]);
  assert.equal(workspace.operators.length, 1);
  const unsupported = sync(workspace, snapshot({ characters: [data.characters[2]] }));
  assert.equal(unsupported.workspace, workspace);
  assert.equal(unsupported.status.blocked, "unsupported");
  assert.deepEqual(sync(workspace, snapshot({ characters: [data.characters[1]] })).workspace.operators, [], "a genuinely empty schedulable roster clears old operators");
});

test("restoring a complete roster removes simulated operators and elite upgrades even when facilities are unavailable", () => {
  const simulated = sync(base()).workspace;
  simulated.operators = [0, 1, 2].map(index => ({ name: testCatalog[index].name, elite: 4 }));
  const levels = structuredClone(simulated.options.levels);
  const restored = sync(simulated, snapshot({ facilitiesComplete: false, rooms: [] }));
  assert.deepEqual(restored.workspace.operators, [{ name: testCatalog[0].name, elite: 2 }, { name: testCatalog[1].name, elite: 3 }]);
  assert.deepEqual(restored.workspace.options.levels, levels);
  assert.equal(restored.status.facilitiesApplied, false);
  assert.equal(restored.status.blocked, null);
});

test("malformed or mismatched responses fail before mutating scheduling input", () => {
  const current = sync(base()).workspace;
  const before = structuredClone(current);
  assert.throws(() => sync(current, snapshot({ role: { ...role, roleId: "other" } })), /角色/);
  assert.throws(() => sync(current, snapshot({ characters: [character(0), character(0)] })), /重复/);
  assert.throws(() => sync(current, snapshot({ characters: [character(0, 9)] })), /elite|精英/);
  assert.deepEqual(current, before);
});

test("restoring a persisted Skland roster removes hypothetical operators and keeps facilities and valid manual slots", () => {
  const synced = sync(base(), snapshot({ characters: [
    { ...character(0, 2), latestSpaceshipSkillNodes: [] }, character(1, 3),
  ] })).workspace;
  const baseline = structuredClone(synced.operators);
  const current = structuredClone(synced);
  current.operators = [{ name: testCatalog[0].name, elite: 4 }, { name: testCatalog[2].name, elite: 4 }];
  current.options.levels.center = 5;
  current.manual = manualTemplate(current.options);
  current.manual[0] = { ...current.manual[0], hour: 8, a: [testCatalog[0].name], b: [testCatalog[2].name] };
  const reloaded = parseWorkspace(JSON.stringify(current));
  assert.deepEqual(reloaded.sklandRoster, baseline);
  const restored = restoreSklandRoster(reloaded);
  assert.deepEqual(restored.operators, baseline);
  assert.deepEqual(restored.options, reloaded.options);
  assert.deepEqual(restored.manual[0], { ...reloaded.manual[0], b: [""] });
  assert.deepEqual(current.operators, reloaded.operators, "restoring does not mutate the edited input");
  restored.operators[0].elite = 4;
  restored.operators[0].latestSpaceshipSkillNodes.push("unrelated");
  assert.deepEqual(restored.sklandRoster, baseline, "the baseline has no shared arrays with editable data");
});

test("partial sync refreshes only the real baseline, without keeping hypothetical operators or progression", () => {
  const current = sync(base()).workspace;
  current.operators = [{ name: testCatalog[0].name, elite: 4 }, { name: testCatalog[2].name, elite: 4 }];
  const merged = sync(current, snapshot({ characters: [character(1, 2)], rosterComplete: false })).workspace;
  assert.deepEqual(merged.operators, [{ name: testCatalog[0].name, elite: 2 }, { name: testCatalog[1].name, elite: 2 }]);
  assert.deepEqual(merged.sklandRoster, merged.operators);
  const legacy = { ...current };
  delete legacy.sklandRoster;
  const partialLegacy = sync(legacy, snapshot({ characters: [character(1, 2)], rosterComplete: false })).workspace;
  assert.equal(partialLegacy.sklandRoster, undefined, "a partial response cannot manufacture a complete backup");
  assert.equal(restoreSklandRoster(partialLegacy), partialLegacy);
});

test("changing identity replaces the recovery baseline and blocked sync preserves the previous one", () => {
  const current = sync(base()).workspace;
  const identity = sklandRosterSource("owner-b", "account-b", role);
  const blocked = sync(current, snapshot({ rosterComplete: false }), identity);
  assert.equal(blocked.workspace, current);
  const replaced = sync(current, snapshot({ characters: [character(2)] }), identity).workspace;
  assert.deepEqual(replaced.sklandRoster, [{ name: testCatalog[2].name, elite: 1 }]);
  assert.deepEqual(restoreSklandRoster(replaced).operators, replaced.sklandRoster);
  const empty = sync(current, snapshot({ characters: [] })).workspace;
  assert.deepEqual(parseWorkspace(JSON.stringify(empty)).sklandRoster, []);
  assert.deepEqual(restoreSklandRoster({ ...empty, operators: current.operators }).operators, []);
});

test("baseline metadata cannot invalidate solver results and malformed backups are rejected", () => {
  const current = sync(base()).workspace;
  const legacy = { ...current };
  delete legacy.sklandRoster;
  assert.equal(workspaceKey(legacy), workspaceKey(current));
  assert.equal(restoreSklandRoster(base()).sklandRoster, undefined);
  for (const extra of [{ sklandRoster: {} }, { sklandRoster: [character(0, 9)] }, { rosterSource: undefined, sklandRoster: [] }]) {
    assert.throws(() => parseWorkspace(JSON.stringify({ ...current, ...extra })));
  }
});
