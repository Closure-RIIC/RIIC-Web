/**
 * 评价器（对齐实施方案 §3.2 / §5）
 *  - evaluateShift / facilityUpperBound：闭式与上界，供搜索剪枝
 *  - simulateFacility：逐日推进心情到收敛，给出真实日均产出（精确口径）
 * 精确求解时用上界排序 + 模拟确认；上界在"撞 100% 上限"时只会高估，所以是安全上界。
 */

import { has, sizeOf } from './set.mjs';

export const REC_BASE = 0.12;
export const COST_BASE = 0.072;
export const HEAD = 0.40;
export const SLOTS = 3;
export const CENTER_CAP = 1 / COST_BASE;
export const EPS = 1e-9;

const val = (op, room, kind, cat) => {
  let best = 0;
  for (const s of op.skills) {
    if (s.room !== room || s.kind !== kind) continue;
    if (kind !== '减免' && cat !== undefined && s.cat !== cat) continue;
    if (s.value > best) best = s.value;
  }
  return best;
};

/** 中枢时间轴：[{t0,t1,u,v}]，段长超 13.889 h 的尾部 u = 0 */
export function buildTimeline(center) {
  const { hCenter, uA, uB } = center;
  const segs = [];
  const push = (t0, t1, u) => { if (t1 > t0 + EPS) segs.push({ t0, t1, u, v: REC_BASE * (1 + u) }); };
  const a1 = Math.min(hCenter, CENTER_CAP);
  push(0, a1, uA);
  if (hCenter > a1 + EPS) push(a1, hCenter, 0);
  const bLen = 24 - hCenter;
  const b1 = Math.min(bLen, CENTER_CAP);
  push(hCenter, hCenter + b1, uB);
  if (bLen > b1 + EPS) push(hCenter + b1, 24, 0);
  return segs;
}

export function integrate(t0, t1, segs) {
  if (t1 <= t0) return 0;
  let s = 0;
  for (const g of segs) {
    const a = Math.max(t0, g.t0);
    const b = Math.min(t1 > 24 ? 24 : t1, g.t1);
    if (b > a) s += (b - a) * g.v;
  }
  return s;
}

/** 休息窗 [t0,t1] 可以跨 24h；按段累加 */
export function integrateWrap(t0, t1, segs) {  if (t1 <= t0) return 0;
  let total = 0;
  let t = t0;
  while (t < t1 - EPS) {
    const day = Math.floor(t / 24);
    const at = t - day * 24;
    let g = segs[segs.length - 1];
    for (const x of segs) if (at >= x.t0 - EPS && at < x.t1 - EPS) { g = x; break; }
    const remain = Math.min(g.t1 - at, t1 - t);
    total += remain * g.v;
    t += remain;
  }
  return total;
}

/** 一组人在某设施下的统计量 */
export function crewStats(ops, mask, facility, n) {
  // 只遍历 mask 里的位（原来是 ops.reduce + 每人一次 BigInt 位测试，候选枚举里是热点）
  const bits = maskIds(mask);
  let r = 0;
  for (const i of bits) r += val(ops[i], facility.room, '减免');
  const kinds = Object.keys(facility.weights);
  const b = {};
  for (const c of kinds) {
    let acc = 0;
    for (const i of bits) acc += val(ops[i], facility.room, '加成', c);
    b[c] = acc;
  }
  let inner = 0;
  for (const c of kinds) inner += facility.weights[c] * (1 + b[c]);
  const size = Number.isFinite(n) ? n : SLOTS;
  return { r, b, n: size, unit: (1 + HEAD * size) * inner, d: COST_BASE * (1 - r) };
}

/**
 * 一个班次的闭式评价。

 * 返回的 work 在稳定时是 min(len,1/d)，不稳定时是 min(len,1/d,W*)。
 */
export function evaluateShift({ st, len, restStart, restEnd, timeline, assistMood = 0 }) {
  const d = st.d;
  const C = Math.min(1, d * len);
  const R = integrateWrap(restStart, restEnd, timeline);
  const Reff = R + assistMood;                          // 助力的"日均注入"只用于上界排序
  const stable = Reff >= C - EPS;
  const cap = d > EPS ? 1 / d : Infinity;
  let work;
  let Wstar = Infinity;
  if (stable) work = Math.min(len, cap);
  else {
    const vbar = Reff / Math.max(EPS, restEnd - restStart);
    Wstar = d + vbar > EPS ? (24 * vbar) / (d + vbar) : 0;
    work = Math.min(len, cap, Wstar);
  }
  return { C, R, stable, work, Wstar, cap, d, len };
}

