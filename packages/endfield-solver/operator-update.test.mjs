import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_OPTIONS, manualTemplate, parseWorkspace, prepare } from "./model.mjs";
import { evaluateManual, solve } from "./index.mjs";

const options = { ...DEFAULT_OPTIONS, levels: { center: 1, mfg1: 1, mfg2: 1, grow: 0, guest: 0 }, grow: { 晶植: 0, 菌类: 0, 矿物: 0 } };
const input = (name, elite) => ({ operators: [{ name, elite }], options });

test("Argent Flow unlocks manufacturing efficiency and morale skills at the actual elite stages", () => {
  for (const [elite, efficiency, reduction] of [[0, 0, 0], [1, 0.2, 0], [2, 0.2, 0.14], [3, 0.3, 0.14], [4, 0.3, 0.18]]) {
    const { ops } = prepare(input("明河", elite));
    assert.equal(ops[0].charId, "chr_0037_minghe");
    assert.equal(Math.max(0, ...ops[0].skills.filter(s => s.kind === "加成").map(s => s.value)), efficiency);
    assert.equal(Math.max(0, ...ops[0].skills.filter(s => s.kind === "减免").map(s => s.value)), reduction);
    assert.ok(ops[0].skills.every(s => s.room === "制造舱" && (s.kind !== "加成" || s.cat === "干员经验")));
  }
  const actual = { ...input("明河", 4), operators: [{ name: "明河", elite: 4, latestSpaceshipSkillNodes: ["spaceship_skill_chr_0037_minghe_1_1"] }] };
  assert.equal(prepare(actual).ops[0].skills.length, 1);
  assert.equal(prepare(actual).ops[0].skills[0].value, 0.2, "Skland's actual unlocked nodes override hypothetical elite upgrades");
  assert.deepEqual(parseWorkspace(JSON.stringify({ version: 1, ...input("明河", 4) })).operators, input("明河", 4).operators);
});

test("Argent Flow contributes to operator EXP manufacturing in a verified manual schedule", () => {
  const plan = manualTemplate(options).map(room => room.key === "制造舱1" ? { ...room, a: ["明河"] } : room);
  const result = evaluateManual(input("明河", 4), plan);
  assert.equal(result.verification.ok, true, result.verification.errors.join("; "));
  const manufacturing = result.rooms.find(room => room.key === "制造舱1");
  assert.ok(Math.abs(manufacturing.bonusA - 0.82) < 1e-9);
  assert.ok(manufacturing.value > 0);
});

test("Kay unlocks weapon EXP manufacturing efficiency and morale skills at the actual elite stages", () => {
  for (const [elite, efficiency, reduction] of [[0, 0, 0], [1, 0.2, 0], [2, 0.2, 0.14], [3, 0.3, 0.14], [4, 0.3, 0.18]]) {
    const { ops } = prepare(input("小刻", elite));
    assert.equal(ops[0].charId, "chr_0040_sweetpie");
    assert.equal(Math.max(0, ...ops[0].skills.filter(s => s.kind === "加成").map(s => s.value)), efficiency);
    assert.equal(Math.max(0, ...ops[0].skills.filter(s => s.kind === "减免").map(s => s.value)), reduction);
    assert.ok(ops[0].skills.every(s => s.room === "制造舱" && (s.kind !== "加成" || s.cat === "武器经验")));
  }
  const actual = { ...input("小刻", 4), operators: [{ name: "小刻", elite: 4, latestSpaceshipSkillNodes: ["spaceship_skill_chr_0040_sweetpie_1_1"] }] };
  assert.equal(prepare(actual).ops[0].skills.length, 1);
  assert.equal(prepare(actual).ops[0].skills[0].value, 0.2, "Skland's actual unlocked nodes override hypothetical elite upgrades");
  const restored = parseWorkspace(JSON.stringify({ version: 1, ...actual }));
  assert.deepEqual(restored.operators, actual.operators);
  assert.deepEqual(prepare(restored).ops[0].skills, prepare(actual).ops[0].skills);
});

test("Kay boosts weapon EXP without applying that efficiency to operator EXP", () => {
  for (const [roomKey, bonus] of [["制造舱1", 0.4], ["制造舱2", 0.82]]) {
    const plan = manualTemplate(options).map(room => room.key === roomKey ? { ...room, a: ["小刻"] } : room);
    const result = evaluateManual(input("小刻", 4), plan);
    assert.equal(result.verification.ok, true, result.verification.errors.join("; "));
    const manufacturing = result.rooms.find(room => room.key === roomKey);
    assert.ok(Math.abs(manufacturing.bonusA - bonus) < 1e-9, roomKey);
    assert.ok(manufacturing.value > 0);
  }
  const result = solve({ ...input("小刻", 4), options: { ...options, mfg: "2武器" } });
  assert.equal(result.verification.ok, true, result.verification.errors.join("; "));
  const manufacturing = result.rooms.find(room => room.a.includes("小刻"));
  assert.ok(manufacturing, "Automatic scheduling assigns Kay to a manufacturing cabin");
  assert.ok(Math.abs(manufacturing.bonusA - 0.82) < 1e-9);
  assert.ok(result.scores["武器经验"] > 0);
});
