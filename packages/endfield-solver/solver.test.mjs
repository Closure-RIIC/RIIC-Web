import assert from "node:assert/strict";
import test from "node:test";
import { catalog, DEFAULT_OPTIONS, evaluateManual, manualTemplate, parseRoster, parseWorkspace, solve, validateOptions } from "./index.mjs";
import { prepare } from "./model.mjs";
import { clueBestOf, clueRankOf, resetCaches, solveLayout } from "./upstream/optimizer.mjs";
import { isUseful } from "./upstream/candidates.mjs";
import { verifyPlan } from "./upstream/verify-plan.mjs";
import { randomCase } from "./fuzz-verify.mjs";

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

test("manual evaluation supports empty and partial shifts without inventing production", () => {
  const empty = manualTemplate(input.options);
  const result = evaluateManual({ ...input, operators: [] }, empty);
  assert.equal(result.verification.ok, true, result.verification.errors.join(";"));
  assert.ok(result.rooms.every(room => room.value === 0 && room.converged && !room.single));
  assert.ok(Object.values(result.scores).every(value => value === 0));
  const partial = structuredClone(empty);
  partial[1].a = [input.operators[0].name];
  const first = evaluateManual(input, partial);
  assert.equal(first.verification.ok, true, first.verification.errors.join(";"));
  assert.ok(first.rooms[0].value > 0);
  assert.equal(first.rooms[1].value, 0);
  partial[1].hour = 6;
  const shorter = evaluateManual(input, partial);
  assert.equal(shorter.verification.ok, true, shorter.verification.errors.join(";"));
  assert.ok(shorter.rooms[0].value < first.rooms[0].value, "An empty B shift must not restart the A crew early");
  partial[0].a = [input.operators[1].name];
  assert.equal(evaluateManual(input, partial).verification.ok, true, "The center may have just one occupied shift");
  assert.throws(() => evaluateManual(input, partial.map((room, i) => i === 2 ? { ...room, a: partial[1].a } : room)), /重复排班/);
  assert.throws(() => evaluateManual(input, partial.map((room, i) => i === 1 ? { ...room, a: [input.operators[0].name, input.operators[2].name] } : room)), /人数不合法/);
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
  const clueOption = result.production["线索"].options[0];
  assert.equal(clueOption.name, "线索");
  assert.equal(clueOption.units, 3.89);
  assert.ok(Math.abs(clueOption.baseHours - (8_800_000 / (100 * 60 * 60))) < 1e-12);
  const operatorExp = result.production["干员经验"];
  const operatorExpByRecord = result.scores["干员经验"] * 360_000 / 3_520_000 * 10_000;
  const operatorExpByCarrier = result.scores["干员经验"] * 360_000 / 8_800_000 * 25_000;
  assert.ok(Math.abs(operatorExp.experience - operatorExpByRecord) < 1e-6);
  assert.ok(Math.abs(operatorExp.experience - operatorExpByCarrier) < 1e-6);
  assert.ok(Math.abs(operatorExp.sanity - operatorExp.experience / (170_000 / 80)) < 0.01);
  const weaponExp = result.production["武器经验"];
  const weaponItems = result.scores["武器经验"] * 360_000 / 3_520_000;
  assert.ok(Math.abs(weaponExp.experience - weaponItems * 10_000) < 1e-6);
  assert.ok(Math.abs(weaponExp.sanity - weaponExp.experience / (170_000 / 80)) < 0.01);
  assert.deepEqual(result.production["培养"].options.map(option => [option.name, option.input, option.units, option.effectiveHours]), [["金色晶植", "受蚀玉化叶根茎", 18.62, 775.8]]);
});

