import { prepare, manualTemplate, SOLVER_REVISION, validateOptions } from "./model.mjs";
export { catalog, nonSchedulableOperators, DEFAULT_OPTIONS, STORAGE_KEY, SOLVER_REVISION, CATEGORIES, parseRoster, parseWorkspace, validateOptions, manualTemplate } from "./model.mjs";
import rawShipData from "./data/ship-data.json" with { type: "json" };
import { solveLayout, resetCaches, facilitySpecs } from "./upstream/optimizer.mjs";
import { verifyPlan } from "./upstream/verify-plan.mjs";
import { buildTimeline, COST_BASE, crewStats, integrate, integrateWrap, simulateFacility, simulateSingleFacility, val } from "./upstream/evaluator.mjs";
import { fromIndices, toIndices } from "./upstream/set.mjs";

// Upstream SpaceshipConst uses production points per second. The default
// production rate is 100 and one clue fills at 8,800,000 points.
const BASE_PRODUCTION_RATE_PER_SECOND = 100;
const PROGRESS_PER_HOUR = BASE_PRODUCTION_RATE_PER_SECOND * 60 * 60;
const CLUE_POINT_CAP = 8_800_000;
const CLUE_HOURS_PER_UNIT = CLUE_POINT_CAP / PROGRESS_PER_HOUR;
const OPERATOR_EXP_PER_ITEM = {
  item_expcard_stage1_low: 200, item_expcard_stage1_mid: 1_000, item_expcard_stage1_high: 10_000,
  // Cognitive carriers are converted to battle-record-equivalent EXP (2.5x).
  item_expcard_stage2_low: 2_500, item_expcard_stage2_high: 25_000,
};
// WeaponExpItemTable.itemExp is the unified comparison value; weaponExp is
// the separate in-game weapon-level value.
const WEAPON_EXP_PER_ITEM = { item_weapon_expcard_low: 200, item_weapon_expcard_mid: 1_000, item_weapon_expcard_high: 10_000 };
// The pinned Exp05 A/B bundles each equal 170,000 battle-record-equivalent
// EXP per 80 sanity. Their stacking semantics are not present in the tables.
const OPERATOR_EXP_PER_SANITY = 170_000 / 80;
const WEAPON_EXP_PER_SANITY = 170_000 / 80;

function facilityWithRecipe(predicate) {
  return rawShipData.facilities.find(facility => facility.levels?.some(level => level.summary?.unlockRecipes?.some(predicate)));
}

function recipesAt(facility, level) {
  return facility?.levels?.[Math.max(0, Math.min(facility.levels.length - 1, level - 1))]?.summary?.unlockRecipes ?? [];
}

function latestRecipe(facility, level, predicate) {
  return recipesAt(facility, level).filter(predicate).sort((a, b) => b.totalProgress - a.totalProgress)[0] ?? null;
}

function highestRarityRecipe(facility, level, predicate) {
  return recipesAt(facility, level).filter(predicate)
    .sort((a, b) => (b.rarity ?? 0) - (a.rarity ?? 0) || b.totalProgress - a.totalProgress)[0] ?? null;
}

function growthOutputName(kind, rarity) {
  const grade = rarity === 5 ? "金色" : `${rarity}级`;
  return `${grade}${kind}`;
}

const manufacturingData = facilityWithRecipe(recipe => recipe.id?.startsWith("mfg_exp_"));
const growthData = facilityWithRecipe(recipe => recipe.id?.startsWith("growcabin_"));

function recipeUnits(effectiveHours, recipe, outputCount = 1) {
  if (!recipe || !Number.isFinite(effectiveHours)) return 0;
  return effectiveHours * PROGRESS_PER_HOUR / recipe.totalProgress * outputCount;
}