/**
 * 两班方案的上界（闭式）：Cum[u] = ∫₀ᵘ v dt 的累计表，长度 25。
 * A 班休息窗 [h,24] ⇒ R = Cum[24] − Cum[h]；B 班休息窗 [0,h]（跨到次日）⇒ R = Cum[h]。
 */
export function recoveryTable(timeline) {
  const cum = new Float64Array(25);
  for (let u = 1; u <= 24; u += 1) {
    let s = 0;
    for (const g of timeline) {
      const a = Math.max(0, g.t0);
      const b = Math.min(u, g.t1);
      if (b > a) s += (b - a) * g.v;
    }
    cum[u] = s;
  }
  return cum;
}

/**
 * 给定休息窗恢复量 R 的单班评价（闭式，与 evaluateShift 等价但省掉积分）。
 * 稳定 ⇒ 日产出 = E·min(len, 1/d)；不稳定 ⇒ 取长期值 E·min(len, 1/d, W*)
 * （不撞 100% 上限时就是精确值，撞顶时只高估 ⇒ 可当安全上界用）。
 */
export function shiftFromRecovery({ st, len, R }) {
  const d = st.d;
  const C = Math.min(1, d * len);
  const stable = R >= C - EPS;
  const cap = d > EPS ? 1 / d : Infinity;
  let work;
  let Wstar = Infinity;
  if (stable) work = Math.min(len, cap);
  else {
    const restH = Math.max(EPS, 24 - len);
    const vbar = R / restH;
    Wstar = d + vbar > EPS ? (24 * vbar) / (d + vbar) : 0;
    work = Math.min(len, cap, Wstar);
  }
  return { C, R, stable, work, Wstar, cap, d, len };
}

/** 单班闭式（§5.2）：周期 = 1/d + t满 */
export function singleShiftUpperBound({ facility, ops, plan, timeline }) {
  const st = crewStats(ops, plan.crewA, facility, plan.nA);
  if (st.d <= EPS) return { Y: 0, st, T: Infinity, tFull: Infinity, cycle: Infinity };
  const T = 1 / st.d;
  const tFull = timeToRecoverWrap(1, T, timeline);
  const cycle = T + tFull;
  return { Y: Number.isFinite(cycle) && cycle > 0 ? st.unit * T * 24 / cycle : 0, st, T, tFull, cycle };
}

/** 从 t0 起（可跨天循环）回满 C 需要多少小时 */
export function timeToRecoverWrap(C, t0, timeline, horizon = 24) {
  let need = C;
  let t = 0;
  while (t < horizon - EPS && need > EPS) {
    const at = ((t0 + t) % 24 + 24) % 24;
    let g = timeline[timeline.length - 1];
    for (const x of timeline) if (at >= x.t0 - EPS && at < x.t1 - EPS) { g = x; break; }
    const remain = Math.min(g.t1 - at, horizon - t);
    const can = remain * g.v;
    if (need <= can + EPS) return t + need / g.v;
    need -= can;
    t += remain;
  }
  return Infinity;
}

/**
 * 逐日推进心情到收敛（精确口径）。
 * plan: { h, crewA, crewB, nA, nB, mode }
 *
 * 收敛判据（两级）：
 *  ① 精确循环：烧入期后心情向量完全复现 ⇒ 取该循环的日均（最快、最精确）；
 *  ② 漂移判据：烧入后把统计窗对半分，两半均值相对差 ≤ limits.driftTol ⇒ 认定到达稳态，
 *     取整窗均值。两条都不满足则 converged = false，调用方不得把它当作精确值。
 */
