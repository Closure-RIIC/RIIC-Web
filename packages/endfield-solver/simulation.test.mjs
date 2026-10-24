import assert from "node:assert/strict";
import test from "node:test";
import raw from "./data/ship-data.json" with { type: "json" };
import { catalog } from "./model.mjs";
import { MFG_LAYOUTS, SIM_RATES, hasShipSkills, operatorEffects } from "./simulation.mjs";
import { ASSIST_MOOD, CENTER_CAP, COST_BASE, HEAD, REC_BASE, SLOTS } from "./upstream/evaluator.mjs";

const unlockOf = skill => Number.isFinite(Number(skill.unlock)) ? Number(skill.unlock) : 0;
const rateOf = skill => Number(skill.effect?.rate);

/** 找一个拥有至少两档「全员心情恢复」的干员，用来验证“只取最高档”。 */
const recoveryOperator = raw.operators.find(operator =>
  (operator.shipSkills || []).filter(skill => skill.effect?.key === "MoodRecoveryAll" && rateOf(skill) > 0).length >= 2);

test("simulation rates stay identical to the solver constants", () => {
  assert.equal(SIM_RATES.work, COST_BASE);
  assert.equal(SIM_RATES.rest, REC_BASE);
  assert.equal(SIM_RATES.head, HEAD);
  assert.equal(SIM_RATES.assist, ASSIST_MOOD);
  assert.equal(SIM_RATES.slots, SLOTS);
  assert.equal(SIM_RATES.centerCapHours, CENTER_CAP);
  assert.deepEqual(MFG_LAYOUTS["1干员1武器"], ["干员经验", "武器经验"]);
});

test("every displayed operator resolves without duplicate effect keys", () => {
  for (const operator of catalog) {
    const effects = operatorEffects({ name: operator.name, elite: 4 });
    const keys = effects.map(effect => `${effect.room}|${effect.kind}|${effect.cat ?? ""}`);
    assert.equal(new Set(keys).size, keys.length, `${operator.name} repeats an effect key`);
    for (const effect of effects) assert.ok(effect.value > 0 && Number.isFinite(effect.value));
  }
});

test("the highest unlocked tier wins instead of summing tiers", () => {
  assert.ok(recoveryOperator, "fixture operator must exist");
  const tiers = recoveryOperator.shipSkills.filter(skill => skill.effect?.key === "MoodRecoveryAll" && rateOf(skill) > 0);
  const expected = Math.max(...tiers.filter(skill => unlockOf(skill) <= 4).map(rateOf));
  const sum = tiers.filter(skill => unlockOf(skill) <= 4).reduce((total, skill) => total + rateOf(skill), 0);
  const effects = operatorEffects({ name: recoveryOperator.name, elite: 4 });
  const recovery = effects.filter(effect => effect.room === "中枢" && effect.kind === "恢复");
  assert.equal(recovery.length, 1);
  assert.ok(Math.abs(recovery[0].value - expected) < 1e-12);
  assert.ok(expected < sum, "tiers must not be added together");
});

test("unlocked skill nodes win over the elite fallback", () => {
  assert.ok(recoveryOperator);
  const tiers = recoveryOperator.shipSkills
    .filter(skill => skill.effect?.key === "MoodRecoveryAll" && rateOf(skill) > 0)
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
  const low = tiers[0];
  const fromNode = operatorEffects({ name: recoveryOperator.name, elite: 4, latestSpaceshipSkillNodes: [low.skillId] });
  assert.equal(fromNode.length, 1);
  assert.ok(Math.abs(fromNode[0].value - rateOf(low)) < 1e-12);
  assert.equal(fromNode[0].nodeId, low.skillId);
});

test("an explicit empty node list unlocks nothing and unknown operators are inert", () => {
  assert.ok(recoveryOperator);
  assert.deepEqual(operatorEffects({ name: recoveryOperator.name, elite: 4, latestSpaceshipSkillNodes: [] }), []);
  assert.deepEqual(operatorEffects({ name: "不存在的干员", elite: 4 }), []);
  assert.deepEqual(operatorEffects({}), []);
  assert.equal(hasShipSkills(recoveryOperator.name), true);
  assert.equal(hasShipSkills("不存在的干员"), false);
  const noSkills = raw.operators.find(operator => !(operator.shipSkills || []).length);
  assert.equal(hasShipSkills(noSkills.name), false);
});