function buildProduction(rooms, scores, cfg) {
  const production = {};
  const manufacturingLevels = cfg.levels.manufacturing;
  const roomLevel = key => key === "制造舱1" ? manufacturingLevels[0] : manufacturingLevels[1];
  const roomsFor = category => rooms.filter(room => room.category === category);

  if (roomsFor("线索").length) {
    production["线索"] = {
      options: [{
        name: "线索",
        units: Number((scores["线索"] / CLUE_HOURS_PER_UNIT).toFixed(2)),
        baseHours: CLUE_HOURS_PER_UNIT,
      }],
      note: "按上游 8,800,000 点进度和 100 点/秒基础速率换算；具体线索类型仍由概率技能决定。",
    };
  }

  const expRooms = roomsFor("干员经验");
  if (expRooms.length) {
    const experience = expRooms.reduce((total, room) => {
      const level = roomLevel(room.key);
      const recipe = latestRecipe(manufacturingData, level, item => item.id?.startsWith("mfg_exp_1_"))
        ?? latestRecipe(manufacturingData, level, item => item.id?.startsWith("mfg_exp_2_"));
      const expPerItem = OPERATOR_EXP_PER_ITEM[recipe?.productItemId];
      return total + recipeUnits(room.value, recipe, 1) * (expPerItem ?? 0);
    }, 0);
    production["干员经验"] = {
      options: [], experience: Number(experience.toFixed(2)), sanity: Number((experience / OPERATOR_EXP_PER_SANITY).toFixed(2)),
      note: "干员经验按作战记录等效口径；认知载体按 2.5 倍折算。经验副本 A/B 任一奖励包均折合 17 万等效经验 / 80 理智，未假定两包叠加。",
    };
  }

  const weaponRooms = roomsFor("武器经验");
  if (weaponRooms.length) {
    const experience = weaponRooms.reduce((total, room) => {
      const recipe = latestRecipe(manufacturingData, roomLevel(room.key), item => item.id?.startsWith("mfg_weapon_exp_"));
      return total + recipeUnits(room.value, recipe, 1) * (WEAPON_EXP_PER_ITEM[recipe?.productItemId] ?? 0);
    }, 0);
    production["武器经验"] = {
      options: [], experience: Number(experience.toFixed(2)), sanity: Number((experience / WEAPON_EXP_PER_SANITY).toFixed(2)),
      note: "武器经验按解包 WeaponExpItemTable 的 itemExp 统一口径；最高级武器经验副本折合 17 万等效经验 / 80 理智。",
    };
  }

  const growRoom = rooms.find(room => room.category === "培养");
  if (growRoom) {
    const options = Object.entries(cfg.grow).filter(([, slots]) => slots > 0).map(([kind]) => {
      const type = { 菌类: 1, 晶植: 2, 矿物: 3 }[kind];
      const recipe = highestRarityRecipe(growthData, cfg.levels.grow, item => item.type === type);
      if (!recipe) return null;
      const effectiveHours = growRoom.avgByKind?.[kind] ?? 0;
      return {
        name: growthOutputName(kind, recipe.rarity),
        kind,
        units: Number(recipeUnits(effectiveHours, recipe, recipe.outcomeCount ?? 1).toFixed(2)),
        slots: cfg.grow[kind],
        baseHours: recipe.totalProgress / PROGRESS_PER_HOUR,
        outputCount: recipe.outcomeCount ?? 1,
        input: recipe.seed,
        inputCount: recipe.seedCount ?? 1,
        effectiveHours: Number(effectiveHours.toFixed(2)),
      };
    }).filter(Boolean);
    production["培养"] = { options, note: "按当前培养位类别和培养舱等级对应的最高级素材换算。" };
  }
  return production;
}

function present(plan, status, verification, ops, cfg, started) {
  const names = mask => toIndices(mask ?? 0n).map(i => ops[i].name);
  if (!plan) return { revision: SOLVER_REVISION, status, verification, elapsedMs: Date.now() - started, rooms: [], scores: {}, production: {}, center: null };
  const rooms = plan.picks.map(p => {
    const crewA = (p.crewA ?? 0n) | (p.fillCrewA ?? 0n);
    const crewB = (p.crewB ?? 0n) | (p.fillCrewB ?? 0n);
    // Normalize growing slots; full-crew bonuses are not morale-adjusted daily output.
    const baseRate = Object.values(p.spec.weights).reduce((sum, weight) => sum + weight, 0);
    const bonus = mask => {
      const count = toIndices(mask).length;
      return count && baseRate > 0 ? crewStats(ops, mask, p.spec, count).unit / baseRate - 1 : null;
    };
    const simulation = p.single
      ? simulateSingleFacility({ facility: p.spec, ops, plan: p, timeline: plan.center.timeline, limits: cfg.limits })
      : simulateFacility({ facility: p.spec, ops, plan: p, timeline: plan.center.timeline, limits: cfg.limits, assistPlan: p.assist ?? null });
    const mood = (st, hours, start, end) => {
      if (!st) return null;
      const consumption = Math.min(1, st.d * hours);
      const recovery = integrateWrap(start, end, plan.center.timeline);
      return { consumption, recovery, stable: recovery + 1e-9 >= consumption };
    };
    return {
      key: p.spec.key, category: p.spec.cat, single: !!p.single, hour: p.h ?? 24,
      a: names(crewA), b: names(crewB), bonusA: bonus(crewA), bonusB: p.single ? null : bonus(crewB),
      value: p.trueValue, converged: simulation.converged, days: simulation.days ?? 0,
      daily: simulation.daily ?? [], moodA: mood(p.stA, p.h ?? 24, p.h ?? 24, 24),
      moodB: p.single ? null : mood(p.stB, 24 - p.h, 0, p.h),
      avgByKind: simulation.avgByKind ?? {},
      workHours: simulation.workHours ?? null, restHours: simulation.restHours ?? null,
      assist: p.assist ? { points: p.assist.points, shift: p.assist.shift, cycle: p.assist.cycle.map(day => day.map(i => ops[i].name)) } : null,
    };
  });
  const scores = Object.fromEntries(cfg.priority.map((cat, i) => [cat, plan.score[i]]));
  return {
    revision: SOLVER_REVISION, status, verification, elapsedMs: Date.now() - started, rooms,
    scores, production: buildProduction(rooms, scores, cfg),
    center: { hour: plan.center.hCenter, a: plan.center.idxA.map(i => ops[i].name), b: plan.center.idxB.map(i => ops[i].name), recoveryA: plan.center.uA, recoveryB: plan.center.uB },
  };
}

