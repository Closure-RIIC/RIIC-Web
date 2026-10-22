import assert from "node:assert/strict";
import test from "node:test";
import { catalog, DEFAULT_OPTIONS, evaluateManual, manualTemplate, parseRoster, parseWorkspace, solve, validateOptions } from "./index.mjs";
import { prepare } from "./model.mjs";
import { resetCaches, solveLayout } from "./upstream/optimizer.mjs";
import { verifyPlan } from "./upstream/verify-plan.mjs";

const input = {
  operators: catalog.slice(0, 8).map(o => ({ name: o.name, elite: 0 })),
  options: { ...DEFAULT_OPTIONS, levels: { center: 1, mfg1: 1, mfg2: 1, grow: 0, guest: 0 }, grow: { 晶植: 0, 菌类: 0, 矿物: 0 }, time: 30000, budget: 10000 },
};
test("roster validation rejects duplicates, unknown operators and invalid elite stages", () => {
  const one = input.operators[0];
  assert.deepEqual(parseRoster({ operators: [one] }), [one]);
  for (const roster of [[], [one, one], [{ name: "不存在", elite: 4 }], [{ ...one, elite: 5 }], [{ ...one, elite: 1.5 }]]) assert.throws(() => parseRoster(roster));
});
test("facility unlock rules, growing capacity, priority and execution budgets are enforced", () => {
  assert.doesNotThrow(() => validateOptions(input.options));
  assert.throws(() => validateOptions({ ...input.options, levels: { ...input.options.levels, guest: 3 } }));
  assert.throws(() => validateOptions({ ...input.options, grow: { 晶植: 9 } }));
  assert.throws(() => validateOptions({ ...input.options, priority: ["线索", "线索", "武器经验", "培养"] }));
  assert.throws(() => validateOptions({ ...input.options, time: 30001 }));
});
test("workspace restoration validates versions and content and allows an empty starting roster", () => {
  const value = { version: 1, ...input };
  assert.deepEqual(parseWorkspace(JSON.stringify(value)), value);
  assert.equal(parseWorkspace(JSON.stringify({ ...value, operators: [] })).operators.length, 0);
  assert.throws(() => parseWorkspace(JSON.stringify({ ...value, version: 2 })));
  assert.throws(() => parseWorkspace("{broken"));
  assert.equal(parseWorkspace(JSON.stringify({ ...value, options: {} })).options.levels.center, 5);
  assert.throws(() => parseWorkspace(JSON.stringify({ ...value, options: null })));
  assert.throws(() => parseWorkspace(JSON.stringify({ ...value, options: { mfg: "__proto__" } })));
});
test("website adapter preserves direct upstream results and independent verification", () => {
  const progress = [];
  const result = solve(input, event => progress.push(event));
  const { ops, cfg } = prepare(input);
  resetCaches();
  const direct = solveLayout({ ops, cfg });
  const checked = verifyPlan({ ops, cfg, plan: direct.plan });
  assert.equal(result.verification.ok, true);
  assert.equal(checked.ok, true);
  assert.deepEqual(result.scores, Object.fromEntries(cfg.priority.map((c, i) => [c, direct.plan.score[i]])));
  assert.equal(result.status.stopReason, direct.status.stopReason);
  assert.deepEqual(progress.map(event => event.stage), ["preparing", "searching", "verifying"]);
  assert.ok(progress.every((event, i) => Number.isFinite(event.elapsedMs) && event.elapsedMs >= (progress[i - 1]?.elapsedMs ?? 0)));
  assert.doesNotThrow(() => JSON.stringify(result), "JSON DTO must not leak BigInt masks");
});
test("manual simulation validates unique crews and supports real production output", () => {
  const plan = manualTemplate(input.options).map((room, i) => ({ ...room, a: [input.operators[i * 2].name], b: [input.operators[i * 2 + 1].name] }));
  const progress = [];
  const result = evaluateManual(input, plan, event => progress.push(event));
  assert.deepEqual(progress.map(event => event.stage), ["preparing", "searching", "verifying"]);
  assert.equal(result.verification.ok, true, result.verification.errors.join(";"));
  assert.equal(result.rooms.length, 2);
  assert.ok(result.rooms.every(room => room.value > 0 && room.converged));
  assert.throws(() => evaluateManual(input, plan.map((p, i) => i === 1 ? { ...p, a: plan[0].a } : p)), /重复排班/);
  assert.throws(() => evaluateManual(input, plan.map((p, i) => i === 0 ? { ...p, hour: 24 } : p)), /1–23/);
});
test("budget exhaustion remains distinct from a completed search", () => {
  const result = solve({ ...input, options: { ...input.options, budget: 1 } });
  assert.equal(result.status.searchComplete, false);
  assert.equal(result.status.stopReason, "node-budget");
});
test("partial manual drafts round-trip safely and reject unknown or repeated crews", () => {
  const manual = manualTemplate(input.options);
  manual[0].a = [input.operators[0].name];
  const value = { version: 1, ...input, manual };
  assert.deepEqual(parseWorkspace(JSON.stringify(value)), value);
  const bad = structuredClone(value);
  bad.manual[1].a = [bad.manual[0].a[0]];
  assert.throws(() => parseWorkspace(JSON.stringify(bad)), /重复/);
});

