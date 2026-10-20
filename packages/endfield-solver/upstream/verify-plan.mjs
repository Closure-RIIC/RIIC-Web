/**
 * 独立校验：从实际名单、技能掩码和配置重新计算，不读取优化器的候选分数缓存。
 */

import { has, sizeOf, toIndices, union, EMPTY } from './set.mjs';
import { buildTimeline, simulateFacility, simulateSingleFacility, COST_BASE, integrate, val } from './evaluator.mjs';
import { isUseful } from './candidates.mjs';

const VERIFY_TOL = 1e-6;      // 数值重算容差（逐日模拟与闭式的浮点差）
const STRUCT_TOL = 1e-9;      // 结构量（时间轴、u、R/C）容差

export function verifyPlan({ ops, cfg, plan }) {
  const errors = [];
  if (!plan) return { ok: false, errors: ['无方案'] };

  const seen = new Map();
  let reconstructedUsed = EMPTY;
  const addPeople = (mask, where) => {
    for (const i of toIndices(mask)) {
      if (i >= ops.length) { errors.push(`${where} 含名单范围外的索引 ${i}`); continue; }
      if (seen.has(i)) errors.push(`干员「${ops[i].name}」同时在 ${seen.get(i)} 与 ${where}`);
      else seen.set(i, where);
      reconstructedUsed |= 1n << BigInt(i);
    }
  };

  const c = plan.center;
  if (!c || !Number.isInteger(c.hCenter) || c.hCenter < 1 || c.hCenter > 23) {
    errors.push('中枢换班时刻必须是 1–23 的整点');
  } else {
    if (c.idxA.length !== cfg.centerSlots || c.idxB.length !== cfg.centerSlots) {
      errors.push(`中枢每班必须占满 ${cfg.centerSlots} 个工位（白板也计入）`);
    }
    addPeople(maskFrom(c.idxA), '中枢/A');
    addPeople(maskFrom(c.idxB), '中枢/B');
    const uA = c.idxA.reduce((s, i) => s + val(ops[i], '中枢', '恢复'), 0);
    const uB = c.idxB.reduce((s, i) => s + val(ops[i], '中枢', '恢复'), 0);
    if (Math.abs(uA - c.uA) > STRUCT_TOL || Math.abs(uB - c.uB) > STRUCT_TOL) errors.push('中枢恢复强度与名单不一致');
    const expectedTimeline = buildTimeline({ hCenter: c.hCenter, uA, uB });
    if (!sameTimeline(expectedTimeline, c.timeline)) errors.push('中枢时间轴与名单/换班时刻不一致');

    const cA = Math.min(1, COST_BASE * c.hCenter);
    const cB = Math.min(1, COST_BASE * (24 - c.hCenter));
    const rA = integrate(c.hCenter, 24, expectedTimeline);
    const rB = integrate(0, c.hCenter, expectedTimeline);
    if (rA < cA - VERIFY_TOL) errors.push(`中枢 A 段不满足 R ≥ C（R=${rA.toFixed(6)} C=${cA.toFixed(6)}）`);
    if (rB < cB - VERIFY_TOL) errors.push(`中枢 B 段不满足 R ≥ C（R=${rB.toFixed(6)} C=${cB.toFixed(6)}）`);
    if (Math.abs(c.cA - cA) > STRUCT_TOL || Math.abs(c.cB - cB) > STRUCT_TOL
      || Math.abs(c.rA - rA) > STRUCT_TOL || Math.abs(c.rB - rB) > STRUCT_TOL) {
      errors.push('中枢 C/R 与独立重算不一致');
    }
  }

  const recompute = {};
  const categoryScores = [];
  const assistActions = [];
  const foundFacilities = new Set();
  for (const cat of cfg.priority) {
    const r = plan.catRes[cat];
    if (!r) { categoryScores.push(0); continue; }
    let sum = 0;
    for (const p of r.picks) {
      const tag = p.spec.key;
      foundFacilities.add(tag);
      const fillCrewA = p.fillCrewA || EMPTY;
      const fillCrewB = p.fillCrewB || EMPTY;
      const fullA = union(p.crewA, fillCrewA);
      const fullB = union(p.crewB || EMPTY, fillCrewB);
      addPeople(p.crewA, `${tag}/A 技能人员`);
      addPeople(fillCrewA, `${tag}/A 补位人员`);
      addPeople(p.crewB || EMPTY, `${tag}/B 技能人员`);
      addPeople(fillCrewB, `${tag}/B 补位人员`);

      if (p.fillA !== sizeOf(fillCrewA) || p.fillB !== sizeOf(fillCrewB)) errors.push(`${tag} 补位人数与补位名单不一致`);
      const seats = p.spec.slots || 3;
      if (sizeOf(p.crewA) + sizeOf(fillCrewA) !== p.nA || p.nA < 1 || p.nA > seats) {
        errors.push(`${tag} A 班人数不合法（技能 ${sizeOf(p.crewA)} + 补位 ${sizeOf(fillCrewA)}，记录 ${p.nA}，工位 ${seats}）`);
      }
      if (!p.single && (sizeOf(p.crewB) + sizeOf(fillCrewB) !== p.nB || p.nB < 1 || p.nB > seats)) {
        errors.push(`${tag} B 班人数不合法（技能 ${sizeOf(p.crewB)} + 补位 ${sizeOf(fillCrewB)}，记录 ${p.nB}，工位 ${seats}）`);
      }
      if (p.single && (sizeOf(fullB) !== 0 || p.nB !== 0)) errors.push(`${tag} 单班方案包含 B 班人员`);
      for (const i of toIndices(fillCrewA | fillCrewB)) {
        if (isUseful(ops[i], p.spec)) errors.push(`${tag} 将该设施的技能人员当作白板补位`);
      }
      if (!p.single) {
        for (const i of toIndices(fullA)) if (has(p.crewB || EMPTY, i)) errors.push(`${tag} 同一人在 A/B 两班`);
      }

      if (p.assist) {
        if (!cfg.assistOn) errors.push(`${tag} 出现助力方案，但本次运行没有开启助力`);
        const cycle = p.assist.cycle || [];
        const targetMask = p.assist.shift === 'A' ? fullA : fullB;
        if (!cycle.length) errors.push(`${tag} 助力周期为空`);
        for (const day of cycle) {
          if (!day.length) errors.push(`${tag} 助力周期里有空日`);
          if (new Set(day).size !== day.length) errors.push(`${tag} 同一天的助力目标有重复`);
          for (const i of day) {
            if (!has(targetMask, i)) errors.push(`${tag} 助力目标「${ops[i]?.name ?? i}」不属于受助班次`);
          }
        }
        assistActions.push({ tag, cycle, points: p.assist.points ?? (cycle[0] ? cycle[0].length : 0) });
      }

      const simPlan = {
        h: p.h ?? 24, crewA: p.crewA, crewB: p.crewB || EMPTY, fillCrewA, fillCrewB, nA: p.nA, nB: p.nB,
      };
      const simulation = p.single
        ? simulateSingleFacility({ facility: p.spec, ops, timeline: c.timeline, plan: simPlan, limits: cfg.limits })
        : simulateFacility({
          facility: p.spec, ops, timeline: c.timeline, plan: simPlan,
          limits: cfg.limits, assistPlan: p.assist || null,
        });
      if (!simulation.converged) errors.push(`${tag} 模拟未收敛，不能作为精确产出`);

      // 助力合法性：注入时刻必须真的落在「目标心情 ≤ 70%」处，且当天点数与周期一致
      if (p.assist && simulation.converged) {
        const cycle = p.assist.cycle || [];
        const dayIdx = simulation.dayIndex ?? 0;
        const expected = new Set(cycle[dayIdx % cycle.length] || []);
        const injections = simulation.lastInjections || [];
        for (const inj of injections) {
          if (!expected.has(inj.index)) errors.push(`${tag} 助力注入对象不在当天轮转名单里`);
          if (inj.mood > 0.70 + 1e-9) errors.push(`${tag} 助力注入时目标心情 ${(inj.mood * 100).toFixed(2)}% > 70%，属溢出作废`);
        }
        for (const i of expected) {
          if (!injections.some((inj) => inj.index === i)) errors.push(`${tag} 当天应受助的「${ops[i]?.name ?? i}」没有记录到注入`);
        }
        const maxHour = p.assist.shift === 'A' ? (p.h ?? 24) : 24;
        const minHour = p.assist.shift === 'A' ? 0 : (p.h ?? 24);
        for (const inj of injections) {
          if (inj.hour < minHour - 1e-9 || inj.hour > maxHour + 1e-9) errors.push(`${tag} 助力注入时刻不在受助班次内`);
        }
      }

      const value = simulation.converged ? simulation.avg : NaN;
      if (!Number.isFinite(value)) continue;
      sum += value;
      recompute[tag] = value;
      if (Math.abs(value - p.trueValue) > VERIFY_TOL) {
        errors.push(`${tag} 独立重算 ${value.toFixed(6)} 与记录 ${p.trueValue.toFixed(6)} 不一致`);
      }
    }
    if (Math.abs(sum - r.value) > VERIFY_TOL) errors.push(`类别「${cat}」独立重算 ${sum.toFixed(6)} 与记录 ${r.value.toFixed(6)} 不一致`);
    categoryScores.push(sum);
  }

  const expectedFacilities = [...(cfg.hasGuest ? ['会客室'] : []), ...cfg.manufacturing.map((_, i) => `制造舱${i + 1}`)];
  if (cfg.hasGrow) expectedFacilities.push('培养舱');
  for (const key of expectedFacilities) if (!foundFacilities.has(key)) errors.push(`缺少必需设施方案「${key}」`);

  if (assistActions.length) {
    const period = assistActions.reduce((n, action) => lcm(n, action.cycle.length), 1);
    for (let day = 0; day < period; day += 1) {
      let points = 0;
      const targets = new Set();
      for (const action of assistActions) {
        for (const target of action.cycle[day % action.cycle.length]) {
          points += 1;
          if (targets.has(target)) {
            errors.push(`助力周期第 ${day + 1} 天重复目标「${ops[target]?.name ?? target}」`);
          }
          targets.add(target);
        }
      }
      if (points > cfg.assistPoints) errors.push(`助力周期第 ${day + 1} 天使用 ${points} 点，超过每日 ${cfg.assistPoints} 点`);
    }
  }

  for (let i = 0; i < cfg.priority.length; i += 1) {
    if (Math.abs(categoryScores[i] - plan.score[i]) > VERIFY_TOL) errors.push(`目标向量「${cfg.priority[i]}」与类别产出不一致`);
  }
  if (reconstructedUsed !== plan.usedMask) errors.push('usedMask 与中枢/设施实际人员并集不一致');
  if (sizeOf(reconstructedUsed) > ops.length) errors.push('占用人数超过名单人数');

  return { ok: errors.length === 0, errors, recompute, total: categoryScores.reduce((s, v) => s + v, 0) };
}

function maskFrom(ids) {
  return ids.reduce((m, i) => m | (1n << BigInt(i)), EMPTY);
}

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
function lcm(a, b) { return (a / gcd(a, b)) * b; }

function sameTimeline(a, b) {
  return Array.isArray(b) && a.length === b.length && a.every((x, i) =>
    Math.abs(x.t0 - b[i].t0) <= STRUCT_TOL
      && Math.abs(x.t1 - b[i].t1) <= STRUCT_TOL
      && Math.abs(x.u - b[i].u) <= STRUCT_TOL
      && Math.abs(x.v - b[i].v) <= STRUCT_TOL);
}