export function simulateFacility({ facility, ops, plan, timeline, limits, fillA = 0, fillB = 0, assistPlan = null }) {
  const { h } = plan;
  const fullA = plan.crewA | (plan.fillCrewA || 0n);
  const fullB = plan.crewB | (plan.fillCrewB || 0n);
  const ids = [...new Set([...maskIds(fullA), ...maskIds(fullB)])];
  const stA = crewStats(ops, plan.crewA, facility, plan.nA);
  const stB = crewStats(ops, plan.crewB, facility, plan.nB);
  const k = ids.length;

  // ── 预计算：每人每类加成、A/B 归属、心情槽位（原来每天用 Map + BigInt 位测试，是主要开销）──
  const kinds = Object.keys(facility.weights);
  const nKind = kinds.length;
  const bonus = kinds.map(() => new Float64Array(k));
  for (let s = 0; s < k; s += 1) {
    const op = ops[ids[s]];
    for (let j = 0; j < nKind; j += 1) bonus[j][s] = val(op, facility.room, '加成', kinds[j]);
  }
  const isA = new Uint8Array(k);
  const isB = new Uint8Array(k);
  for (let s = 0; s < k; s += 1) {
    const i = ids[s];
    isA[s] = has(fullA, i) ? 1 : 0;
    isB[s] = has(fullB, i) ? 1 : 0;
  }
  const moodArr = new Float64Array(k).fill(1);
  const leaveA = new Float64Array(k);
  const leaveB = new Float64Array(k);
  const usableA = new Float64Array(k);
  const usableB = new Float64Array(k);
  const present = new Uint8Array(k);
  const timesA = new Float64Array(k);
  const timesB = new Float64Array(k);
  const dayKind = new Float64Array(nKind);

  const maxDays = limits.maxSimDays;
  const daily = new Float64Array(maxDays);
  const dailyKind = new Float64Array(maxDays * nKind);
  const conv = new Map();
  const cycle = assistPlan ? assistPlan.cycle : null;
  const assistA = !!assistPlan && assistPlan.shift === 'A';
  const assistB = !!assistPlan && assistPlan.shift === 'B';
  // 助力目标按周期日预展开成"每槽位是否受助"，省掉每天 3 次 Set.has；
  // 心情字符串（循环判据）用 per-sim 记忆化，稳态下取值重复率很高。
  const cycleDays = cycle ? cycle.length : 0;
  const isTarget = cycle ? cycle.map((dayList) => {
    const flags = new Uint8Array(k);
    for (let s = 0; s < k; s += 1) if (dayList.includes(ids[s])) flags[s] = 1;
    return flags;
  }) : null;
  const fmtCache = new Map();
  let targets = null;
  let lastInjections = [];
  const dA = stA.d;
  const dB = stB.d;
  const lenA = h;
  const lenB = 24 - h;
  const hasAssist = assistA || assistB;

  for (let day = 0; day < maxDays; day += 1) {
    targets = cycle ? isTarget[day % cycleDays] : null;
    const dayInjections = hasAssist ? [] : null;

    // ── A 班 [0, h)：先算各自离岗时刻，再按"谁先红脸离岗"分段积分 ──
    let cntA = 0;
    for (let s = 0; s < k; s += 1) {
      if (!isA[s]) continue;
      const i = ids[s];
      const eligible = assistA && targets !== null && targets[s] === 1;
      const hit = assistBudget(moodArr[s], dA, lenA, eligible);
      if (hit.at != null) {
        if (dayInjections) dayInjections.push({ index: i, shift: 'A', hour: hit.at, mood: Math.min(moodArr[s], 0.70) });
      }
      const usable = hit.budget;
      usableA[s] = usable;
      const cap = dA > EPS ? usable / dA : Infinity;
      leaveA[s] = Math.min(lenA, cap);
      timesA[cntA] = leaveA[s];
      cntA += 1;
    }
    // 插入排序（k ≤ 3，够用且不分配）
    for (let x = 1; x < cntA; x += 1) {
      const v = timesA[x];
      let y = x - 1;
      while (y >= 0 && timesA[y] > v) { timesA[y + 1] = timesA[y]; y -= 1; }
      timesA[y + 1] = v;
    }
    for (let j = 0; j < nKind; j += 1) dayKind[j] = 0;
    {
      let prev = 0;
      let n = 0;
      for (let s = 0; s < k; s += 1) if (isA[s]) { present[s] = 1; n += 1; }
      let ti = 0;
      while (ti < cntA) {
        const t = timesA[ti];
        if (t > prev + EPS) {
          const hours = t - prev;
          for (let j = 0; j < nKind; j += 1) {
            let b = 0;
            for (let s = 0; s < k; s += 1) if (present[s]) b += bonus[j][s];
            dayKind[j] += hours * (n === 0 ? 0 : (1 + HEAD * n) * facility.weights[kinds[j]] * (1 + b));
          }
          prev = t;
        }
        for (let s = 0; s < k; s += 1) if (present[s] && leaveA[s] <= t + EPS) { present[s] = 0; n -= 1; }
        ti += 1;
      }
      if (lenA > prev + EPS) {
        const hours = lenA - prev;
        for (let j = 0; j < nKind; j += 1) {
          let b = 0;
          for (let s = 0; s < k; s += 1) if (present[s]) b += bonus[j][s];
          dayKind[j] += hours * (n === 0 ? 0 : (1 + HEAD * n) * facility.weights[kinds[j]] * (1 + b));
        }
      }
    }

    // ── B 班 [h, 24) ──
    let cntB = 0;
    for (let s = 0; s < k; s += 1) {
      if (!isB[s]) continue;
      const i = ids[s];
      const eligible = assistB && targets !== null && targets[s] === 1;
      const hit = assistBudget(moodArr[s], dB, lenB, eligible);
      if (hit.at != null) {
        if (dayInjections) dayInjections.push({ index: i, shift: 'B', hour: h + hit.at, mood: Math.min(moodArr[s], 0.70) });
      }
      const usable = hit.budget;
      usableB[s] = usable;
      const cap = dB > EPS ? usable / dB : Infinity;
      leaveB[s] = h + Math.min(lenB, cap);
      timesB[cntB] = leaveB[s];
      cntB += 1;
    }
    for (let x = 1; x < cntB; x += 1) {
      const v = timesB[x];
      let y = x - 1;
      while (y >= 0 && timesB[y] > v) { timesB[y + 1] = timesB[y]; y -= 1; }
      timesB[y + 1] = v;
    }
    {
      let prev = h;
      let n = 0;
      for (let s = 0; s < k; s += 1) if (isB[s]) { present[s] = 1; n += 1; }
      let ti = 0;
      while (ti < cntB) {
        const t = timesB[ti];
        if (t > prev + EPS) {
          const hours = t - prev;
          for (let j = 0; j < nKind; j += 1) {
            let b = 0;
            for (let s = 0; s < k; s += 1) if (present[s]) b += bonus[j][s];
            dayKind[j] += hours * (n === 0 ? 0 : (1 + HEAD * n) * facility.weights[kinds[j]] * (1 + b));
          }
          prev = t;
        }
        for (let s = 0; s < k; s += 1) if (present[s] && leaveB[s] <= t + EPS) { present[s] = 0; n -= 1; }
        ti += 1;
      }
      if (24 > prev + EPS) {
        const hours = 24 - prev;
        for (let j = 0; j < nKind; j += 1) {
          let b = 0;
          for (let s = 0; s < k; s += 1) if (present[s]) b += bonus[j][s];
          dayKind[j] += hours * (n === 0 ? 0 : (1 + HEAD * n) * facility.weights[kinds[j]] * (1 + b));
        }
      }
    }

    // ── 恢复与下一天心情 ──
    for (let s = 0; s < k; s += 1) {
      const i = ids[s];
      let recover = 0;
      if (isA[s]) recover += integrateWrap(leaveA[s], 24, timeline);
      if (isB[s]) {
        const leave = leaveB[s];
        recover += integrateWrap(leave, 24, timeline) + integrateWrap(24, 24 + h, timeline);
      }
      const base = isA[s] ? usableA[s] : usableB[s];
      const consumed = (isA[s] ? dA * leaveA[s] : 0) + (isB[s] ? dB * (leaveB[s] - h) : 0);
      const next = Math.max(0, Math.min(1, base - consumed + recover));
      moodArr[s] = next;
    }

    let y = 0;
    for (let j = 0; j < nKind; j += 1) {
      dailyKind[day * nKind + j] = dayKind[j];
      y += dayKind[j];
    }
    daily[day] = y;
    if (dayInjections) lastInjections = dayInjections;
    // ── 收敛判据 ①：心情状态精确复现 ⇒ 取该循环的均值 ──
    // 状态复现就是**真循环**（同一心情向量 + 同一排班/助力相位 ⇒ 未来逐日相同），
    // 所以在任何一天探测到都精确，不需要等烧入期。`DSH_SIM_BURNIN=1` 可切回旧行为做对照。
    const detectFrom = process.env.DSH_SIM_BURNIN ? limits.burnInDays : 0;
    if (day >= detectFrom) {
      // 助力有周期时，相位也是状态的一部分：同心情但相位不同 ⇒ 未来不同，不能算复现。
      let key = cycleDays ? `#${day % cycleDays}` : '';
      for (let s = 0; s < k; s += 1) {
        const mv = moodArr[s];
        let part = fmtCache.get(mv);
        if (part === undefined) { part = mv.toFixed(9); fmtCache.set(mv, part); }
        key += (s ? ',' : '') + part;
      }
      if (conv.has(key)) {
        const start = conv.get(key);
        const cycleLen = day - start;
        let sum = 0;
        for (let d = start; d < day; d += 1) sum += daily[d];
        const avg = sum / cycleLen;
        const avgByKind = {};
        for (let j = 0; j < nKind; j += 1) {
          let acc = 0;
          for (let d = start; d < day; d += 1) acc += dailyKind[d * nKind + j];
          avgByKind[kinds[j]] = acc / cycleLen;
        }
        const endMood = {};
        for (let s = 0; s < k; s += 1) endMood[ids[s]] = moodArr[s];
        return {
          avg, avgByKind, converged: true, days: day, cycleLen, daily: Array.from(daily.subarray(0, day)),
          endMood, lastInjections, dayIndex: day,
        };
      }
      conv.set(key, day);
    }
    if (conv.size > limits.cycleDetectDays * 2) {
      const firstKey = conv.keys().next().value;
      conv.delete(firstKey);
    }
  }
  // 二级判据：没有精确循环时，用统计窗对半的漂移量判断是否到达稳态
  const windowStart = Math.min(limits.burnInDays, Math.max(0, maxDays - 1));
  const windowDays = maxDays - windowStart;
  const half = Math.floor(windowDays / 2);
  let sumAll = 0;
  let sumFirst = 0;
  let sumSecond = 0;
  for (let d = windowStart; d < maxDays; d += 1) {
    const v = daily[d];
    sumAll += v;
    if (d - windowStart < half) sumFirst += v; else sumSecond += v;
  }
  const mean = windowDays ? sumAll / windowDays : NaN;
  const drift = windowDays >= 2 ? Math.abs(sumFirst / half - sumSecond / (windowDays - half)) : Infinity;
  const driftTol = limits.driftTol ?? 1e-4;
  const converged = Number.isFinite(mean) && drift <= driftTol * Math.max(1, Math.abs(mean));
  const avgByKind = {};
  for (let j = 0; j < nKind; j += 1) {
    let acc = 0;
    for (let d = windowStart; d < maxDays; d += 1) acc += dailyKind[d * nKind + j];
    avgByKind[kinds[j]] = acc / Math.max(1, windowDays);
  }
  const endMood = {};
  for (let s = 0; s < k; s += 1) endMood[ids[s]] = moodArr[s];
  return {
    avg: mean,
    avgByKind,
    converged, days: maxDays, cycleLen: 0, drift,
    windowStart, windowDays, daily: Array.from(daily.subarray(0, maxDays)), endMood,
    lastInjections, dayIndex: maxDays - 1,
  };
}