export function solve(input, onProgress) {
  const started = Date.now();
  onProgress?.({ stage: "preparing", elapsedMs: 0 });
  const { ops, cfg } = prepare(input);
  resetCaches();
  onProgress?.({ stage: "searching", elapsedMs: Date.now() - started });
  const result = solveLayout({ ops, cfg });
  onProgress?.({ stage: "verifying", elapsedMs: Date.now() - started });
  const verification = verifyPlan({ ops, cfg, plan: result.plan, skipped: result.status?.skipped ?? [] });
  return present(result.plan, result.status, verification, ops, cfg, started);
}


/** Evaluate a user-authored two-shift plan using the same evaluator and verifier. */
export function evaluateManual(input, assignments, onProgress) {
  const started = Date.now();
  onProgress?.({ stage: "preparing", elapsedMs: 0 });
  const { ops, cfg } = Array.isArray(input.operators) && input.operators.length === 0
    ? { ops: [], cfg: validateOptions(input.options) } : prepare(input);
  if (cfg.assistOn) throw new Error("手动评估暂不支持自动分配助力，请先关闭中枢助力");
  const specs = manualTemplate(input.options);
  if (!Array.isArray(assignments) || assignments.length !== specs.length) throw new Error("手动方案设施数量不匹配");
  const seen = new Set();
  const prepared = specs.map(spec => {
    const matches = assignments.filter(x => x.key === spec.key);
    if (matches.length !== 1) throw new Error(`设施「${spec.key}」缺失或重复`);
    const a = matches[0];
    if (!Number.isInteger(a.hour) || a.hour < 1 || a.hour > 23) throw new Error("换班时间必须是 1–23 的整点");
    const crews = ["a", "b"].map(shift => {
      if (!Array.isArray(a[shift]) || a[shift].length > spec.slots) throw new Error(`「${spec.key}」${shift.toUpperCase()} 班人数不合法`);
      return a[shift].map(name => {
        const i = ops.findIndex(op => op.name === name);
        if (i < 0) throw new Error(`「${name}」不在已选名单中`);
        if (seen.has(name)) throw new Error(`干员「${name}」重复排班`);
        seen.add(name); return i;
      });
    });
    return { ...a, idsA: crews[0], idsB: crews[1] };
  });
  onProgress?.({ stage: "searching", elapsedMs: Date.now() - started });
  const c = prepared[0];
  const uA = c.idsA.reduce((s, i) => s + val(ops[i], "中枢", "恢复"), 0);
  const uB = c.idsB.reduce((s, i) => s + val(ops[i], "中枢", "恢复"), 0);
  const timeline = buildTimeline({ hCenter: c.hour, uA, uB });
  const center = { hCenter: c.hour, idxA: c.idsA, idxB: c.idsB, uA, uB, timeline,
    cA: Math.min(1, COST_BASE * c.hour), cB: Math.min(1, COST_BASE * (24 - c.hour)),
    rA: integrate(c.hour, 24, timeline), rB: integrate(0, c.hour, timeline) };
  const picks = facilitySpecs(cfg).map(spec => {
    const a = prepared.find(a => a.key === spec.key);
    const p = { spec, h: a.hour, crewA: fromIndices(a.idsA), crewB: fromIndices(a.idsB),
      nA: a.idsA.length, nB: a.idsB.length, fillA: 0, fillB: 0, fillCrewA: 0n, fillCrewB: 0n, single: false };
    p.stA = crewStats(ops, p.crewA, spec, p.nA);
    p.stB = crewStats(ops, p.crewB, spec, p.nB);
    const simulation = simulateFacility({ facility: spec, ops, plan: p, timeline, limits: cfg.limits });
    return { ...p, trueValue: simulation.avg, simulation };
  });
  const catRes = Object.fromEntries(cfg.priority.map(cat => {
    const group = picks.filter(p => p.spec.cat === cat);
    return [cat, { picks: group, value: group.reduce((v, p) => v + p.trueValue, 0) }];
  }));
  const plan = { center, picks, catRes, score: cfg.priority.map(cat => catRes[cat].value), usedMask: fromIndices(ops.map((op, i) => seen.has(op.name) ? i : -1).filter(i => i >= 0)) };
  onProgress?.({ stage: "verifying", elapsedMs: Date.now() - started });
  const verification = verifyPlan({ ops, cfg, plan, allowEmptyShifts: true });
  return present(plan, { stopReason: "manual", searchComplete: false, centersVisited: 0, centersTotal: 0, nodes: 0, approximations: [], gaps: [] }, verification, ops, cfg, started);
}
