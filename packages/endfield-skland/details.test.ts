import assert from "node:assert/strict";
import test from "node:test";
import { publicEndfieldDetails, selectedEndfieldDetails } from "./details.ts";

test("display details retain all game categories and nested equipment, reports and future fields", () => {
  const data = {
    base: { name: "Test", roleId: "123", worldLevel: 4, credits: 500 },
    chars: [{ charData: { name: "Operator", skills: [{ name: "Skill", desc: "<b>Effect</b>" }] }, weapon: { level: 60 } }],
    domain: [{ settlements: [{ remainMoney: "12345" }], collections: [{ puzzleCount: 20 }], factory: null }],
    spaceShip: { rooms: [{ reports: { "123": { output: { item: 18 } } } }] },
    achieve: { count: 100 }, bpSystem: { curLevel: 40 }, dailyMission: { dailyActivation: 100 },
    futureCategory: { newField: [false, 0, "", null] },
  };
  assert.deepEqual(publicEndfieldDetails(data), data);
});

test("display details exclude credentials at every depth and URL credentials without mutating inputs", () => {
  const data = { cred: "hidden", token: "hidden", session: { key: "hidden" }, base: {
    name: "Visible", accountOAuthToken: "hidden", headers: { cookie: "hidden" },
    avatarUrl: "https://images.example/avatar.png", link: "https://example/path?accessToken=hidden",
    otherLink: "https://name:PASSWORD@example/path", description: "No secret fields copied",
  }, chars: [{ charData: { name: "Operator", apiKey: "hidden" } }] };
  const result = publicEndfieldDetails(data);
  assert.doesNotMatch(JSON.stringify(result), /hidden|PASSWORD/);
  assert.equal(data.cred, "hidden");
  assert.deepEqual(result.chars, [{ charData: { name: "Operator" } }]);
  assert.throws(() => publicEndfieldDetails({ field: "a".repeat(100001) }), /过长/);
});

test("status payload includes requested categories only, preserves zero and extracts legacy ship data", () => {
  const data = {
    base: { name: "Test", roleId: "123", level: 0, mainMission: { description: "omit" }, docNum: 10 },
    chars: [{ id: "owned", charData: { id: "chr_0004_pelica", name: "佩丽卡", avatarSqUrl: "https://example/avatar.png", profileRecord: "omit" }, weapon: { level: 0 }, userSkills: { basic: { level: 1 } }, secret: "omit" }],
    domain: [{ name: "omit", spaceShip: { rooms: [{ id: "center", level: 5, reports: { today: { output: 0 } } }] } }],
    dailyMission: { dailyActivation: 0, maxDailyActivation: 100 }, dungeon: { curStamina: "0", maxStamina: "240" },
    bpSystem: { curLevel: 1 }, achieve: { count: 10 }, futureCategory: { unexpected: "omit" }, config: { charSwitch: true },
  };
  const filtered = selectedEndfieldDetails(data);
  assert.deepEqual(Object.keys(filtered).sort(), ["base", "chars", "dailyMission", "dungeon", "bpSystem", "spaceShip"].sort());
  assert.doesNotMatch(JSON.stringify(filtered), /omit|docNum|charSwitch/);
  assert.deepEqual(filtered.dailyMission, data.dailyMission);
  assert.deepEqual(filtered.spaceShip, data.domain[0].spaceShip);
  assert.equal(data.base.mainMission.description, "omit", "Does not mutate upstream data");
});