function moodSnapshot(ids, mood) {
  const out = {};
  for (const i of ids) out[i] = mood.get(i);
  return out;
}

function addKindTotals(target, part) {
  for (const [kind, value] of Object.entries(part)) target[kind] = (target[kind] || 0) + value;
}

function meanKinds(days) {
  const sums = {};
  for (const day of days) addKindTotals(sums, day);
  const divisor = Math.max(1, days.length);
  for (const kind of Object.keys(sums)) sums[kind] /= divisor;
  return sums;
}

/** Single-shift long-run value under the documented cycle formula. */
export function simulateSingleFacility({ facility, ops, plan, timeline, limits }) {
  const fullA = plan.crewA | (plan.fillCrewA || 0n);
  const crew = new Set(maskIds(fullA));
  const stats = crewStats(ops, plan.crewA, facility, plan.nA);
  const rates = ratesOf(crew, facility, ops);
  if (stats.d <= EPS) return { avg: 0, avgByKind: {}, converged: false, cycles: 0 };
  const workHours = 1 / stats.d;
  const restHours = timeToRecoverWrap(1, workHours, timeline, 24);
  if (!Number.isFinite(restHours)) return { avg: 0, avgByKind: {}, converged: false, cycles: 1 };
  const factor = (workHours * 24) / (workHours + restHours);
  const avgByKind = Object.fromEntries(Object.entries(rates).map(([kind, rate]) => [kind, rate * factor]));
  return {
    avg: Object.values(avgByKind).reduce((sum, value) => sum + value, 0),
    avgByKind, converged: true, workHours, restHours, cycleHours: workHours + restHours,
    cycles: limits.maxSimDays || 0, cycleLen: 1,
  };
}