test("mixed growth slots report each configured high-grade output separately", () => {
  const operators = catalog.slice(0, 5).map(op => ({ name: op.name, elite: 4 }));
  for (const grow of [
    { 晶植: 0, 菌类: 3, 矿物: 6 },
    { 晶植: 3, 菌类: 3, 矿物: 3 },
  ]) {
    const options = { ...DEFAULT_OPTIONS, grow };
    const assignments = manualTemplate(options).map((room, index) => ({ ...room, a: [operators[index].name], b: [] }));
    const result = evaluateManual({ operators, options }, assignments);
    const outputs = result.production["培养"].options;
    assert.deepEqual(outputs.map(option => option.kind).sort(), Object.entries(grow).filter(([, slots]) => slots > 0).map(([kind]) => kind).sort());
    assert.ok(outputs.every(option => option.units > 0 && option.name.startsWith("金色")));
  }
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

test("clue-probability priority follows tier, clue 3 and clue 7 tiers", () => {
  const names = ["阿列什", "艾维文娜", "噗切娜", "黎风", "弭弗", "余烬", "赛希", "弧光", "别礼"];
  const expected = {
    4: [1, 1, 1, 3, 3, 1, 1, 1, 7],
    3: [2, 2, 1, 4, 3, 2, 2, 2, 6],
    2: [2, 2, 2, 4, 4, 2, 2, 2, 6],
    1: [5, 5, 2, 5, 4, 5, 5, 5, 5],
  };
  for (const [elite, ranks] of Object.entries(expected)) {
    const { ops } = prepare({
      operators: names.map(name => ({ name, elite: Number(elite) })),
      options: { ...DEFAULT_OPTIONS },
    });
    assert.deepEqual(ops.map(clueRankOf), ranks, `elite ${elite}`);
  }
});

test("clue-probability skills survive Skland exact node filtering", () => {
  const withNode = nodeId => prepare({
    operators: [{ name: "赛希", elite: 4, latestSpaceshipSkillNodes: [nodeId] }],
    options: { ...DEFAULT_OPTIONS },
  }).ops[0];
  assert.equal(clueRankOf(withNode("spaceship_skill_chr_0011_seraph_2_2")), 1); // β
  assert.equal(clueRankOf(withNode("spaceship_skill_chr_0011_seraph_2_1")), 2); // α
});

test("guest-room fillers prefer clue-probability operators over plain whiteboards", () => {
  const roster = catalog.map(op => ({ name: op.name, elite: 4 }));
  const result = solve({ operators: roster, options: { ...DEFAULT_OPTIONS } });
  assert.equal(result.verification.ok, true, result.verification.errors.join(";"));
  const guest = result.rooms.find(room => room.key === "会客室");
  const { ops } = prepare({ operators: roster, options: { ...DEFAULT_OPTIONS } });
  const byName = new Map(ops.map(op => [op.name, op]));
  const isFiller = name => !isUseful(byName.get(name), { room: "会客室", weights: { 线索: 1 } });
  const fillers = [...guest.a, ...guest.b].filter(isFiller);
  assert.ok(fillers.length > 0, "the default plan still uses guest-room fillers");
  for (const name of fillers) {
    assert.ok(clueRankOf(byName.get(name)) < 5, `${name} should carry a clue-probability skill better than a whiteboard`);
  }
  assert.ok(Math.abs(result.scores["线索"] - 95.04) < 1e-9);
});

test("clue 7 ranks below a plain whiteboard and is only used when no whiteboard is left", () => {
  const rankAt = elite => {
    const { ops } = prepare({
      operators: [{ name: "别礼", elite }, { name: "伊冯", elite: 4 }],
      options: { ...DEFAULT_OPTIONS },
    });
    return { bila: clueRankOf(ops[0]), plain: clueRankOf(ops[1]) };
  };
  const e4 = rankAt(4);
  const e2 = rankAt(2);
  assert.equal(e4.bila, 7, "别礼 E4 unlocks β7, and β always sits after α");
  assert.equal(e2.bila, 6, "without β7 the α7 tier applies");
  assert.equal(e4.plain, 5, "a plain operator sits on the whiteboard tier");
  assert.ok(e4.plain < e2.bila && e2.bila < e4.bila, "whiteboard < α7 < β7");

  // 反向：只剩别礼、没有白板时，他仍然要被用上（覆盖下限会优先把他派去填舱，
  // 所以只断言"出现在方案里"，不限定必须是会客室补位）
  const guestOnly = solve({
    operators: ["艾尔黛拉", "洛茜", "别礼"].map(name => ({ name, elite: 4 })),
    options: { ...DEFAULT_OPTIONS, levels: { center: 5, mfg1: 1, mfg2: 1, grow: 0, guest: 3 }, grow: { 晶植: 0, 菌类: 0, 矿物: 0 } },
  });
  const used = guestOnly.rooms.flatMap(room => [...room.a, ...room.b]);
  assert.ok(used.includes("别礼"), "clue 7 must still be used when nothing else is free");
});

test("a spare whiteboard displaces clue 7 from the guest room", () => {
  const roster = [
    "艾尔黛拉", "洛茜", "别礼",
    "佩丽卡", "陈千语", "狼卫", "洁尔佩塔", "昼雪", "莱万汀", "伊冯", "大潘",
    "安塔尔", "汤汤", "卡契尔", "萤石", "秋栗",
  ].map(name => ({ name, elite: 4 }));
  const result = solve({
    operators: roster,
    options: { ...DEFAULT_OPTIONS, levels: { center: 5, mfg1: 1, mfg2: 1, grow: 0, guest: 3 }, grow: { 晶植: 0, 菌类: 0, 矿物: 0 } },
  });
  const guest = result.rooms.find(room => room.key === "会客室");
  const guestNames = [...guest.a, ...guest.b];
  const usedNames = new Set([...result.center.a, ...result.center.b, ...result.rooms.flatMap(room => [...room.a, ...room.b])]);
  // 前提：确实还有白板闲着（汤汤），别礼也在名单里
  assert.ok(!guestNames.includes("别礼"), "别礼 must not sit in the guest room while a whiteboard is spare");
  assert.ok(!usedNames.has("汤汤"), "仍然应该有空闲的白板");
});

test("pair layouts report each facility's value from its own emitted crew", () => {
  // 回归：同类双舱（2干员）下，pick 曾沿用候选对象上"另一个签名组"的评估结果，
  // 导致记录的 72.320567 与真实 68.238032 不一致、verifyPlan 判失败。
  const roster = [
    "佩丽卡", "陈千语", "狼卫", "洁尔佩塔", "昼雪", "莱万汀", "伊冯", "大潘", "卡契尔",
    "萤石", "安塔尔", "艾尔黛拉", "别礼", "骏卫", "汤汤", "洛茜", "庄方宜", "诀", "卡缪",
    "提弗洛斯", "祀",
  ].map(name => ({ name, elite: 4 }));
  const result = solve({ operators: roster, options: { ...DEFAULT_OPTIONS, mfg: "2干员", time: 30000, budget: 2000000 } });
  assert.equal(result.verification.ok, true, result.verification.errors.join(";"));
  assert.ok(Math.abs(result.scores["干员经验"] - 147.58) < 0.05, `干员经验 ${result.scores["干员经验"]}`);
});

test("center leaves clue-probability operators to the guest room", () => {
  // 中枢原来只看加成/减免，带 C2(1–6) 的干员机会成本为 0，会被中枢锁住，
  // 会客室只能退而用"对会客室是白板"的人。修复后中枢改拿同 u、但没有线索价值的替代者。
  const roster = ["艾尔黛拉", "洛茜", "佩丽卡", "艾维文娜", "卡契尔", "阿列什", "伊冯", "汤汤", "萤石", "大潘"]
    .map(name => ({ name, elite: 4 }));
  const result = solve({
    operators: roster,
    options: { ...DEFAULT_OPTIONS, levels: { center: 5, mfg1: 1, mfg2: 1, grow: 0, guest: 3 }, grow: { 晶植: 0, 菌类: 0, 矿物: 0 } },
  });
  const centerNames = [...result.center.a, ...result.center.b];
  const guestNames = [...result.rooms.find(room => room.key === "会客室").a, ...result.rooms.find(room => room.key === "会客室").b];
  for (const name of ["艾维文娜", "阿列什"]) {
    assert.ok(!centerNames.includes(name), `${name} 不该被中枢占用`);
    assert.ok(guestNames.includes(name), `${name} 应该留给会客室`);
  }
  assert.ok(result.verification.ok, result.verification.errors.join(";"));
});

test("clue dedupe keeps one operator per clue index and prefers the higher tier", () => {
  const one = (name, elite) => prepare({ operators: [{ name, elite }], options: DEFAULT_OPTIONS }).ops[0];
  // 同一条线索的不同档位：优先高（β）
  assert.deepEqual(clueBestOf(one("艾维文娜", 4)), { rank: 1, clue: 2 });
  assert.deepEqual(clueBestOf(one("艾维文娜", 2)), { rank: 2, clue: 2 });
  assert.deepEqual(clueBestOf(one("黎风", 4)), { rank: 3, clue: 3 });
  assert.deepEqual(clueBestOf(one("弭弗", 1)), { rank: 4, clue: 3 });
  // 线索 7 例外：低档（α）优先
  assert.deepEqual(clueBestOf(one("别礼", 4)), { rank: 7, clue: 7 });
  assert.deepEqual(clueBestOf(one("别礼", 2)), { rank: 6, clue: 7 });
  assert.equal(clueBestOf(one("伊冯", 4)), null);

  // 会客室里同一条线索只出现一次（标准 32 人名单）
  const roster = catalog.map(op => ({ name: op.name, elite: 4 }));
  const result = solve({ operators: roster, options: { ...DEFAULT_OPTIONS } });
  const guest = result.rooms.find(room => room.key === "会客室");
  const { ops } = prepare({ operators: roster, options: { ...DEFAULT_OPTIONS } });
  const byName = new Map(ops.map(op => [op.name, op]));
  const indices = [...guest.a, ...guest.b]
    .map(name => clueBestOf(byName.get(name))?.clue)
    .filter(index => index !== undefined);
  assert.equal(new Set(indices).size, indices.length, `会客室出现重复线索编号：${indices.join(",")}`);
});

test("randomized self-consistency holds for the audit seeds", () => {
  // 这三组来自随机化审计（fuzz-verify.mjs）：47/136 曾因"人都被塞进前一类别"直接无解，
  // 156 曾因助力周期指向已被替换掉的旧班底而校验失败。
  for (const seed of [47, 136, 156]) {
    const { operators, options } = randomCase(seed);
    const result = solve({ operators, options });
    assert.equal(result.verification.ok, true, `seed ${seed}: ${result.verification.errors.join(";")}`);
    const byCat = {};
    for (const room of result.rooms) byCat[room.category] = (byCat[room.category] ?? 0) + room.value;
    for (const [cat, sum] of Object.entries(byCat)) {
      assert.ok(Math.abs((result.scores[cat] ?? 0) - sum) < 1e-6, `seed ${seed}: 类别 ${cat} 不等于舱室之和`);
    }
  }
});

test("stronger B shift moves to A when the facility efficiency does not drop", () => {
  const roster = catalog.map(op => ({ name: op.name, elite: 4 }));
  const options = { ...DEFAULT_OPTIONS, mfg: "2干员" };
  const { ops, cfg } = prepare({ operators: roster, options });
  const { plan } = solveLayout({ ops, cfg });
  for (const pick of plan.picks) {
    if (pick.single) continue;
    assert.ok(pick.stB.unit <= pick.stA.unit + 1e-9, `${pick.spec.key} should keep the stronger shift in A`);
  }
  const mfg = plan.picks.find(pick => pick.spec.key === "制造舱1");
  assert.ok(mfg);
  assert.equal(mfg.h, 14);
  assert.ok(Math.abs(mfg.stA.unit - 3.96) < 1e-9);
  assert.ok(Math.abs(mfg.stB.unit - 2.64) < 1e-9);
  const result = solve({ operators: roster, options });
  assert.equal(result.verification.ok, true, result.verification.errors.join(";"));
  assert.ok(Math.abs(result.scores["干员经验"] - 171.82) < 1e-9);
});

test("default and assist plans already keep the stronger shift in A", () => {
  const roster = catalog.map(op => ({ name: op.name, elite: 4 }));
  for (const options of [{ ...DEFAULT_OPTIONS }, { ...DEFAULT_OPTIONS, assist: true }]) {
    const { ops, cfg } = prepare({ operators: roster, options });
    const { plan } = solveLayout({ ops, cfg });
    for (const pick of plan.picks) {
      if (pick.single) continue;
      assert.ok(pick.stB.unit <= pick.stA.unit + 1e-9, `${pick.spec.key} B should not be stronger than A`);
    }
  }
});

// ── 决策 65：除中枢外每舱 ≥1 人 + 缺项进 skipped（不再算校验失败） ──
const roster14 = ["莱万汀", "庄方宜", "余烬", "佩丽卡", "艾维文娜", "别礼", "伊冯", "艾尔黛拉", "提弗洛斯", "汤汤", "洛茜", "祀", "诀", "弭弗"];
const zeroSkill14 = roster14.map(name => ({ name, elite: 4, latestSpaceshipSkillNodes: [] }));
const fullSkill14 = roster14.map(name => ({ name, elite: 4 }));
const everyFacilityStaffed = result => {
  const rooms = new Map(result.rooms.map(room => [room.key, room]));
  const expected = ["会客室", "制造舱1", "制造舱2", "培养舱"];
  for (const key of expected) {
    const room = rooms.get(key);
    assert.ok(room, `${key} should appear in the plan`);
    assert.ok(room.a.length + room.b.length >= 1, `${key} needs at least one operator`);
  }
};

test("a 14-operator dual-experience pool with no skills still staffs every facility", () => {
  const result = solve({ operators: zeroSkill14, options: { ...DEFAULT_OPTIONS, mfg: "2干员", time: 30000, budget: 2000000 } });
  everyFacilityStaffed(result);
  assert.equal(result.verification.ok, true, result.verification.errors.join(";"));
  assert.deepEqual(result.verification.skipped, []);
  assert.ok(result.scores["干员经验"] > 0, "the two manufacturing facilities must produce experience");
});

test("a 14-operator single-experience pool also staffs every facility", () => {
  const result = solve({ operators: zeroSkill14, options: { ...DEFAULT_OPTIONS, time: 30000, budget: 2000000 } });
  everyFacilityStaffed(result);
  assert.equal(result.verification.ok, true, result.verification.errors.join(";"));
  assert.deepEqual(result.verification.skipped, []);
});

test("a full-skill 14-operator pool staffs every facility as well", () => {
  const result = solve({ operators: fullSkill14, options: { ...DEFAULT_OPTIONS, mfg: "2干员", time: 30000, budget: 2000000 } });
  everyFacilityStaffed(result);
  assert.equal(result.verification.ok, true, result.verification.errors.join(";"));
  assert.deepEqual(result.verification.skipped, []);
});

test("facilities that cannot be staffed are reported as skipped, not as verification errors", () => {
  const result = solve({ operators: [{ name: "莱万汀", elite: 4 }, { name: "余烬", elite: 4 }], options: { ...DEFAULT_OPTIONS, time: 30000, budget: 2000000 } });
  assert.equal(result.verification.ok, true, result.verification.errors.join(";"));
  const skipped = result.verification.skipped ?? [];
  // 2 人先够 2 个舱：会客室塌成单班 + 制造舱1 单班各 1 人；剩下两个舱才弃。
  assert.equal(skipped.length, 2, JSON.stringify(skipped));
  assert.deepEqual(skipped.map(item => item.key).sort(), ["制造舱2", "培养舱"].sort());
  assert.ok(skipped.every(item => item.reason === "人手不足" && item.cat));
  assert.deepEqual(result.status.gaps.map(gap => gap.key).sort(), skipped.map(item => item.key).sort());
});

test("the coverage floor keeps the stronger shift in A", () => {
  for (const roster of [zeroSkill14, fullSkill14]) {
    const result = solve({ operators: roster, options: { ...DEFAULT_OPTIONS, mfg: "2干员", time: 30000, budget: 2000000 } });
    for (const room of result.rooms) {
      if (room.single) continue;
      assert.ok((room.bonusA ?? 0) >= (room.bonusB ?? 0) - 1e-9,
        `${room.key} keeps the stronger shift in B: A=${room.bonusA} B=${room.bonusB}`);
    }
  }
});

test("the full 32-operator baseline keeps its exact scores after the coverage floor", () => {
  const result = solve({ operators: catalog.map(op => ({ name: op.name, elite: 4 })), options: { ...DEFAULT_OPTIONS, time: 30000, budget: 2000000 } });
  assert.equal(result.verification.ok, true, result.verification.errors.join(";"));
  assert.deepEqual(result.verification.skipped, []);
  assert.ok(Math.abs(result.scores["线索"] - 95.04) < 1e-9, String(result.scores["线索"]));
  assert.ok(Math.abs(result.scores["干员经验"] - 99.22) < 1e-9, String(result.scores["干员经验"]));
  assert.ok(Math.abs(result.scores["武器经验"] - 97.02) < 1e-9, String(result.scores["武器经验"]));
  assert.ok(Math.abs(result.scores["培养"] - 775.795) < 5e-4, String(result.scores["培养"]));
});

test("two workshops with different levels are searched jointly instead of falling back to the pair scan", () => {
  const roster = catalog.map(op => ({ name: op.name, elite: 4 }));
  const levels = { center: 5, mfg1: 3, mfg2: 2, grow: 3, guest: 3 };
  const result = solve({
    operators: roster,
    options: { ...DEFAULT_OPTIONS, mfg: "2干员", levels, grow: { 晶植: 9, 菌类: 0, 矿物: 0 }, time: 30000, budget: 2000000 },
  });
  assert.equal(result.verification.ok, true, result.verification.errors.join(";"));
  const mfg1 = result.rooms.find(room => room.key === "制造舱1");
  const mfg2 = result.rooms.find(room => room.key === "制造舱2");
  assert.equal(mfg1.a.length, 3);          // 3 级舱：满 3 人
  assert.equal(mfg2.a.length, 2);          // 2 级舱：不会套用 3 个工位
  assert.ok(Math.abs(mfg1.value - 90.420) < 5e-4, String(mfg1.value));
  assert.ok(Math.abs(mfg2.value - 65.200) < 5e-4, String(mfg2.value));
  assert.ok(
    !result.status.approximations.some(text => text.includes("参数不一致")),
    result.status.approximations.join(";"),
  );
});

test("a skill-less roster still pairs two different-level workshops (empty relevance path)", () => {
  const roster = catalog.slice(0, 7).map(op => ({ name: op.name, elite: 0 }));
  const result = solve({
    operators: roster,
    options: {
      ...DEFAULT_OPTIONS,
      mfg: "2干员",
      levels: { center: 5, mfg1: 2, mfg2: 1, grow: 0, guest: 1 },
      grow: { 晶植: 0, 菌类: 0, 矿物: 0 },
    },
  });
  assert.equal(result.verification.ok, true, result.verification.errors.join(";"));
  const mfg1 = result.rooms.find(room => room.key === "制造舱1");
  const mfg2 = result.rooms.find(room => room.key === "制造舱2");
  assert.ok(mfg1.a.length <= 2, String(mfg1.a.length));
  assert.ok(mfg2.a.length <= 1, String(mfg2.a.length));
  assert.ok(
    !result.status.approximations.some(text => text.includes("参数不一致")),
    result.status.approximations.join(";"),
  );
});