test("displayed room bonuses include staffing and only the highest unlocked skill", () => {
  const fixture = { ...input, operators: input.operators.map(op => ({ ...op, elite: 4 })) };
  const crews = {
    中枢: [["艾维文娜"], ["弧光"]],
    制造舱1: [["余烬"], ["赛希"]],
    制造舱2: [["佩丽卡"], ["陈千语"]],
  };
  const assignments = manualTemplate(fixture.options).map(room => ({ ...room, a: crews[room.key][0], b: crews[room.key][1] }));
  const result = evaluateManual(fixture, assignments);
  for (const room of result.rooms) {
    assert.ok(Math.abs(room.bonusA - 0.82) < 1e-9, `${room.key} A includes 40% staffing and 30% skill`);
    assert.ok(Math.abs(room.bonusB - 0.68) < 1e-9, `${room.key} B includes 40% staffing and 20% skill`);
  }
  const lowerElite = evaluateManual({
    ...fixture,
    operators: fixture.operators.map(op => op.name === "佩丽卡" ? { ...op, elite: 2 } : op),
  }, assignments);
  assert.ok(Math.abs(lowerElite.rooms.find(room => room.key === "制造舱2").bonusA - 0.68) < 1e-9);
});

test("growth bonuses are weighted by occupied plots without treating plot count as a bonus", () => {
  const growthNames = ["陈千语", "狼卫"];
  const otherNames = catalog.filter(op => !growthNames.includes(op.name)).slice(0, 8).map(op => op.name);
  const fixture = {
    operators: [...otherNames, ...growthNames].map(name => ({ name, elite: 4 })),
    options: {
      ...input.options,
      levels: { center: 2, mfg1: 1, mfg2: 1, grow: 1, guest: 0 },
      grow: { 晶植: 2, 菌类: 0, 矿物: 1 },
    },
  };
  let offset = 0;
  const assignments = manualTemplate(fixture.options).map(room => {
    if (room.key === "培养舱") return { ...room, a: [growthNames[0]], b: [growthNames[1]] };
    const a = otherNames.slice(offset, offset += room.slots);
    const b = otherNames.slice(offset, offset += room.slots);
    return { ...room, a, b };
  });
  const mixed = evaluateManual(fixture, assignments).rooms.find(room => room.key === "培养舱");
  assert.ok(Math.abs(mixed.bonusA - 0.54) < 1e-9);
  assert.ok(Math.abs(mixed.bonusB - 0.54) < 1e-9);
  const minerals = evaluateManual({
    ...fixture,
    options: { ...fixture.options, grow: { 晶植: 0, 菌类: 0, 矿物: 3 } },
  }, assignments).rooms.find(room => room.key === "培养舱");
  assert.ok(Math.abs(minerals.bonusA - 0.82) < 1e-9);
  assert.ok(Math.abs(minerals.bonusB - 0.82) < 1e-9);
});

test("center staffs only recovery operators and keeps the baseline production", () => {
  const result = solve({
    operators: catalog.map(op => ({ name: op.name, elite: 4 })),
    options: { ...DEFAULT_OPTIONS },
  });
  assert.equal(result.verification.ok, true, result.verification.errors.join(";"));
  const centerPeople = result.center.a.length + result.center.b.length;
  assert.ok(centerPeople < 6, `center must not pad every shift to the slot count (got ${centerPeople})`);
  assert.ok(Math.abs(result.scores["线索"] - 95.04) < 1e-9);
  assert.ok(Math.abs(result.scores["干员经验"] - 99.22) < 1e-9);
  assert.ok(Math.abs(result.scores["武器经验"] - 97.02) < 1e-9);
  assert.ok(Math.abs(result.scores["培养"] - 775.7951219512195) < 1e-6);
});

test("a roster without center recovery skills leaves the center unmanned", () => {
  const recovery = new Set(catalog
    .filter(op => op.skills.some(s => s.room === "总控中枢" && s.effectKey === "MoodRecoveryAll"))
    .map(op => op.name));
  const roster = catalog
    .filter(op => !recovery.has(op.name))
    .slice(0, 8)
    .map(op => ({ name: op.name, elite: 4 }));
  const result = solve({ operators: roster, options: { ...DEFAULT_OPTIONS } });
  assert.equal(result.center.a.length + result.center.b.length, 0);
  assert.equal(result.center.recoveryA, 0);
  assert.equal(result.center.recoveryB, 0);
});