/**
 * 一个助力点 = 给目标干员 +30% 心情（文档：会客室 §8.1）。
 *
 * 文档 §8.4 的口径：**注入时刻取"目标心情降到 70%"那一刻**，于是 +30% 恰好补到 100%，
 * 不会因为撞 100% 上限而作废（"注入时刻只要目标心情 ≤70% 即可，早用晚用等价"）。
 * 因此这里返回的是"本班次可用心情总量"，而不是"开工时的心情"：
 *   可用总量 = 开工心情 + 0.30          （不封顶）
 * 逐日模拟里的 next = 可用总量 − d×实际在岗 + 休息窗恢复，封顶由下一步统一处理。
 *
 * 注入可行性：目标必须在班内某个时刻确实降到 ≤70%，否则这天注不进去：
 *   - 开工心情 ≤ 70% ⇒ 开工即注；
 *   - 开工心情 > 70% ⇒ 需 (心情 − 70%)/d ≤ 班长，才能在班内降到 70%。
 * 旧实现是"开工时 +30% 并封顶 100%"，会在稳态把助力全部作废（实测 21/3 三天轮转只有 94.13），
 * 与文档 §8.4 的 96.36 不符，已按文档改正。
 */
function assistBudget(mood, d, len, isTarget) {
  if (!isTarget || d <= EPS) return { budget: mood, at: null };
  const canReach70 = mood <= 0.70 + EPS || (mood - 0.70) / d <= len - EPS;
  if (!canReach70) return { budget: mood, at: null };
  const at = mood <= 0.70 + EPS ? 0 : (mood - 0.70) / d;
  return { budget: mood + ASSIST_MOOD, at };
}

