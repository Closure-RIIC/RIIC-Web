import test from "node:test";
import assert from "node:assert/strict";
import { catalog, nonSchedulableOperators, DEFAULT_OPTIONS, manualTemplate, parseWorkspace } from "@riic/endfield-solver/model.mjs";
import { sklandRosterSource, syncSklandWorkspace } from "../src/skland-workspace.ts";
import { workspaceKey } from "../src/result-cache.ts";

const role = { roleId: "role-a", serverId: "server-a" };
const source = sklandRosterSource("owner-a", "account-a", role);
const base = () => ({ version: 1, operators: [], options: structuredClone(DEFAULT_OPTIONS) });
const character = (index, elite = 1) => ({ id: catalog[index].id, name: catalog[index].name, elite, level: 60 });
const snapshot = (extra = {}) => ({ game: "endfield", role: { ...role, name: "Fixture", serverName: "Server", level: 1 },
  characters: [character(0, 2), character(1, 3)], rosterComplete: true, facilitiesComplete: true, fetchedAt: 1,
  rooms: [{ id: "center", type: 0, level: 1 }, { id: "m1", type: 1, level: 1 }, { id: "m2", type: 1, level: 1 }], ...extra });
const sync = (current, data = snapshot(), identity = source) => syncSklandWorkspace(current, data, identity, role.roleId);

test("first sync populates the roster and actual elite stages, applies facilities and persists its source", () => {
  const current = base();
  const before = structuredClone(current);
  const { workspace, status } = sync(current);
  assert.deepEqual(workspace.operators, [{ name: catalog[0].name, elite: 2 }, { name: catalog[1].name, elite: 3 }]);
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
  current.manual[0].a = [catalog[0].name];
  const reordered = sync(current, snapshot({ characters: [character(1, 3), character(0, 2)] })).workspace;
  assert.equal(workspaceKey(reordered), workspaceKey(current));
  assert.deepEqual(reordered.manual, current.manual);
  const changed = sync(current, snapshot({ characters: [character(0, 4), character(2)] })).workspace;
  assert.deepEqual(changed.operators, [{ name: catalog[0].name, elite: 4 }, { name: catalog[2].name, elite: 1 }]);
  assert.notEqual(workspaceKey(changed), workspaceKey(current));
});

test("partial data merges only into the same saved identity and survives reload", () => {
  const current = parseWorkspace(JSON.stringify(sync(base()).workspace));
  const partial = snapshot({ characters: [character(1, 4), character(2)], rosterComplete: false });
  const merged = sync(current, partial);
  assert.deepEqual(merged.workspace.operators, [{ name: catalog[0].name, elite: 2 }, { name: catalog[1].name, elite: 4 }, { name: catalog[2].name, elite: 1 }]);
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
  current.manual[0].a = [catalog[0].name];
  const nextSource = sklandRosterSource("owner-a", "account-b", role);
  const sameRoster = sync(current, snapshot(), nextSource).workspace;
  assert.equal(sameRoster.manual, undefined);
  assert.notEqual(workspaceKey(sameRoster), workspaceKey(current));
  const different = sync(current, snapshot({ characters: [character(2)] }), nextSource).workspace;
  assert.deepEqual(different.operators, [{ name: catalog[2].name, elite: 1 }]);
});

test("incomplete facilities, unsupported operators and skill-less operators are reported", () => {
  const data = snapshot({ facilitiesComplete: false, characters: [character(0), { ...nonSchedulableOperators[0], elite: 4, level: 90 }, { id: "unknown", name: "Unknown", elite: 0, level: 1 }] });
  const current = base();
  const { workspace, status } = sync(current, data);
  assert.equal(workspace.options, current.options);
  assert.equal(status.facilitiesApplied, false);
  assert.deepEqual(status.unsupported, ["Unknown"]);
  assert.deepEqual(status.excluded, [nonSchedulableOperators[0].name]);
  assert.equal(workspace.operators.length, 1);
  const unsupported = sync(workspace, snapshot({ characters: [data.characters[2]] }));
  assert.equal(unsupported.workspace, workspace);
  assert.equal(unsupported.status.blocked, "unsupported");
  assert.deepEqual(sync(workspace, snapshot({ characters: [data.characters[1]] })).workspace.operators, [], "a genuinely empty schedulable roster clears old operators");
});

test("restoring a complete roster removes simulated operators and elite upgrades even when facilities are unavailable", () => {
  const simulated = sync(base()).workspace;
  simulated.operators = [0, 1, 2].map(index => ({ name: catalog[index].name, elite: 4 }));
  const levels = structuredClone(simulated.options.levels);
  const restored = sync(simulated, snapshot({ facilitiesComplete: false, rooms: [] }));
  assert.deepEqual(restored.workspace.operators, [{ name: catalog[0].name, elite: 2 }, { name: catalog[1].name, elite: 3 }]);
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
