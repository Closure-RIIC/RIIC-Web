import { prepare, manualTemplate, SOLVER_REVISION, validateOptions } from "./model.mjs";
export { catalog, nonSchedulableOperators, DEFAULT_OPTIONS, STORAGE_KEY, SOLVER_REVISION, CATEGORIES, parseRoster, parseWorkspace, validateOptions, manualTemplate } from "./model.mjs";
import { solveLayout, resetCaches, facilitySpecs } from "./upstream/optimizer.mjs";
import { verifyPlan } from "./upstream/verify-plan.mjs";
import { buildTimeline, COST_BASE, crewStats, integrate, integrateWrap, simulateFacility, simulateSingleFacility, val } from "./upstream/evaluator.mjs";
import { fromIndices, toIndices } from "./upstream/set.mjs";


function present(plan, status, verification, ops, cfg, started) {
  const names = mask => toIndices(mask ?? 0n).map(i => ops[i].name);
  if (!plan) return { revision: SOLVER_REVISION, status, verification, elapsedMs: Date.now() - started, rooms: [], scores: {}, center: null };
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
      workHours: simulation.workHours ?? null, restHours: simulation.restHours ?? null,
      assist: p.assist ? { points: p.assist.points, shift: p.assist.shift, cycle: p.assist.cycle.map(day => day.map(i => ops[i].name)) } : null,
    };
  });
  return {
    revision: SOLVER_REVISION, status, verification, elapsedMs: Date.now() - started, rooms,
    scores: Object.fromEntries(cfg.priority.map((cat, i) => [cat, plan.score[i]])),
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