export const ASSIST_MOOD = 0.30;

function maskIds(mask) {
  const out = [];
  let i = 0;
  let x = mask;
  while (x) { if (x & 1n) out.push(i); x >>= 1n; i += 1; }
  return out;
}

/**
 * 一个班次内，按"谁先红脸离岗"分段积分：
 * 在岗人数与加成随离岗变化，所以倍率是分段的。
 */
function shiftIntegral({ ids, leave, t0, t1, facility, ops }) {
  if (!ids.length) return {};
  const times = [...new Set(ids.map((i) => Math.min(t1, leave.get(i))))].sort((a, b) => a - b);
  const byKind = {};
  let prev = t0;
  let present = new Set(ids);
  for (const t of times) {
    if (t > prev + EPS) {
      addRates(byKind, ratesOf(present, facility, ops), t - prev);
      prev = t;
    }
    for (const i of ids) if (leave.get(i) <= t + EPS) present.delete(i);
  }
  if (t1 > prev + EPS) addRates(byKind, ratesOf(present, facility, ops), t1 - prev);
  return byKind;
}

function ratesOf(present, facility, ops) {
  const n = present.size;
  const rates = {};
  for (const c of Object.keys(facility.weights)) {
    let b = 0;
    for (const i of present) b += val(ops[i], facility.room, '加成', c);
    rates[c] = n === 0 ? 0 : (1 + HEAD * n) * facility.weights[c] * (1 + b);
  }
  return rates;
}

function addRates(target, rates, hours) {
  for (const [kind, rate] of Object.entries(rates)) target[kind] = (target[kind] || 0) + hours * rate;
}

export { val };
