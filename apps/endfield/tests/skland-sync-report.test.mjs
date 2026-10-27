import test from "node:test";
import assert from "node:assert/strict";
import { buildSklandSyncReport } from "../src/skland-sync-report.ts";
import { syncSklandWorkspace } from "../src/skland-workspace.ts";
import { DEFAULT_OPTIONS } from "@riic/endfield-solver/model.mjs";

const source = "fixture-account-a";
const workspace = (operators = []) => ({ version: 1, operators, options: structuredClone(DEFAULT_OPTIONS), rosterSource: source });
const status = (extra = {}) => ({ count: 2, partial: false, blocked: null, facilitiesApplied: true, excluded: [], unsupported: [], ...extra });
const operator = (name, elite, nodes = []) => ({ name, elite, latestSpaceshipSkillNodes: nodes });

test("reports actual additions, removals, progression and facility decreases without changing inputs", () => {
  const before = workspace([operator("佩丽卡", 1, ["node-a"]), operator("陈千语", 2)]);
  const after = workspace([operator("佩丽卡", 3, ["node-b"]), operator("狼卫", 0)]);
  after.options.levels.grow = 2;
  const original = JSON.stringify({ before, after });
  const report = buildSklandSyncReport(before, after, status({ excluded: ["管理员"], unsupported: ["新干员"] }), source, 1234);
  assert.equal(report.at, 1234);
  assert.deepEqual(report.added.map(entry => entry.name), ["狼卫"]);
  assert.deepEqual(report.removed.map(entry => entry.name), ["陈千语"]);
  assert.deepEqual(report.updated.map(entry => [entry.name, entry.before.elite, entry.after.elite]), [["佩丽卡", 1, 3]]);
  assert.deepEqual(report.facilities, [{ key: "grow", before: 3, after: 2 }]);
  assert.deepEqual(report.excluded, ["管理员"]);
  assert.equal(report.noChanges, false);
  assert.equal(JSON.stringify({ before, after }), original);
  after.operators[0].latestSpaceshipSkillNodes.push("node-c");
  assert.deepEqual(report.updated[0].after.latestSpaceshipSkillNodes, ["node-b"]);
});

test("reordered or duplicate skill nodes are not a change; missing actual nodes are distinct from none unlocked", () => {
  const before = workspace([operator("佩丽卡", 2, ["a", "b"])]);
  const after = workspace([operator("佩丽卡", 2, ["b", "a", "a"])]);
  assert.equal(buildSklandSyncReport(before, after, status(), source).noChanges, true);
  const unknown = workspace([{ name: "佩丽卡", elite: 2 }]);
  assert.equal(buildSklandSyncReport(unknown, workspace([operator("佩丽卡", 2)]), status(), source).updated.length, 1);
});

test("blocked import and missing facilities never advertise changes that were not applied", () => {
  const before = workspace([operator("佩丽卡", 1)]);
  const unchanged = structuredClone(before);
  const blocked = buildSklandSyncReport(before, unchanged, status({ blocked: "partial", partial: true, facilitiesApplied: false }), "other-account");
  assert.equal(blocked.accountChanged, true);
  assert.deepEqual([blocked.added, blocked.updated, blocked.removed, blocked.facilities], [[], [], [], []]);
  assert.equal(blocked.noChanges, false);
  assert.equal(blocked.unchangedFacilities, 0);
  const incomplete = buildSklandSyncReport(before, unchanged, status({ facilitiesApplied: false }), source);
  assert.deepEqual(incomplete.facilities, []);
});

test("partial same-account sync reports only applied updates and retains absent operators", () => {
  const before = workspace([operator("佩丽卡", 1), operator("陈千语", 2)]);
  const snapshot = { game: "endfield", role: { roleId: "fixture", name: "Fixture", serverName: "Fixture", level: 1 }, characters: [
    { id: "chr_0004_pelica", name: "佩丽卡", elite: 2, level: 50, latestSpaceshipSkillNodes: [] },
  ], rooms: [], rosterComplete: false, facilitiesComplete: false, fetchedAt: 1 };
  const catalogue = [{ id: "chr_0004_pelica", name: "佩丽卡", skills: [{}] }, { id: "chr_0005_chen", name: "陈千语", skills: [{}] }];
  const synced = syncSklandWorkspace(before, snapshot, source, "fixture", catalogue);
  const report = buildSklandSyncReport(before, synced.workspace, synced.status, source);
  assert.equal(report.partial, true);
  assert.equal(report.afterCount, 2);
  assert.deepEqual(report.updated.map(entry => entry.name), ["佩丽卡"]);
  assert.deepEqual(report.removed, []);
  assert.deepEqual(report.facilities, []);
});
