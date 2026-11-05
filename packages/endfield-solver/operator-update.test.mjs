import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_OPTIONS, manualTemplate, parseWorkspace, prepare } from "./model.mjs";
import { evaluateManual } from "./index.mjs";

const options = { ...DEFAULT_OPTIONS, levels: { center: 1, mfg1: 1, mfg2: 1, grow: 0, guest: 0 }, grow: { 晶植: 0, 菌类: 0, 矿物: 0 } };
const input = elite => ({ operators: [{ name: "明河", elite }], options });

test("Argent Flow unlocks manufacturing efficiency and morale skills at the actual elite stages", () => {
  for (const [elite, efficiency, reduction] of [[0, 0, 0], [1, 0.2, 0], [2, 0.2, 0.14], [3, 0.3, 0.14], [4, 0.3, 0.18]]) {
    const { ops } = prepare(input(elite));
    assert.equal(ops[0].charId, "chr_0037_minghe");
    assert.equal(Math.max(0, ...ops[0].skills.filter(s => s.kind === "加成").map(s => s.value)), efficiency);
    assert.equal(Math.max(0, ...ops[0].skills.filter(s => s.kind === "减免").map(s => s.value)), reduction);
    assert.ok(ops[0].skills.every(s => s.room === "制造舱" && (s.kind !== "加成" || s.cat === "干员经验")));
  }
  const actual = { ...input(4), operators: [{ name: "明河", elite: 4, latestSpaceshipSkillNodes: ["spaceship_skill_chr_0037_minghe_1_1"] }] };
  assert.equal(prepare(actual).ops[0].skills.length, 1);
  assert.equal(prepare(actual).ops[0].skills[0].value, 0.2, "Skland's actual unlocked nodes override hypothetical elite upgrades");
  assert.deepEqual(parseWorkspace(JSON.stringify({ version: 1, ...input(4) })).operators, input(4).operators);
});

test("Argent Flow contributes to operator EXP manufacturing in a verified manual schedule", () => {
  const plan = manualTemplate(options).map(room => room.key === "制造舱1" ? { ...room, a: ["明河"] } : room);
  const result = evaluateManual(input(4), plan);
  assert.equal(result.verification.ok, true, result.verification.errors.join("; "));
  const manufacturing = result.rooms.find(room => room.key === "制造舱1");
  assert.ok(Math.abs(manufacturing.bonusA - 0.82) < 1e-9);
  assert.ok(manufacturing.value > 0);
});
