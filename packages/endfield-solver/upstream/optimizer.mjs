/**
 * 全局搜索（外层层枚举中枢、内层按类别记忆化 DFS；规格见 documents/计算逻辑/ 与 tools/README.md §5）
 * =====================================================================
 *   外层  enumerateCenters(ops, cfg)                —— 枚举时间轴（保留 (uA,uB) 等价归并 + 支配剪枝）
 *   内层  dfs(catIdx, usedMask, assistLeft)         —— 按类别的自顶向下记忆化 DFS
 *
 * 关键性质：
 *  1. 类别内同类多设施**联合分配**（不逐舱贪心）：对"占用集 ⊆ U 的最优值"做 subset-max (SOS) 变换，
 *     再对 U 求 best(舱1, U) + best(舱2, R∖U)，精确保持"两个占用集不相交"。
 *  2. 只保留「达到本类别最大值、且占用集不同」的分支（容差 limits.valueTol）。
 *  3. 稳定方案走闭式（O(1) 精确）；衰减方案按闭式/上界降序逐日模拟，上界 < 已知最优即安全停。
 *  4. 只有 DFS 完整跑完、且没有「上界够高但模拟不收敛 / 用了近似」时，才把 searchComplete 判为 true。
 */

import {
  EMPTY, has, intersects, sizeOf, toIndices, union, without,
} from './set.mjs';
import {
  SLOTS, COST_BASE, EPS, ASSIST_MOOD, val, buildTimeline, integrate, recoveryTable,
  shiftFromRecovery, simulateFacility, simulateSingleFacility, timeToRecoverWrap,
} from './evaluator.mjs';
import { isUseful, relevantMask, crewSignatureGroups } from './candidates.mjs';
import { comparePlans } from './comparator.mjs';

function maskAll(n) {
  let m = EMPTY;
  for (let i = 0; i < n; i += 1) m |= 1n << BigInt(i);
  return m;
}

/** 补位变体的上限（决策 53，按实测修订为 4）：双舱最坏 4×4 = 16 条分支。
 *  实测（`tools/test/prep-cap.mjs`，S4 必须与参考一致 42.5866）：
 *    预算 8 → S4 ✔ / S8 11215 节点；4 → S4 ✔ / S8 7237；3 → S4 ✔ / S8 5152；2 → S4 ✘ 40.6266；1 → ✘
 *  故取 4：比实测下限 3 留一档余量，同时比 8 少约 40% 的节点。
 *  `DSH_VARIANT_BUDGET` 只用于测量，不设定时取默认值。 */
const VARIANT_BUDGET = Number(process.env.DSH_VARIANT_BUDGET || 4);

/**
 * 值前缀剪枝（P5，决策 61）：产出向量是字典序比较，下游类别只能**追加**，
 * 所以"本深度的前缀已严格劣于现任"⇒ 任何补全都赢不了，整棵子树可以剪。
 *
 * 两道限制（都是实测逼出来的）：
 *   · **只剪浅层**：剪枝要求"被剪结果不写 memo"，深剪会把 memo 的收益抹掉
 *     （实测不限深度：聚合叶子 +31%、memo 命中 −34%）；`PRUNE_DEPTH = 2` 时只有 −6.5% 叶子。
 *   · **`DSH_PRUNE_DEPTH=-1` 关闭**，用于 A/B 对照与回退。
 */
const PRUNE_DEPTH = process.env.DSH_PRUNE_DEPTH === undefined
  ? 2 : Number(process.env.DSH_PRUNE_DEPTH);
const PRUNED = Symbol('pruned');

/** 前缀是否**严格**劣于现任（打平不剪：后缀未知，ADR 0002 的两级裁决还没走到人数） */
function prefixStrictlyWorse(prefix, incScore, tol) {
  if (!incScore) return false;
  const len = Math.min(prefix.length, incScore.length);
  for (let i = 0; i < len; i += 1) {
    if (Math.abs(prefix[i] - incScore[i]) <= tol) continue;
    return prefix[i] < incScore[i];
  }
  return false;
}

/**
 * 闭式值缓存（P2，决策 47）：**只在内存、进程退出即丢**，不落盘、不跨运行。
 *
 * 键 = 中枢时间轴指纹 + 签名对指纹；签名 `(unit, d, n)` 是取值函数的**全部入参**，
 * 所以命中后返回的数组与原算逐位相同（不是近似）。
 *
 * 为了不把"造键"的成本吃进收益，签名先**登记成整数 ID**（每个签名对象只付一次字符串成本），
 * 再用数字键查表。
 */
const SIG_ID = new Map();              // 签名指纹字符串 → 小整数
let SIG_NEXT = 1;
function sigIdOf(st) {
  if (st.sid !== undefined) return st.sid;
  const k = st.unit + '|' + st.d + '|' + st.n;
  let id = SIG_ID.get(k);
  if (id === undefined) { id = SIG_NEXT; SIG_NEXT += 1; SIG_ID.set(k, id); }
  st.sid = id;
  return id;
}

const SIG_HOUR_CACHE = new Map();      // centerKey → Map<number, 23 项数组>
const SIG_RETAINED_CACHE = new Map();  // centerKey → Map<number, 保留集数组>
const SIG_CACHE_CAP = 2000;            // 上限只针对"中枢份数"；清空纯缓存永远安全
const PAIR_STRIDE = 1 << 20;           // idA * STRIDE + idB

/** 仅供测试/计时：清空跨调用共享缓存，让下一次求解等价于"冷启动"。 */
export function resetCaches() {
  SIG_HOUR_CACHE.clear();
  SIG_RETAINED_CACHE.clear();
  SIG_ID.clear();
  SIG_NEXT = 1;
}

const centerFingerprint = (center) => `${center.hCenter}|${center.uA}|${center.uB}`;

function pairMap(root, centerKey) {
  let m = root.get(centerKey);
  if (!m) {
    if (root.size > SIG_CACHE_CAP) root.clear();
    m = new Map();
    root.set(centerKey, m);
  }
  return m;
}

const charIdOf = (op) => op.charId || op.name;

// ───────────────────────── 中枢枚举 ─────────────────────────
export let PURE_USEFUL = new Set();

export function enumerateCenters(ops, cfg) {
  const centerSeats = cfg.centerSlots || SLOTS;
  const recIdx = [];
  ops.forEach((op, i) => { if (val(op, '中枢', '恢复') > 0) recIdx.push(i); });
  const groups = [[]];
  const rec = (start, cur, depth) => {
    if (depth === centerSeats) return;
    for (let j = start; j < recIdx.length; j++) {
      const next = cur.concat(recIdx[j]);
      groups.push(next);
      rec(j + 1, next, depth + 1);
    }
  };
  rec(0, [], 0);

  const infos = groups.map((g) => {
    let mask = EMPTY;
    for (const i of g) mask |= 1n << BigInt(i);
    const u = g.reduce((s, i) => s + val(ops[i], '中枢', '恢复'), 0);
    return { idx: g, mask, u };
  });
  // skillValueOf 与 u 的四位小数字符串都预计算：下面那个 a×b 双循环是 20 万级的
  const skillValueCache = ops.map((op) => skillValueOf(op));
  for (const info of infos) {
    info.uKey = info.u.toFixed(4);
    info.cost = info.idx.reduce((s, i) => s + skillValueCache[i], 0);
  }

  const allMask = maskAll(ops.length);
  const allRecovery = recIdx.reduce((m, i) => m | (1n << BigInt(i)), EMPTY);
  // 补位池是常量：原来在双循环里每次都重建 + 排序（排序比较器还要调 skillValueOf）
  const spareBase = orderedFillers(without(allMask, allRecovery));
  const spareSorted = spareBase.slice().sort((x, y) => skillValueCache[x] - skillValueCache[y]);
  // 同一 (uA,uB) 只保留一组：中枢对设施的唯一作用就是 u(t)；保留"占用这些人机会成本最低"的一组
  // （记录在 README §5.1 A1 的性能优化，别回退）。
  const byU = new Map();
  for (const a of infos) for (const b of infos) {
    if (intersects(a.mask, b.mask)) continue;
    const skilled = union(a.mask, b.mask);
    const needed = (centerSeats - a.idx.length) + (centerSeats - b.idx.length);
    if (spareSorted.length < needed) continue;
    const spare = spareSorted;
    const key = `${a.uKey}|${b.uKey}`;
    const cost = a.cost + b.cost;
    const prev = byU.get(key);
    if (prev && prev.cost <= cost + EPS) continue;
    const fillA = spare.slice(0, centerSeats - a.idx.length);
    const fillB = spare.slice(centerSeats - a.idx.length, needed);
    let used = skilled;
    for (const i of [...fillA, ...fillB]) used |= 1n << BigInt(i);
    byU.set(key, {
      uA: a.u, uB: b.u,
      idxA: [...a.idx, ...fillA].sort((x, y) => x - y),
      idxB: [...b.idx, ...fillB].sort((x, y) => x - y),
      fillA, fillB, used, cost,
    });
  }
  let cands = [...byU.values()];
  cands = cands.filter((c) => !cands.some((o) => o !== c
    && sizeOf(o.used) <= sizeOf(c.used)
    && o.uA >= c.uA - EPS && o.uB >= c.uB - EPS
    && (sizeOf(o.used) < sizeOf(c.used) || o.uA > c.uA + EPS || o.uB > c.uB + EPS)));

  const out = [];
  for (const c of cands) {
    for (let hc = 1; hc <= 23; hc += 1) {
      const timeline = buildTimeline({ hCenter: hc, uA: c.uA, uB: c.uB });
      const cA = Math.min(1, COST_BASE * hc);
      const cB = Math.min(1, COST_BASE * (24 - hc));
      const rA = integrateAll(hc, 24, timeline);
      const rB = integrateAll(0, hc, timeline);
      // 中枢自己也是一个班次，两段都要满足 R ≥ C（主逻辑 §6.6）
      if (rA < cA - EPS || rB < cB - EPS) continue;
      out.push({ ...c, hCenter: hc, timeline, cA, cB, rA, rB });
    }
  }
  return out;
}

/** 该干员在非中枢舱的最高技能价值，用于中枢补位的机会成本排序（§6.8） */
function skillValueOf(op) {
  let best = 0;
  for (const room of ['制造舱', '培养舱', '会客室']) {
    for (const cat of ['干员经验', '武器经验', '晶植', '菌类', '矿物', '线索']) {
      const v = val(op, room, '加成', cat);
      if (v > best) best = v;
    }
    const r = val(op, room, '减免');
    if (r * 0.8 > best) best = r * 0.8;
  }
  return best;
}

function integrateAll(t0, t1, timeline) {
  let s = 0;
  for (const g of timeline) {
    const a = Math.max(t0, g.t0);
    const b = Math.min(t1, g.t1);
    if (b > a) s += (b - a) * g.v;
  }
  return s;
}

function orderedFillers(mask) {
  const ids = toIndices(mask);
  return [...ids.filter((i) => !PURE_USEFUL.has(i)), ...ids.filter((i) => PURE_USEFUL.has(i))];
}

// ───────────────────────── 设施规格 ─────────────────────────
function catOf(spec) {
  return spec.isGrow ? '培养' : spec.cat;
}

export function facilitySpecs(cfg) {
  const specs = [];
  if (cfg.hasGuest) {
    specs.push({ key: '会客室', room: '会客室', weights: { 线索: 1 }, cat: '线索', slots: cfg.levels.guestSlots });
  }
  cfg.manufacturing.forEach((cat, i) => specs.push({
    key: `制造舱${i + 1}`, room: '制造舱', weights: { [cat]: 1 }, cat, slots: cfg.levels.manufacturingSlots[i],
  }));
  if (cfg.hasGrow) {
    const pots = {};
    for (const k of Object.keys(cfg.grow)) if (cfg.grow[k] > 0) pots[k] = cfg.grow[k];
    specs.push({ key: '培养舱', room: '培养舱', weights: pots, isGrow: true, cat: '培养', slots: cfg.levels.growSlots });
  }
  return specs;
}

// ───────────────────────── 预算 ─────────────────────────
function makeBudget(cfg) {
  const nodes = cfg.budget && Number.isFinite(cfg.budget.nodes) ? cfg.budget.nodes : 2_000_000;
  const ms = cfg.budget && Number.isFinite(cfg.budget.ms) ? cfg.budget.ms : 30_000;
  const t0 = Date.now();
  const b = {
    nodes: 0, limit: nodes, msLimit: ms, elapsed: 0,
    nodeExhausted: false, timeExhausted: false, unresolved: 0,
    tick(n = 1) {
      b.nodes += n;
      if (b.nodes > b.limit) { b.nodeExhausted = true; return false; }
      if ((b.nodes & 0x1ff) === 0) {
        b.elapsed = Date.now() - t0;
        if (b.elapsed > b.msLimit) { b.timeExhausted = true; return false; }
      }
      return true;
    },
    get exhausted() { return b.nodeExhausted || b.timeExhausted; },
  };
  return b;
}

// ───────────────────────── 单设施候选表 ─────────────────────────
/**
 * 班组签名组：签名 = (加成向量, 减免, 满工位人数)；同签名保留全部具体人选 mask。
 * 同时给出"签名对 × 班长"的闭式取值表。
 */
function buildFacilityTable(ctx, spec, avail) {
  const seats = Math.min(spec.slots || SLOTS, SLOTS);
  const rel = relevantMask(ctx.ops, spec, avail);
  // 班组人数 1..工位数（决策 18）：减少人数**是候选空间的一部分**，不由"满工位是否排得出来"开关。
  // 唯一的例外是**可证支配**（决策 19）：本类别的可用干员 ≥ 满工位需要的人数（Σ 2×工位数，两班各一班底）
  // 时，任何 n<工位数 的候选都能靠"往空工位塞一个尚未被用到的白板"严格变好（E=(1+0.4n)(1+b) 随 n 严格增，
  // 心情只按设施算 d，不受人数影响），所以这些候选被支配、可以合法剪掉；
  // 人手不足时自动展开 1..工位数（差分族 D/D2/D3 双向护栏：缺人时逐位对齐，富余时也必须对齐）。
  const sizes = ctx.reducedSizes ? Array.from({ length: seats }, (_, k) => k + 1) : [seats];
  const dbg = !!process.env.DEBUG_CAT;
  if (dbg) {
    console.error(`  [table ${spec.key}] seats=${seats} sizes=${sizes.join('/')} avail=${sizeOf(avail)} rel=${sizeOf(rel)} `
      + `relList=${toIndices(rel).map((i) => ctx.ops[i].name).join(',')}`);
  }
  // 注意：rel 为空**不能**返回 null —— 没有相关干员时仍然可以用白板把工位填满，
  // 产出是"纯人数项"。早期的 if (!sizeOf(rel)) return null 会让整个类别被记 0（差分发现的真实漏解）。
  const groups = crewSignatureGroups(ctx.ops, spec, rel, seats, sizes);
  if (!groups.length) return null;
  const fillPool = toIndices(without(avail, rel));
  if (dbg) console.error(`  [table ${spec.key}] groups=${groups.length} fillPool=${fillPool.length}`);

  // 相关干员的"局部位"（0..2^|rel|-1）：舱内互斥判断用它做整数与，比 BigInt 快一个量级
  const relBits = toIndices(rel);
  const localOfMask = (mask) => {
    let idx = 0;
    for (let p = 0; p < relBits.length; p += 1) if (has(mask, relBits[p])) idx |= 1 << p;
    return idx;
  };
  const subList = [];
  const cidCache = new Map();
  const cidOfMask = (mask) => {
    let s = cidCache.get(mask);
    if (s === undefined) { s = toIndices(mask).map((i) => charIdOf(ctx.ops[i])).sort().join(","); cidCache.set(mask, s); }
    return s;
  };
  groups.forEach((g, si) => {
    for (const m of g.masks) {
      // idx / size / cid 都预计算：同类双舱一次调用要造 5 万个实例，
      // 每个实例再算一遍 charId 串和 BigInt 字符串键是主要开销。
      subList.push({
        mask: m, si, st: g.st, n: g.n,
        local: localOfMask(m),
        size: sizeOf(m),
        idx: subList.length,
        cid: cidOfMask(m),
      });
    }
  });

  const G = groups.length;
  const hoursArr = new Array(G * G);
  const cum = ctx.cum;
  const cumMax = cum[24];

  const hoursAll = new Array(G * G);
  /** 该签名对全部 23 个 h 的闭式/上界（缓存；值驱动展开与打分共用） */
  const hoursAllOf = (i, j) => {
    const key = i * G + j;
    if (hoursAll[key]) { ctx.counters.closedFormHits += 1; return hoursAll[key]; }
    ctx.counters.closedFormEvals += 1;   // 观测：一次 = 23 个 h 的闭式/上界计算
    const stA = groups[i].st;
    const stB = groups[j].st;
    // 跨状态/跨中枢/跨两遍求解的共享缓存（键 = 取值函数的全部入参）
    const hourMap = pairMap(SIG_HOUR_CACHE, ctx.centerKey);
    const sharedKey = sigIdOf(stA) * PAIR_STRIDE + sigIdOf(stB);
    const shared = hourMap.get(sharedKey);
    if (shared) {
      hoursAll[key] = shared;
      ctx.counters.sigHourHits += 1;
      return shared;
    }
    ctx.counters.sigHourEvals += 1;
    const list = [];
    for (let h = 1; h <= 23; h += 1) {
      const eA = shiftFromRecovery({ st: stA, len: h, R: cumMax - cum[h] });
      const eB = shiftFromRecovery({ st: stB, len: 24 - h, R: cum[h] });
      const cf = eA.work * stA.unit + eB.work * stB.unit;
      // full：不考虑心情上限截断（= 全员天天满时长）——衰减方案的安全上界
      const full = Math.min(h, eA.cap) * stA.unit + Math.min(24 - h, eB.cap) * stB.unit;
      // 助力上界：a 点/天全部投给同一班时，每人的日均回复最多再加 0.30·a/n，
      // 因此最弱的那位能撑住的时长 ≤ (R + 0.30·a/n)/d，全天产出受他限制（会客室文档 §8.4）
      const assistBound = (a) => {
        if (!a) return cf;
        // 注入量按**该班实际人数**摊（人数可以小于工位数，见决策 18）
        const injA = (ASSIST_MOOD * a) / Math.max(1, groups[i].n);
        const injB = (ASSIST_MOOD * a) / Math.max(1, groups[j].n);
        const workA = eA.d > EPS ? Math.min(h, ((cumMax - cum[h]) + injA) / eA.d) : h;
        const workB = eB.d > EPS ? Math.min(24 - h, (cum[h] + injB) / eB.d) : 24 - h;
        return Math.min(full, stA.unit * workA + stB.unit * workB);
      };
      const assist1 = assistBound(1);
      const assist2 = assistBound(2);
      list.push({
        h, cf, stableA: eA.stable, stableB: eB.stable, stable: eA.stable && eB.stable,
        full, assist1, assist2, moodCap: Math.max(assist1, assist2),
        // 同分时 §6.8 第 1 条要看"中枢需求"（越小越好）：(d·len)/(24−len) 的最大值
        demand: Math.max(
          stA.d > 0 ? (stA.d * h) / Math.max(EPS, 24 - h) : 0,
          stB.d > 0 ? (stB.d * (24 - h)) / Math.max(EPS, h) : 0,
        ),
      });
    }
    hoursAll[key] = list;
    if (hourMap.size > 400000) hourMap.clear();
    hourMap.set(sharedKey, list);
    return list;
  };

  const hoursFor = (i, j) => {
    const key = i * G + j;
    if (hoursArr[key]) { ctx.counters.retainedHits += 1; return hoursArr[key]; }
    ctx.counters.retainedEvals += 1;     // 观测：一次 = 一遍保留集挑选
    const stA = groups[i].st;
    // 保留集只由 (签名对, 中枢, limits) 决定 ⇒ 与闭式值同样可以跨状态共享。
    // `hLimit` 是测试钩子，一旦启用就绕开共享缓存，避免把截断结果泄漏给别的场景。
    const hLimit = ctx.testOptions && ctx.testOptions.hLimit;
    const retMap = pairMap(SIG_RETAINED_CACHE, ctx.centerKey);
    const sharedKey = sigIdOf(stA) * PAIR_STRIDE + sigIdOf(groups[j].st);
    if (!hLimit) {
      const shared = retMap.get(sharedKey);
      if (shared) {
        hoursArr[key] = shared;
        ctx.counters.sigRetainedHits += 1;
        return shared;
      }
    }
    const list = hoursAllOf(i, j).slice().sort((a, b) => b.cf - a.cf || a.h - b.h);
    const tolH = ctx.cfg.limits.valueTol;
    const maxCf = list[0].cf;
    const ties = list.filter((x) => Math.abs(x.cf - maxCf) <= tolH);
    const keep = new Map();
    const take = (x) => { if (x) keep.set(x.h, x); };
    // ① 闭式最优前 3 个；② 同分里"中枢需求最小"与"班长最大"各一个（§6.8 第 1/3 条）；
    // ③ 衰减边界 ⌊W*⌋+1（主逻辑 §4.4 只要求比这两个）；④ 助力上界最大的 h
    for (const x of list.slice(0, 3)) take(x);
    take(ties.reduce((b, x) => (!b || x.demand < b.demand - 1e-15 ? x : b), null));
    take(ties.reduce((b, x) => (!b || x.h > b.h ? x : b), null));
    {
      const R = cumMax - cum[list[0].h];
      const vbar = R / Math.max(EPS, 24 - list[0].h);
      const wStar = stA.d + vbar > EPS ? (24 * vbar) / (stA.d + vbar) : 0;
      const boundary = Math.min(23, Math.max(1, Math.floor(wStar) + 1));
      take(list.find((x) => x.h === boundary));
    }
    let moodBest = list[0];
    for (const x of list) if (x.moodCap > moodBest.moodCap) moodBest = x;
    take(moodBest);
    let retained = [...keep.values()].sort((a, b) => b.cf - a.cf || a.h - b.h);
    // 测试钩子：hLimit 只保留前 n 个 h，用来验证"差分测试真的能抓到 h 错误"
    if (ctx.testOptions && ctx.testOptions.hLimit) retained = retained.slice(0, ctx.testOptions.hLimit);
    hoursArr[key] = retained;
    if (!hLimit) {
      if (retMap.size > 400000) retMap.clear();
      retMap.set(sharedKey, retained);
    }
    return retained;
  };

  /** 该签名对的全部 23 个 h（值驱动展开时用；与打分共用同一份缓存，含助力上界） */
  const allHoursFor = (i, j) => hoursAllOf(i, j);

  const singleValue = (st) => {
    if (st.d <= EPS) return null;
    const T = 1 / st.d;
    const tFull = timeToRecoverWrap(1, T, ctx.center.timeline);
    const cycle = T + tFull;
    if (!Number.isFinite(cycle) || cycle <= 0) return null;
    return { value: st.unit * T * 24 / cycle, T, tFull };
  };

  // 签名对必须"真的能找出两个不相交的班组"，否则两班都按同一组人算会虚增（如会客室 90%/90%）
  const realizableCache = new Array(G * G).fill(undefined);
  const pairRealizable = (i, j) => {
    const key = i * G + j;
    if (realizableCache[key] !== undefined) return realizableCache[key];
    let ok = false;
    const A = groups[i].masks;
    const B = groups[j].masks;
    outer:
    for (const a of A) {
      for (const b of B) {
        if ((a & b) === 0n) { ok = true; break outer; }
      }
    }
    realizableCache[key] = ok;
    return ok;
  };

  return { spec, seats, rel, fillPool, groups, subList, G, hoursFor, allHoursFor, singleValue, pairRealizable };
}

/** 候选：签名对 × 班长（值只由签名决定）+ 单班；不含具体人选 */
function tableCandidates(table, pairFilter = null, hoursOverride = null) {
  const list = [];
  const fillCapacity = table.fillPool.length;
  for (let si = 0; si < table.G; si += 1) {
    const st = table.groups[si].st;
    if (!pairFilter) {
      const nSelf = table.groups[si].n;
      const single = table.singleValue(st);
      const singleFill = nSelf - sizeOf(table.groups[si].masks[0]);
      if (single && singleFill <= fillCapacity) {
        list.push({
          table, si, sj: si, h: null, single: true, nA: nSelf, nB: 0,
          cf: single.value, ub: single.value, assistUb: single.value, stable: true,
          currentValue: single.value, stA: st, stB: null, demand: 0,
        });
      }
    }
    for (let sj = 0; sj < table.G; sj += 1) {
      if (!table.pairRealizable(si, sj)) continue;
      if (pairFilter && !pairFilter(si, sj)) continue;
      const stB = table.groups[sj].st;
      const nA = table.groups[si].n;
      const nB = table.groups[sj].n;
      const fillNeed = (nA - sizeOf(table.groups[si].masks[0])) + (nB - sizeOf(table.groups[sj].masks[0]));
      if (fillNeed > fillCapacity) continue;
      const hours = hoursOverride ? hoursOverride(si, sj) : table.hoursFor(si, sj);
      for (const x of hours) {
        list.push({
          table, si, sj, h: x.h, single: false, nA, nB,
          cf: x.cf, ub: Math.max(x.cf, x.full), assistUb: Math.max(x.cf, x.moodCap ?? x.full),
          assist1: x.assist1, assist2: x.assist2, stableA: x.stableA, stableB: x.stableB,
          stable: x.stable, currentValue: x.cf, stA: st, stB: stB, demand: x.demand ?? 0,
        });
      }
    }
  }
  return list;
}

// ───────────────────────── 取值：闭式 / 逐日模拟 ─────────────────────────
function fillCrews(cand, table, fillPool) {
  const fillA = (cand.nA ?? table.seats) - sizeOf(cand.subA);
  const fillB = cand.single ? 0 : (cand.nB ?? table.seats) - sizeOf(cand.subB);
  let fillCrewA = EMPTY;
  let fillCrewB = EMPTY;
  let k = 0;
  for (let i = 0; i < fillA && k < fillPool.length; i += 1, k += 1) fillCrewA |= 1n << BigInt(fillPool[k]);
  for (let i = 0; i < fillB && k < fillPool.length; i += 1, k += 1) fillCrewB |= 1n << BigInt(fillPool[k]);
  return { fillCrewA, fillCrewB, fillA, fillB };
}

/** 取一组"规范人选"用于模拟（值只取决于签名，谁上不影响产量） */
function canonicalCrew(cand, table) {
  if (cand.subA !== undefined) return cand;
  const gA = table.groups[cand.si];
  if (cand.single) {
    cand.subA = gA.masks[0];
    cand.subB = EMPTY;
    return cand;
  }
  const gB = table.groups[cand.sj];
  outer:
  for (const a of gA.masks) {
    for (const b of gB.masks) {
      if (!intersects(a, b)) { cand.subA = a; cand.subB = b; break outer; }
    }
  }
  if (cand.subA === undefined) { cand.subA = gA.masks[0]; cand.subB = gB.masks[0]; }
  return cand;
}

function simulateCand(ctx, table, cand, assistPlan) {
  canonicalCrew(cand, table);
  const fill = fillCrews(cand, table, table.fillPool);
  const plan = {
    h: cand.single ? 24 : cand.h,
    crewA: cand.subA,
    crewB: cand.single ? EMPTY : cand.subB,
    fillCrewA: fill.fillCrewA,
    fillCrewB: fill.fillCrewB,
    nA: cand.nA ?? table.seats,
    nB: cand.single ? 0 : (cand.nB ?? table.seats),
    fillA: fill.fillA,
    fillB: fill.fillB,
  };
  if (cand.single) {
    return simulateSingleFacility({
      facility: table.spec, ops: ctx.ops, timeline: ctx.center.timeline, plan, limits: ctx.cfg.limits,
    });
  }
  return simulateFacility({
    facility: table.spec, ops: ctx.ops, timeline: ctx.center.timeline, plan,
    limits: ctx.cfg.limits, assistPlan: assistPlan || null,
  });
}

function simKey(ctx, table, cand, assistPlan) {
  const a = assistPlan ? `${assistPlan.shift}:${assistPlan.cycle.map((d) => d.join('-')).join('|')}` : '-';
  return `${ctx.center.hCenter}|${ctx.center.uA}|${ctx.center.uB}|${table.spec.key}|${cand.si}|${cand.sj}|${cand.single ? 'S' : cand.h}|${a}`;
}

/** 真值：稳定 → 闭式（精确）；衰减 → 逐日模拟（带缓存、不收敛标记） */
function evaluateCand(ctx, table, cand) {
  if (cand.evaluated) return cand;
  cand.evaluated = true;
  ctx.counters.evaluations += 1;         // 观测：统一计数（单设施 + 双舱两条路径都算）
  if (cand.stable) {
    cand.currentValue = cand.cf;
    cand.converged = true;
    return cand;
  }
  const key = simKey(ctx, table, cand, null);
  ctx.counters.simCalls += 1;
  let sim = ctx.simCache.get(key);
  if (sim) ctx.counters.simHits += 1;
  if (!sim) {
    sim = simulateCand(ctx, table, cand, null);
    ctx.simCache.set(key, sim);
    ctx.counters.simulated += 1;
    noteSim(ctx, sim);
  }
  if (!sim.converged) {
    noteUnresolved(ctx, cand.bound ?? cand.cf);
    cand.currentValue = -Infinity;
    cand.converged = false;
    return cand;
  }
  cand.currentValue = sim.avg;
  cand.converged = true;
  cand.simulation = sim;
  return cand;
}

/**
 * 助力候选：只对"确有班次不满足 R ≥ C"的计划生成（稳定计划加点全溢出，收益恒为 0），
 * 口径按会客室文档 §8.4：2 点三天轮转 / 固定同两人 / 1 点轮转或固定。
 */
function assistVariants(ctx, table, cand) {
  const out = [];
  if (cand.single) return out;
  canonicalCrew(cand, table);
  const fill = fillCrews(cand, table, table.fillPool);
  const shifts = [];
  if (cand.stableA === false) shifts.push('A');
  if (cand.stableB === false) shifts.push('B');
  for (const shift of shifts) {
    const crew = shift === 'A' ? union(cand.subA, fill.fillCrewA) : union(cand.subB, fill.fillCrewB);
    const members = toIndices(crew);
    // 注意：班次只有 1 个人时也**可以**吃 1 点助力（差分会发现漏解），所以这里只排除 0 人
    if (!members.length) continue;
    for (const m of members) {
      out.push({ shift, points: 1, cycle: [[m]], label: `1 点 · 固定 ${ctx.ops[m].name}` });
    }
    if (members.length >= 3) {
      out.push({ shift, points: 1, cycle: members.map((m) => [m]), label: '1 点 · 逐日轮转' });
    }
    const pairs = [];
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) pairs.push([members[i], members[j]]);
    }
    for (const p of pairs) {
      out.push({ shift, points: 2, cycle: [p], label: `2 点 · 固定 ${ctx.ops[p[0]].name}+${ctx.ops[p[1]].name}` });
    }
    if (members.length === 3) {
      out.push({
        shift,
        points: 2,
        cycle: [[members[0], members[1]], [members[1], members[2]], [members[2], members[0]]],
        label: '2 点 · 三天轮转',
      });
    } else if (pairs.length > 1) {
      out.push({ shift, points: 2, cycle: pairs, label: `${pairs.length} 天轮转` });
    }
  }
  return out;
}

/** 模拟结果画像（P3 观测）：区分"精确循环收敛"与"漂移判据收敛"，以及用了多少天。 */
function noteSim(ctx, sim) {
  const c = ctx.counters;
  if (!sim) return;
  if (sim.cycleLen > 0) c.simCycle += 1;
  else if (sim.converged) c.simDrift += 1;
  else c.simUnresolved += 1;
  c.simDaysSum += sim.days || 0;
  if ((sim.days || 0) > c.simDaysMax) c.simDaysMax = sim.days || 0;
}

function applyAssist(ctx, table, cand, assistLeft) {
  if (!ctx.cfg.assistOn || assistLeft <= 0 || cand.single || cand.stable) return cand;
  const tol = ctx.cfg.limits.valueTol;
  const base = Number.isFinite(cand.currentValue) ? cand.currentValue : -Infinity;
  let best = { value: base, assist: null, assistUsed: 0, simulation: cand.simulation };
  for (const variant of assistVariants(ctx, table, cand)) {
    if (variant.points > assistLeft) continue;
    const key = simKey(ctx, table, cand, variant);
    ctx.counters.simCalls += 1;
    let sim = ctx.simCache.get(key);
    if (sim) ctx.counters.simHits += 1;
    if (!sim) {
      sim = simulateCand(ctx, table, cand, variant);
      ctx.simCache.set(key, sim);
      ctx.counters.simulated += 1;
      noteSim(ctx, sim);
    }
    if (!sim.converged) { noteUnresolved(ctx, cand.bound ?? cand.cf); continue; }
    if (sim.avg > best.value + tol
      || (Math.abs(sim.avg - best.value) <= tol && best.assist && variant.points < best.assistUsed)) {
      best = { value: sim.avg, assist: variant, assistUsed: variant.points, simulation: sim };
    }
  }
  cand.currentValue = best.value;
  cand.assist = best.assist;
  cand.assistUsed = best.assistUsed;
  cand.simulation = best.simulation;
  return cand;
}

function candidateBound(ctx, cand, assistLeft) {
  if (cand.stable) return cand.cf;
  if (ctx.cfg.assistOn && assistLeft > 0) {
    const byPoints = assistLeft >= 2 ? (cand.assist2 ?? cand.assistUb) : (cand.assist1 ?? cand.assistUb);
    return Math.max(cand.cf, byPoints);
  }
  return Math.max(cand.cf, cand.ub);
}

// ───────────────────────── 类别最大化：单设施 ─────────────────────────
/**
 * 记录"模拟不收敛的候选"（不能当真值用）。只记它的**上界**与所属类别：
 * 搜索结束后，若该上界仍高于最终方案在该类别的产出，就必须降级为 conditional；
 * 否则它本来就不可能赢（真实值 ≤ 上界 < 最终值），可以合法忽略。
 */
function noteUnresolved(ctx, bound) {
  if (!ctx.unresolvedList) ctx.unresolvedList = [];
  ctx.unresolvedList.push({ cat: ctx.currentCat ?? 0, bound: Number.isFinite(bound) ? bound : Infinity });
}

/**
 * 值驱动展开：
 * 先用"保留的 h 集合"打分；凡是闭式上界够得着当前最优的签名对，把它的 **23 个 h 全算一遍**
 * （稳定 h 走闭式、衰减 h 逐日模拟）再定。这样"更长的衰减班其实更优"不会被截断掉。
 */
function maximizeSingle(ctx, table, assistLeft) {
  const tol = ctx.cfg.limits.valueTol;
  const list = tableCandidates(table);
  for (const c of list) c.bound = candidateBound(ctx, c, assistLeft);
  list.sort((a, b) => b.bound - a.bound);
  let best = -Infinity;
  const evalOne = (c) => {
    // 安全剪枝：闭式/助力上界够不着当前最优就不必评（衰减候选的闭式是上界）
    if (c.bound < best - tol) return;
    if (!ctx.budget.tick()) return;
    ctx.counters.evaluated += 1;
    evaluateCand(ctx, table, c);
    if (ctx.cfg.assistOn && assistLeft > 0 && !c.stable) {
      const ubAssist = assistLeft >= 2 ? (c.assist2 ?? c.assistUb) : (c.assist1 ?? c.assistUb);
      if (ubAssist >= best - tol) applyAssist(ctx, table, c, assistLeft);
    }
    if (!c.converged || !Number.isFinite(c.currentValue)) return;
    if (c.currentValue > best + tol) best = c.currentValue;
  };
  for (const c of list) {
    if (c.bound < best - tol) break;
    evalOne(c);
  }
  if (!Number.isFinite(best)) return { value: 0, ties: [] };

  // ── 值驱动展开：竞争候选的 23 个 h 全算（测试钩子 hLimit 生效时关掉，用来验证差分能抓到 h 类错误）──
  const expandAllowed = !(ctx.testOptions && ctx.testOptions.hLimit);
  const competitive = new Set();
  if (expandAllowed) {
    for (const c of list) {
      if (c.bound >= best - tol) competitive.add(`${c.si}|${c.sj}`);
    }
  }
  for (const key of competitive) {
    const [si, sj] = key.split('|').map(Number);
    // 展开只补 h，**不能**顺手把"两班根本凑不出两组人"的签名对带进来：
    // 它们的闭式值照样参与排序，会把 value 抬到排不出来的数上（A4 的 69.12 就是这么来的）。
    if (!table.pairRealizable(si, sj)) continue;
    for (const x of table.allHoursFor(si, sj)) {
      const cand = {
        table, si, sj, h: x.h, single: false,
        cf: x.cf, ub: Math.max(x.cf, x.full), assistUb: Math.max(x.cf, x.full),
        stableA: x.stableA, stableB: x.stableB, stable: x.stable,
        currentValue: x.cf, demand: x.demand,
        nA: table.groups[si].n, nB: table.groups[sj].n,
        stA: table.groups[si].st, stB: table.groups[sj].st,
      };
      cand.bound = candidateBound(ctx, cand, assistLeft);
      list.push(cand);
      evalOne(cand);
    }
  }
  const ties = list.filter((c) => c.evaluated && c.converged && Number.isFinite(c.currentValue)
    && c.currentValue >= best - tol);
  return { value: best, ties };
}

// ───────────────────────── 类别最大化：同类双设施 ─────────────────────────
/**
 * 精确联合（同类两座设施）：
 *  - 枚举"具体占用集"的候选实例（签名对 × 班长 × 人选组合），footprint = A∪B 的并集
 *  - cell[footprint] = 该占用集下的最优值；再做 subset-max(SOS)：best[U] = max{ cell[F] : F ⊆ U }
 *  - 联合最优 = max_U best[U] + best[R∖U]（两舱 footprint 自动不相交）
 * 稳定实例用闭式（精确）；衰减实例用上界先定位，再逐日模拟修正，直到上界不再高于已知最优。
 * 最后一级是 §6.8 + 决定性尾序（需求↓ → 班长↑ → 占用串），与单设施路径同口径。
 */
function maximizePair(ctx, tableA) {
  const tol = ctx.cfg.limits.valueTol;
  const rel = tableA.rel;
  const bits = toIndices(rel);
  const n = bits.length;
  if (n > 16) return null;
  const size = 1 << n;
  const full = size - 1;
  const localOf = (mask) => {
    let idx = 0;
    for (let p = 0; p < n; p += 1) if (has(mask, bits[p])) idx |= 1 << p;
    return idx;
  };
  const cidCache = new Map();
  const cid = (mask) => {
    let s = cidCache.get(mask);
    if (s === undefined) {
      s = toIndices(mask).map((i) => charIdOf(ctx.ops[i])).sort().join(',');
      cidCache.set(mask, s);
    }
    return s;
  };
  const demandOf = (plan) => {
    if (plan.single) return 0;
    const a = (plan.stA.d * plan.h) / Math.max(EPS, 24 - plan.h);
    const b = (plan.stB.d * (24 - plan.h)) / Math.max(EPS, plan.h);
    return Math.max(a, b);
  };
  const inst = [];
  const seen = new Set();
  const strideKey = (a, b, h) => (a * tableA.subList.length + b) * 24 + h;   // 数值键，避开 BigInt→字符串
  // 签名对 → 全部可实现的 (maskA, maskB)：展开阶段要按签名对重扫，缓存一份省掉 176² 次扫描
  const maskPairCache = new Map();
  const cellOwner = new Map();   // (local,fillNeed,si,sj,h) → inst 下标（同格只留 occ 最小的实例）
  const maskPairsOf = (si, sj) => {
    const ck = si * tableA.G + sj;
    let list = maskPairCache.get(ck);
    if (list) return list;
    list = [];
    for (const s1 of tableA.subList) {
      if (s1.si !== si) continue;
      for (const s2 of tableA.subList) {
        if (s2.si !== sj) continue;
        if ((s1.local & s2.local) !== 0) continue;
        const fillNeed = (s1.n - s1.size) + (s2.n - s2.size);
        if (fillNeed > tableA.fillPool.length) continue;
        list.push({
          s1, s2, fillNeed,
          footprint: union(s1.mask, s2.mask),
          local: s1.local | s2.local,
          occ: `${s1.cid}|${s2.cid}`,
        });
      }
    }
    maskPairCache.set(ck, list);
    return list;
  };
  const addInstances = (allHours) => {
    const tables = [tableA];
    for (const table of tables) {
      for (const s1 of table.subList) {
        const stA = s1.st;
        if (!allHours) {
          const single = table.singleValue(stA);
          if (single && s1.n - s1.size <= table.fillPool.length) {
            const key = -1 - s1.idx;                       // 单班用负数键，与两班不冲突
            if (!seen.has(key)) {
              seen.add(key);
              inst.push({
                table, si: s1.si, sj: null, subA: s1.mask, subB: EMPTY, h: null, single: true, nA: s1.n, nB: 0,
                cf: single.value, ub: single.value, stable: true, currentValue: single.value,
                local: s1.local, footprint: s1.mask, stA, stB: null,
                demand: 0, occ: `${s1.cid}|`,
                fillNeed: s1.n - s1.size,
              });
            }
          }
        }
        for (const s2 of table.subList) {
          if ((s1.local & s2.local) !== 0) continue;          // 整数局部位互斥（原来用 BigInt）
          const fillNeedPair = (s1.n - s1.size) + (s2.n - s2.size);
          if (fillNeedPair > table.fillPool.length) continue;
          const stB = s2.st;
          const si = s1.si;
          const sj = s2.si;
          const footprint = union(s1.mask, s2.mask);
          const local = s1.local | s2.local;
          const occ = `${s1.cid}|${s2.cid}`;
          const list = allHours ? table.allHoursFor(si, sj) : table.hoursFor(si, sj);
          for (const x of list) {
            // 值只由 (si, sj, h) 决定；同一 (local, fillNeed, h) 下的小人选差异只影响占用串，
            // 而占用串是同分裁决的最后一级 ⇒ 只留 occ 最小的那条，等价且省掉大量重复实例。
            const cellKey = ((local * 8 + fillNeedPair) * 36) + si * 6 + sj * 6 + x.h;
            const prevIdx = cellOwner.get(cellKey);
            if (prevIdx !== undefined) {
              if (occ < inst[prevIdx].occ) {
                inst[prevIdx] = {
                  table, si, sj, subA: s1.mask, subB: s2.mask, h: x.h, single: false, nA: s1.n, nB: s2.n,
                  cf: x.cf, ub: Math.max(x.cf, x.full), stable: x.stable,
                  currentValue: x.cf, local, footprint, stA, stB,
                  demand: x.demand ?? demandOf({ h: x.h, stA, stB, single: false }), occ,
                  fillNeed: fillNeedPair,
                };
              }
              continue;
            }
            cellOwner.set(cellKey, inst.length);
            inst.push({
              table, si, sj, subA: s1.mask, subB: s2.mask, h: x.h, single: false, nA: s1.n, nB: s2.n,
              cf: x.cf, ub: Math.max(x.cf, x.full), stable: x.stable,
              currentValue: x.cf, local, footprint, stA, stB,
              demand: x.demand ?? demandOf({ h: x.h, stA, stB, single: false }), occ,
              fillNeed: fillNeedPair,
            });
          }
        }
      }
    }
  };

  // 同一占用集（同一 footprint ⇒ 占用人数也相同）内的实例择优：
  // 裁决只剩"值"这一级（ADR 0002），值打平就保留先遇到的。
  const better = (a, b) => (Math.abs(a.v - b.v) > tol ? a.v > b.v : false);

  // 复用缓冲：size 可达 2^16，原来每轮守卫都新建 4 张表（742 轮 ⇒ 数 GB 的分配，GC 的主要来源）
  const buffers = new Map();
  const bufOf = (t) => {
    let b = buffers.get(t);
    if (!b) {
      b = {
        cell: new Array(size), cellStable: new Array(size),
        valAny: new Float64Array(size), argAny: new Array(size),
        valStable: new Float64Array(size), argStable: new Array(size),
      };
      buffers.set(t, b);
    }
    return b;
  };

  // ── 补位池是两座同类设施**共享**的：单舱最多吃 fMax 个补位，两舱合起来不能超过 mCap ──
  // 早期版本只逐舱检查，于是"两舱各自够用、合起来不够"的组合会走到组装阶段才失败，
  // 然后整条类别被丢弃（差分里就是"人手不足 ⇒ 该类记 0"）。这里把补位数当第二维做分层 SOS。
  const mCap = tableA.fillPool.length;
  const fMax = 2 * tableA.seats;
  const jointFree = mCap >= 2 * fMax;      // 两舱不可能同时吃满 ⇒ 约束永不生效
  const capList = jointFree
    ? [fMax]
    : Array.from({ length: Math.min(fMax, mCap) + 1 }, (_, k) => k);
  const needOf = (e) => e.fillNeed ?? 0;

  /** 把 cell 表做 subset-max，结果写进复用的缓冲（不分配） */
  const sosInto = (cells, val, arg) => {
    val.fill(-Infinity);
    arg.fill(null);
    for (let i = 0; i < size; i += 1) {
      const c = cells[i];
      if (c) { val[i] = c.v; arg[i] = c.e; }
    }
    for (let p = 0; p < n; p += 1) {
      const bit = 1 << p;
      for (let m = 0; m < size; m += 1) {
        if (!(m & bit)) continue;
        const prev = m ^ bit;
        if (val[prev] > val[m]) { val[m] = val[prev]; arg[m] = arg[prev]; }
      }
    }
  };

  const runLoop = (layered) => {
    const caps = layered ? capList : [fMax];
    for (let guard = 0; guard < 64; guard += 1) {
      // 分层：第 t 层只收"补位数 ≤ t"的实例（顶层 = 不设限）。
      // 一次遍历 `inst` 同时填"任意实例"和"稳定实例"两张表（原来扫两遍，5 万实例 × 12 轮守卫很贵）。
      const layer = new Map();
      for (const t of caps) {
        const buf = bufOf(t);
        const cell = buf.cell;
        const cellStable = buf.cellStable;
        cell.fill(null);
        cellStable.fill(null);
        for (let k = 0; k < inst.length; k += 1) {
          const e = inst[k];
          if ((e.fillNeed ?? 0) > t) continue;
          const v = e.evaluated
            ? (Number.isFinite(e.currentValue) ? e.currentValue : -Infinity)
            : Math.max(e.cf, e.stable ? e.cf : e.ub);
          const cur = { v, e };
          const prev = cell[e.local];
          if (!prev || better(cur, prev)) cell[e.local] = cur;
          if (e.stable) {
            const curS = { v: e.cf, e };
            const prevS = cellStable[e.local];
            if (!prevS || better(curS, prevS)) cellStable[e.local] = curS;
          }
        }
        sosInto(cell, buf.valAny, buf.argAny);
        sosInto(cellStable, buf.valStable, buf.argStable);
        layer.set(t, {
          any: { val: buf.valAny, arg: buf.argAny },
          stable: { val: buf.valStable, arg: buf.argStable },
        });
      }
      const cap2Of = (t1) => (layered ? Math.min(fMax, mCap - t1) : fMax);
      const feasiblePair = (a, b) => !!a && !!b && a !== b
        && (a.footprint & b.footprint) === 0n && needOf(a) + needOf(b) <= mCap;
      let upper = -Infinity;
      let lower = -Infinity;
      for (const t1 of caps) {
        const t2 = cap2Of(t1);
        const anyA = layer.get(t1).any;
        const anyB = layer.get(t2).any;
        const stA2 = layer.get(t1).stable;
        const stB2 = layer.get(t2).stable;
        for (let U = 0; U <= full; U += 1) {
          const up = anyA.val[U] + anyB.val[full - U];
          if (up > upper) upper = up;
          const lo = stA2.val[U] + stB2.val[full - U];
          if (lo > lower) lower = lo;
        }
      }
      if (process.env.DEBUG_CAT) console.error(`  [pair] layered=${layered} caps=${caps.join('/')} upper=${upper.toFixed(4)} lower=${lower.toFixed(4)}`);
      if (!Number.isFinite(upper) && !Number.isFinite(lower)) return { value: 0, combos: [] };
      if (upper <= lower + tol) {
        // 收齐"同一占用集里的同分实现"（不同班长/不同人选），交给父层按 §6.8 + 决定性尾序裁决；
        // 只在单元内取一条会让"自己需求略大但班长更长/人选更优"的同分方案提前出局。
        const byLocal = new Map();
        for (const e of inst) {
          if (!e.stable) continue;
          const arr = byLocal.get(e.local) || [];
          arr.push(e);
          byLocal.set(e.local, arr);
        }
        const combos = [];
        let bestCombo = -Infinity;
        outer:
        for (const t1 of caps) {
          const t2 = cap2Of(t1);
          const stA2 = layer.get(t1).stable;
          const stB2 = layer.get(t2).stable;
          for (let U = 0; U <= full; U += 1) {
            const lo = stA2.val[U] + stB2.val[full - U];
            if (lo < lower - tol) continue;
            const a = stA2.arg[U];
            const b = stB2.arg[full - U];
            if (!feasiblePair(a, b)) continue;
            const listA = (byLocal.get(a.local) || [])
              .filter((e) => e.cf >= stA2.val[U] - tol && needOf(e) <= t1);
            const listB = (byLocal.get(b.local) || [])
              .filter((e) => e.cf >= stB2.val[full - U] - tol && needOf(e) <= t2);
            for (const x of listA.slice(0, 40)) {
              for (const y of listB.slice(0, 40)) {
                if (!feasiblePair(x, y)) continue;
                combos.push([x, y]);
                if (x.cf + y.cf > bestCombo) bestCombo = x.cf + y.cf;
                if (combos.length > 400) break;
              }
              if (combos.length > 400) break;
            }
            if (combos.length > 400) break;
          }
          if (combos.length > 400) break;
        }
        // 没分层时上界可能被"两舱合计补位超池"的组合抬高：此时必须退回分层再算一遍
        const needLayered = !layered && bestCombo < lower - tol;
        if (needLayered) return { value: upper, combos: [], needLayered };
        if (combos.length) return { value: lower, combos };
        return { value: upper, combos: [] };
      }
      // 上界仍高于下限 ⇒ 把参与上界的衰减实例模拟掉，收紧上界
      let changed = false;
      for (const t1 of caps) {
        const t2 = cap2Of(t1);
        const anyA = layer.get(t1).any;
        const anyB = layer.get(t2).any;
        for (let U = 0; U <= full; U += 1) {
          if (anyA.val[U] + anyB.val[full - U] < upper - tol) continue;
          for (const e of [anyA.arg[U], anyB.arg[full - U]]) {
            if (!e || e.stable || e.evaluated) continue;
            evaluateCand(ctx, tableA, e);
            changed = true;
          }
        }
      }
      if (!changed) {
        ctx.approximations.add('同类双设施存在无法确证的衰减候选');
        const combos = [];
        let bestFeasible = -Infinity;
        for (const t1 of caps) {
          const t2 = cap2Of(t1);
          const anyA = layer.get(t1).any;
          const anyB = layer.get(t2).any;
          for (let U = 0; U <= full; U += 1) {
            const val = anyA.val[U] + anyB.val[full - U];
            if (val < upper - tol) continue;
            const a = anyA.arg[U];
            const b = anyB.arg[full - U];
            if (!feasiblePair(a, b)) continue;
            combos.push([a, b]);
            if (val > bestFeasible) bestFeasible = val;
          }
        }
        // 上界只有"补位超池"的不可行组合能撑住 ⇒ 退回分层精确路径
        if (!layered && bestFeasible < upper - tol) return { value: upper, combos: [], needLayered: true };
        return { value: upper, combos, approximate: true };
      }
    }
    ctx.approximations.add('同类双设施的衰减修正未收敛');
    return { value: 0, combos: [] };
  };
  addInstances(false);
  if (process.env.DEBUG_CAT) console.error(`  [pair] inst=${inst.length} size=${size} fillPool=${tableA.fillPool.length} rel=${n}`);
  if (!inst.length) return { value: 0, combos: [] };
  if (!ctx.budget.tick()) return { value: 0, combos: [], exhausted: true };

  // 先按"不设补位联合约束"的快路径算（多数实例的赢家本来就补得起），
  // 只有当结果依赖"两舱合计补位 > 池"的组合（不可行）时才退回分层精确路径重算。
  let layered = false;
  let result = runLoop(layered);
  if ((result.needLayered || result.approximate) && !jointFree) { layered = true; result = runLoop(layered); }
  delete result.needLayered;
  // ── 值驱动展开：把参与最优组合的签名对扩到全部 23 个 h，再跑一遍 ──
  // 同一批人换舱/换班（`(si,sj)` 与 `(sj,si)`）是等值的两种排法，保留 h 集合却按各签名对
  // 自己的闭式排名裁剪，可能出现"某一侧把最优 h 剪掉了"。所以展开要**连同对换项**一起扩，
  // 否则第一遍赢的是对换项时，真正更优的那一侧永远拿不到全部 h（差分里表现为总值偏低）。
  const expandable = !(ctx.testOptions && ctx.testOptions.hLimit);
  if (expandable && result.combos.length) {
    const pairs = new Set();
    for (const combo of result.combos) {
      for (const e of combo) {
        if (e.single) continue;
        pairs.add(`${e.si}|${e.sj}`);
        pairs.add(`${e.sj}|${e.si}`);
      }
    }
    const before = inst.length;
    for (const key of pairs) {
      const [si, sj] = key.split('|').map(Number);
      const allHours = tableA.allHoursFor(si, sj);
      for (const mp of maskPairsOf(si, sj)) {
        const { s1, s2, fillNeed, footprint, local, occ } = mp;
        for (const x of allHours) {
          const k = strideKey(s1.idx, s2.idx, x.h);
          if (seen.has(k)) continue;
          seen.add(k);
          inst.push({
            table: tableA, si, sj, subA: s1.mask, subB: s2.mask, h: x.h, single: false, nA: s1.n, nB: s2.n,
            cf: x.cf, ub: Math.max(x.cf, x.full), stable: x.stable,
            currentValue: x.cf, local, footprint, stA: s1.st, stB: s2.st,
            demand: x.demand ?? 0, occ,
            fillNeed,
          });
        }
      }
    }
    if (inst.length > before) result = runLoop(layered);
  }
  return result;
}

// ───────────────────────── 分支组装 ─────────────────────────
/** 枚举一条候选的全部具体人选实现（同一签名下的人选不同 ⇒ 占用集不同，必须全部保留） */
function* realizations(cand, table) {
  const gA = table.groups[cand.si];
  if (cand.single) {
    for (const a of gA.masks) yield { subA: a, subB: EMPTY };
    return;
  }
  const gB = table.groups[cand.sj];
  for (const a of gA.masks) {
    for (const b of gB.masks) {
      if (!intersects(a, b)) yield { subA: a, subB: b };
    }
  }
}

/**
 * 补位（白板）怎么挑：返回**多个可选方案**，不是只挑一个。
 *
 * 为什么不能只挑一个：补位的人对**本设施**产出没有影响（白板），但对**后续类别**有影响。
 * 只按 (laterRel, charId) 贪心挑一个，会出现"本类别同分、却把下个类别的主力当白板烧掉"的情况
 * （压力测试 S4 抓到的真实漏解：会客室无线索技能 ⇒ 全靠白板 ⇒ 烧掉武器经验的陈千语，导致武器经验低 1.96）。
 *
 * 做法（决策 35/36/53）：基准序仍是 (非 laterRel 优先, charId 升序)，它给出默认解；
 * 只有当默认解里**确实混进了后续类别要用的人**时，才逐个把这些人换成候补，生成至多 8 个变体，
 * 交给上层按 §6.8（两级：人数 → 首遇）与下游产出裁决。
 */
function realizeFillerVariants(ctx, table, cand, subA, subB, catIdx, usedInCategory) {
  const needA = (cand.nA ?? table.seats) - sizeOf(subA);
  const needB = cand.single ? 0 : (cand.nB ?? table.seats) - sizeOf(subB);
  const need = needA + needB;
  if (!need) return [{ fillCrewA: EMPTY, fillCrewB: EMPTY }];
  const avail = without(ctx.availMask, union(usedInCategory, union(subA, subB)));
  const pool = toIndices(without(avail, table.rel));
  if (pool.length < need) return null;      // 补位只能来自"本设施用不上的干员"
  const laterRel = catIdx + 1 < ctx.cats.length ? ctx.laterRel[catIdx + 1] : EMPTY;
  const order = (list) => list.slice().sort((a, b) => {
    const la = has(laterRel, a) ? 1 : 0;
    const lb = has(laterRel, b) ? 1 : 0;
    if (la !== lb) return la - lb;
    const ia = charIdOf(ctx.ops[a]);
    const ib = charIdOf(ctx.ops[b]);
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
  const build = (chosen) => {
    let fillCrewA = EMPTY;
    let fillCrewB = EMPTY;
    for (let k = 0; k < chosen.length; k += 1) {
      const bit = 1n << BigInt(chosen[k]);
      if (k < needA) fillCrewA |= bit; else fillCrewB |= bit;
    }
    return { fillCrewA, fillCrewB };
  };

  if (process.env.DEBUG_FILL) {
    const nm2 = (m) => toIndices(m).map((k) => ctx.ops[k].name).join(',');
    console.error(`[fill-entry] cat=${ctx.cats[catIdx]} ${table.spec.key} need=${need} pool=${pool.length} rel=${nm2(table.rel)}`);
  }
  const sorted = order(pool);
  const base = sorted.slice(0, need);
  const out = [build(base)];

  // 白板对本科目等价、对下游不等价：把"烧掉谁"当搜索维度，才不会把下一个类别的主力当白板烧掉
  // （压力测试 S4 就是靠这一步把武器经验从 40.63 补到 42.59）。
  // 语义条件（决策 35）：变体之间**只可能在"烧掉谁"上不同**。若基准补位里没有一个人落在
  // 后续类别相关集内，任何变体对下游都等价 ⇒ 不生成变体（省掉纯浪费的枚举）。
  // 生成口径（决策 36）：只**换出**，不做全组合枚举——把基准补位里的每个"下游要用的人"
  // 逐个换成候补池里的人（`sorted` 已把非下游相关的人排在前面）。上限 8 个（决策 53）。
  const hit = base.filter((x) => has(laterRel, x));
  if (hit.length) {
    const spare = sorted.filter((x) => !base.includes(x));
    outer:
    for (const person of hit) {
      for (const repl of spare) {
        if (out.length >= VARIANT_BUDGET) break outer;
        const chosen = base.slice();
        chosen[chosen.indexOf(person)] = repl;
        out.push(build(chosen));
      }
    }
  }
  if (process.env.DEBUG_FILL && out.length > 1) {
    const nm = (m) => toIndices(m).map((k) => ctx.ops[k].name).join(',');
    console.error(`[fill-variants] cat=${ctx.cats[catIdx]} ${table.spec.key} need=${need} pool=${pool.length}`
      + ` variants=${out.length} ` + out.map((v) => `A[${nm(v.fillCrewA)}]B[${nm(v.fillCrewB)}]`).join(' / '));
  }
  return out;
}

function buildPick(ctx, table, cand, subA, subB, fillers) {
  return {
    spec: table.spec,
    single: cand.single,
    h: cand.single ? null : cand.h,
    seats: table.seats,
    nA: cand.nA ?? table.seats,
    nB: cand.single ? 0 : (cand.nB ?? table.seats),
    crewA: subA,
    crewB: cand.single ? EMPTY : subB,
    fillCrewA: fillers.fillCrewA,
    fillCrewB: fillers.fillCrewB,
    fillA: (cand.nA ?? table.seats) - sizeOf(subA),
    fillB: cand.single ? 0 : (cand.nB ?? table.seats) - sizeOf(subB),
    stA: cand.stA,
    stB: cand.single ? null : cand.stB,
    trueValue: cand.currentValue,
    assist: cand.assist || null,
    assistUsed: cand.assistUsed || 0,
    simulation: cand.simulation || null,
    closedForm: !cand.simulation,
  };
}

// ───────────────────────── 类别分支 ─────────────────────────
function emptyCategoryBranch() {
  return {
    value: 0, picks: [], usedMask: EMPTY, assistUsed: 0,
    demand: 0, usedCount: 0, tieHours: [], charIds: [], occPairs: [],
  };
}

function categoryBranches(ctx, catIdx, usedMask, assistLeft) {
  try {
    return categoryBranchesBody(ctx, catIdx, usedMask, assistLeft);
  } finally {
  }
}

function categoryBranchesBody(ctx, catIdx, usedMask, assistLeft) {
  const cat = ctx.cats[catIdx];
  const specs = ctx.byCat.get(cat) || [];
  ctx.availMask = without(ctx.allMask, usedMask);
  ctx.currentCat = catIdx;
  if (!specs.length) return [emptyCategoryBranch()];
  // 决策 19 的支配判据：本类别所有设施都排满两班需要 Σ 2×工位数 人；
  // 可用人数够得上这个数时，n<工位数 的候选被"补白板严格更优"支配。
  const needAll = specs.reduce((s, spec) => s + 2 * Math.min(spec.slots || SLOTS, SLOTS), 0);
  ctx.reducedSizes = sizeOf(ctx.availMask) < needAll;
  if (process.env.DEBUG_DFS) {
    const nm = (m) => toIndices(m).map((i) => ctx.ops[i].name).join(',');
    console.error(`[catentry] cat=${cat} hc=${ctx.center.hCenter} avail=${nm(ctx.availMask)} need=${needAll} reduced=${ctx.reducedSizes}`);
  }
  if (process.env.DEBUG_CAT && ctx.reducedSizes) {
    console.error(`  [cat ${cat}] 缺人：可用 ${sizeOf(ctx.availMask)} < 满工位 ${needAll} ⇒ 展开 1..工位数`);
  }
  const tol = ctx.cfg.limits.valueTol;

  const tables = [];
  for (const spec of specs) {
    const t = buildFacilityTable(ctx, spec, ctx.availMask);
    if (!t) return [];
    tables.push(t);
  }

  let value = 0;
  let combos = [];
  if (tables.length === 1) {
    const table = tables[0];
    const res = maximizeSingle(ctx, table, assistLeft);
    value = res.value;
    combos = res.ties.map((c) => [c]);
  } else if (tables.length === 2) {
    let res = maximizePair(ctx, tables[0]);
    if (!res) {
      ctx.approximations.add('同类双设施的相关干员过多，联合搜索退化为成对扫描');
      res = maximizePairScan(ctx, tables[0], tables[1]);
    }
    if (res.exhausted) return [];
    value = res.value;
    combos = res.combos;
    if (process.env.DEBUG_CAT) {
      console.error(`  [cat ${cat}] value=${value} combos=${combos.length} approx=${!!res.approximate}`
        + ` 组合值=${combos.slice(0, 6).map((c) => c.reduce((s, e) => s + (e.currentValue ?? e.cf), 0).toFixed(3)).join(',')}`);
    }
    if (ctx.cfg.assistOn && assistLeft > 0) {
      ctx.approximations.add('同类双舱类别在仍有剩余助力时按无助力估值');
    }
  } else {
    return [];
  }
  if (!combos.length) {
    if (process.env.DEBUG_CAT) console.error(`  [cat ${cat}] 无候选组合（tables=${tables.length} value=${value}）`);
    return [];
  }

  // 同分分支：按"占用集"去重（同一占用集只留裁决更优的一条）
  const seen = new Map();
  const laterRel = catIdx + 1 < ctx.cats.length ? ctx.laterRel[catIdx + 1] : EMPTY;

  const addBranch = (entries, total) => {
    const baseUsed = entries.reduce((u, e) => union(u, union(e.subA, e.subB || EMPTY)), EMPTY);
    // 补位可能有多个等价方案（白板对本科目无影响、对后续科目有影响）⇒ 逐个都交给保留逻辑裁决
    const walk = (i, used, picks, assistUsed) => {
      if (i === entries.length) { finish(used, picks, assistUsed); return; }
      const e = entries[i];
      const variants = realizeFillerVariants(ctx, e.table, e.cand, e.subA, e.subB || EMPTY, catIdx, used);
      if (!variants) {
        if (process.env.DEBUG_DFS) {
          const nm = (m) => toIndices(m).map((k) => ctx.ops[k].name).join(',');
          console.error(`[addBranch-fail] cat=${cat} hc=${ctx.center.hCenter} ${e.table.spec.key} `
            + `nA=${e.cand.nA} nB=${e.cand.nB} single=${!!e.cand.single} subA=${nm(e.subA)} subB=${nm(e.subB)} used=${nm(used)}`);
        }
        return;
      }
      for (const fillers of variants) {
        const pick = buildPick(ctx, e.table, e.cand, e.subA, e.subB || EMPTY, fillers);
        walk(i + 1, union(used, union(pick.fillCrewA, pick.fillCrewB)), [...picks, pick],
          assistUsed + pick.assistUsed);
      }
    };
    const finish = (used, picks, assistUsed) => {
    if (assistUsed > assistLeft) return;
    const branch = { value: total, picks, usedMask: used, assistUsed, usedCount: sizeOf(used) };
    const key = `${used & laterRel}|${assistUsed}`;
    // 同一 key 内：产出同档、裁决只看占用人数（ADR 0002）
    //   · 人数更少 ⇒ 支配（占的人更少，下游只会更好，裁决第 2 级也更优）
    //   · 人数相同 ⇒ 等价，保留先遇到的那条（不做任何二级比较）
    const old = seen.get(key);
    if (!old || branch.usedCount < old.usedCount) seen.set(key, branch);
    };
    walk(0, baseUsed, [], 0);
  };

  if (tables.length === 1) {
    const table = tables[0];
    const cval = (c) => (Number.isFinite(c.currentValue) ? c.currentValue : c.cf);
    if (process.env.DEBUG_DFS) {
      const nm = (m) => toIndices(m).map((i) => ctx.ops[i].name).join(',');
      console.error(`[single] cat=${cat} hc=${ctx.center.hCenter} avail=${nm(ctx.availMask)} rel=${nm(table.rel)} `
        + `groups=${table.G} fillPool=${table.fillPool.length} value=${value} combos=${combos.length}`);
    }
    // 值最优的候选**可能排不出来**：人数不够（两班要 2n 个人互不相同）、补位池空、
    // 或同一签名组里没有互不相交的人选。旧代码遇到这种就直接 return 出 0 条分支，
    // 整个类别被悄悄记 0（差分族 D3 抓到的真漏解）。所以按"值档"从高到低试，
    // 取第一个真能实现的档，并把 value 改成该档的值。
    const ordered = combos.slice().sort((x, y) => cval(y[0]) - cval(x[0]));
    const tiers = [];
    for (const combo of ordered) {
      const v = cval(combo[0]);
      if (!tiers.length || Math.abs(v - tiers[tiers.length - 1]) > tol) tiers.push(v);
    }
    let count = 0;
    let accepted = null;
    outer:
    for (const tier of tiers) {
      let tried = 0;
      let yielded = 0;
      for (const combo of ordered) {
        const cand = combo[0];
        const total = cval(cand);
        if (Math.abs(total - tier) > tol) continue;
        tried += 1;
        for (const r of realizations(cand, table)) {
          yielded += 1;
          count += 1;
          if (count > 200000) { ctx.approximations.add('单类别人选实现过多，已截断'); break outer; }
          addBranch([{ table, cand, subA: r.subA, subB: r.subB }], total);
        }
      }
      if (process.env.DEBUG_DFS) {
        console.error(`[tier] cat=${cat} hc=${ctx.center.hCenter} tier=${tier.toFixed(4)} tried=${tried} yielded=${yielded} seen=${seen.size}`);
      }
      if (seen.size > 0) { accepted = tier; break; }
    }
    if (accepted != null && Math.abs(accepted - value) > tol) {
      // 最优档排不出来 ⇒ 该类别的最优可实现值下移（父层按 branch.value 计分，这里同步一下口径）
      if (process.env.DEBUG_DFS) {
        console.error(`[single-fallback] cat=${cat} hc=${ctx.center.hCenter} ${value.toFixed(4)} -> ${accepted.toFixed(4)}`);
      }
      value = accepted;
    }
  } else {
    // 两座设施内容相同（同一类别），值只需算一次；但输出要各自带正确的 spec
    const tableFor = specs.map((spec, k) => (k === 0 ? tables[0] : { ...tables[0], spec }));
    for (const combo of combos) {
      const total = combo.reduce((s, e) => s + e.currentValue, 0);
      if (total < value - tol) continue;
      // 两座同类设施互换身份不改变产量 ⇒ 按占用串 canon 化，保证输出可复现
      const cidOf = (x) => `${toIndices(x.subA).map((i) => charIdOf(ctx.ops[i])).sort().join(",")}|${toIndices(x.subB || EMPTY).map((i) => charIdOf(ctx.ops[i])).sort().join(",")}`;
      const ordered = combo.slice().sort((x, y) => (cidOf(x) < cidOf(y) ? -1 : cidOf(x) > cidOf(y) ? 1 : 0));
      addBranch(ordered.map((e, k) => ({
        table: tableFor[k], cand: e, subA: e.subA, subB: e.subB,
      })), total);
    }
  }
  const flatBranches = [...seen.values()];
  if (process.env.DEBUG_DFS) {
    const nm = (m) => toIndices(m).map((i) => ctx.ops[i].name).join(',');
    console.error(`[catret] cat=${cat} hc=${ctx.center.hCenter} avail=${nm(ctx.availMask)} `
      + `flat=${flatBranches.length} keys=${seen.size} value=${value}`);
  }
  return flatBranches;
}

/** 分支里最长的班长（单班用 1/d 代替，与 §6.8 第 3 条一致） */
function maxHourOf(branch) {
  let m = 0;
  for (const h of branch.tieHours) if (Number.isFinite(h) && h > m) m = h;
  return m;
}

/** 兜底：上界降序的成对扫描（相关干员太多、SOS 放不下时用；会标记为近似） */
function maximizePairScan(ctx, tableA, tableB) {
  const tol = ctx.cfg.limits.valueTol;
  const listA = tableCandidates(tableA).sort((a, b) => b.ub - a.ub);
  const listB = tableCandidates(tableB).sort((a, b) => b.ub - a.ub);
  let best = -Infinity;
  const usable = (a, b) => {
    canonicalCrew(a, tableA);
    canonicalCrew(b, tableB);
    return !intersects(union(a.subA, a.subB || EMPTY), union(b.subA, b.subB || EMPTY));
  };
  for (const a of listA) {
    if (a.ub + listB[0].ub < best - tol) break;
    for (const b of listB) {
      if (a.ub + b.ub < best - tol) break;
      if (!usable(a, b)) continue;
      if (!ctx.budget.tick()) break;
      evaluateCand(ctx, tableB, b);
      evaluateCand(ctx, tableA, a);
      if (!a.converged || !b.converged) continue;
      const total = a.currentValue + b.currentValue;
      if (total > best + tol) best = total;
    }
  }
  if (!Number.isFinite(best)) return { value: 0, combos: [], approximate: true };
  const combos = [];
  for (const a of listA) {
    if (!a.evaluated || !a.converged) continue;
    for (const b of listB) {
      if (!b.evaluated || !b.converged) continue;
      if (Math.abs(a.currentValue + b.currentValue - best) > tol) continue;
      if (!usable(a, b)) continue;
      combos.push([{ ...a, table: tableA }, { ...b, table: tableB }]);
    }
  }
  return { value: best, combos, approximate: true };
}

/** 同分分支的局部裁决（§6.8）：中枢需求更小 → 占用更少 → 班长更大 → charId 升序 */
function compareBranches(a, b) {
  if (a.value !== b.value) return b.value - a.value;
  if (a.demand !== b.demand) return a.demand - b.demand;
  if (a.usedCount !== b.usedCount) return a.usedCount - b.usedCount;
  for (let i = 0; i < Math.min(a.tieHours.length, b.tieHours.length); i += 1) {
    if (a.tieHours[i] !== b.tieHours[i]) return b.tieHours[i] - a.tieHours[i];
  }
  const ac = a.charIds.slice().sort();
  const bc = b.charIds.slice().sort();
  for (let i = 0; i < Math.min(ac.length, bc.length); i += 1) {
    if (ac[i] !== bc[i]) return ac[i] < bc[i] ? -1 : 1;
  }
  return ac.length - bc.length;
}

// ───────────────────────── DFS ─────────────────────────
/** 裁决只剩两级（ADR 0002）：产出向量 → 占用人数 */
function metricsOf({ score, usedCount }) {
  return { score, usedCount };
}

function dfs(ctx, catIdx, usedMask, assistLeft, prefixScore) {
  if (!ctx.budget.tick()) return null;
  ctx.counters.dfsCalls += 1;
  if (catIdx >= ctx.cats.length) {
    ctx.counters.leaves += 1;
    return { score: [], picks: [], catRes: {}, usedMask: EMPTY, assistUsed: 0, usedCount: 0 };
  }
  // 记忆化键：类别序号 + 完整占用集 + 剩余助力。
  // （文档 Q2 的"掩掉无关干员"只在"补位只能从无关池取"时等价；本实现允许无关干员补位，
  //   所以键里保留完整占用集，避免把不同补位状态错并。
  //   中枢需求已退出裁决（ADR 0002），不再是键的一维。）
  const key = `${catIdx}|${usedMask}|${assistLeft}`;
  if (ctx.memo.has(key)) { ctx.counters.memoHits += 1; return ctx.memo.get(key); }
  ctx.counters.memoMisses += 1;

  const cat = ctx.cats[catIdx];
  const branches = categoryBranches(ctx, catIdx, usedMask, assistLeft);
  if (!branches.length) {
    // §6.4：该类别记 0 并继续；只有「线索」排不出来才作废整条时间轴（决策 20）
    if (cat === '线索') { ctx.memo.set(key, null); return null; }
    // 缺口报告（决策 20）：①记 0 的类别与原因；②差几人
    if (ctx.gapsList) {
      const need = (ctx.byCat.get(cat) || []).reduce((s, spec) => s + 2 * Math.min(spec.slots || SLOTS, SLOTS), 0);
      const left = sizeOf(without(ctx.allMask, usedMask));
      ctx.gapsList.push({
        cat,
        reason: left < need ? '人手不足' : '该组排不出稳定/可行方案',
        detail: `可用 ${left} 人，满工位最少需要 ${need} 人`,
      });
    }
    const rest = dfs(ctx, catIdx + 1, usedMask, assistLeft, [...prefixScore, 0]);
    if (rest === PRUNED) return PRUNED;
    if (!rest) { ctx.memo.set(key, null); return null; }
    const res = {
      ...rest,
      score: [0, ...rest.score],
      catRes: { [cat]: { value: 0, picks: [] }, ...rest.catRes },
    };
    ctx.memo.set(key, res);
    return res;
  }

  let best = null;
  let bestMetrics = null;
  let tainted = false;                    // 有子树被现任剪掉 ⇒ 本节点结果不完整，不能写 memo
  for (const branch of branches) {
    if (ctx.budget.exhausted) break;
    ctx.counters.branchIters += 1;
    // 值前缀剪枝（只在浅层，见 PRUNE_DEPTH 的注释）
    if (PRUNE_DEPTH >= 0 && catIdx <= PRUNE_DEPTH && ctx.incumbent) {
      const prefix = [...prefixScore, branch.value];
      if (prefixStrictlyWorse(prefix, ctx.incumbent.score, ctx.cfg.limits.valueTol)) {
        ctx.counters.prunedR1 += 1;
        tainted = true;
        continue;
      }
    }
    if (process.env.DEBUG_DFS) {
      const nm = (m) => toIndices(m).map((i) => ctx.ops[i].name).join(',');
      console.error(`[dfs-step] cat=${cat} hc=${ctx.center.hCenter} branch=${nm(branch.usedMask)}`);
    }
    const rest = dfs(ctx, catIdx + 1, union(usedMask, branch.usedMask), assistLeft - branch.assistUsed,
      [...prefixScore, branch.value]);
    if (rest === PRUNED) { tainted = true; continue; }
    if (!rest) continue;
    const score = [branch.value, ...rest.score];
    const metrics = metricsOf({ score, usedCount: branch.usedCount + rest.usedCount });
    if (!bestMetrics || comparePlans(metrics, bestMetrics, ctx.cfg) > 0) {
      bestMetrics = metrics;
      best = {
        score,
        picks: branch.picks.concat(rest.picks),
        catRes: { [cat]: { value: branch.value, picks: branch.picks }, ...rest.catRes },
        usedMask: union(branch.usedMask, rest.usedMask),
        assistUsed: branch.assistUsed + rest.assistUsed,
        usedCount: metrics.usedCount,
      };
    }
  }
  if (process.env.DEBUG_DFS) {
    const names = (m) => toIndices(m).map((i) => ctx.ops[i].name).join(',');
    const sc = best ? best.score.map((x) => (Number.isFinite(x) ? x.toFixed(4) : String(x))).join('/') : 'null';
    console.error(`[dfs] cat=${cat} branches=${branches.length} used=${names(usedMask)} => ${sc}`);
  }
  // 现任（P5）：只有能构成完整方案时（深度 0）才发布，且必须是真实可行的方案
  if (catIdx === 0 && best) {
    const m = metricsOf({ score: best.score, usedCount: best.usedCount });
    if (!ctx.incumbent || comparePlans(m, ctx.incumbent, ctx.cfg) > 0) ctx.incumbent = m;
  }
  // 被剪过的节点结果不完整：写进 memo 会把"下界"当成该状态的最优值，污染别的路径
  if (!tainted) ctx.memo.set(key, best);
  else ctx.counters.memoSkipPruned += 1;
  return best || (tainted ? PRUNED : null);
}

// ───────────────────────── 主入口 ─────────────────────────
/**
 * 最终方案上的补位等价替换（§6.8 第 5 条 charId 升序）：
 * 白板对产出无影响 ⇒ 只要不占用任何"技能岗/中枢"的人、且对该设施无加成或减免，
 * 换成字典序更小的 charId 就是**等值**的。搜索阶段为了不让补位抢走后续类别的相关干员
 * 走了保守选择，这里在最终方案上做一次等价替换（保留原来的补位数，换人不动值）。
 */
function upgradeFillers(ops, plan) {
  const picks = plan.picks || [];
  if (!picks.length) return;
  const centerUsed = plan.center && plan.center.used ? plan.center.used : EMPTY;
  const skilledMask = picks.reduce((m, p) => union(m, union(p.crewA, p.crewB || EMPTY)), centerUsed);
  const slots = [];
  for (const p of picks) {
    const needA = p.nA - sizeOf(p.crewA);
    const needB = p.single ? 0 : p.nB - sizeOf(p.crewB || EMPTY);
    for (let i = 0; i < needA; i += 1) slots.push({ pick: p, which: 'A' });
    for (let i = 0; i < needB; i += 1) slots.push({ pick: p, which: 'B' });
  }
  if (!slots.length) return;
  const free = toIndices(without(maskAll(ops.length), skilledMask));
  const byCharId = free.slice().sort((a, b) => (charIdOf(ops[a]) < charIdOf(ops[b]) ? -1 : 1));
  const taken = new Set();
  const next = new Map();                      // pick -> {A, B}
  for (const slot of slots) {
    let chosen = -1;
    for (const i of byCharId) {
      if (taken.has(i)) continue;
      if (isUseful(ops[i], { room: slot.pick.spec.room, weights: slot.pick.spec.weights })) continue;
      chosen = i;
      break;
    }
    if (chosen < 0) return;                    // 凑不齐 ⇒ 保持原方案不动
    taken.add(chosen);
    const rec = next.get(slot.pick) || { A: EMPTY, B: EMPTY };
    const bit = 1n << BigInt(chosen);
    if (slot.which === 'A') rec.A = union(rec.A, bit); else rec.B = union(rec.B, bit);
    next.set(slot.pick, rec);
  }
  for (const p of picks) {
    const rec = next.get(p) || { A: EMPTY, B: EMPTY };
    p.fillCrewA = rec.A;
    p.fillCrewB = rec.B;
    p.fillA = sizeOf(rec.A);
    p.fillB = sizeOf(rec.B);
  }
}

// ───────────────────────── 主入口之上的装配 ─────────────────────────
export function solveLayout({ ops, cfg, testOptions = null }) {
  const specs = facilitySpecs(cfg);
  PURE_USEFUL = new Set();
  ops.forEach((op, i) => { if (specs.some((s) => isUseful(op, s))) PURE_USEFUL.add(i); });

  const byCat = new Map();
  for (const s of specs) {
    const c = catOf(s);
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(s);
  }
  const cats = cfg.priority.slice();
  const allMask = maskAll(ops.length);
  const catRel = cats.map((c) => {
    let m = EMPTY;
    for (const s of byCat.get(c) || []) m = union(m, relevantMask(ops, s, allMask));
    return m;
  });
  const laterRel = new Array(cats.length);
  let acc = EMPTY;
  for (let i = cats.length - 1; i >= 0; i -= 1) { acc = union(acc, catRel[i]); laterRel[i] = acc; }

  // 松弛上界证书的口径（实现只在测试里，见 tools/test/certificate-support.mjs）：把中枢层整个松弛掉——不消耗任何干员、
  // u 恒取上限 48%（v = 17.76%/h 恒定）。任何真实时间轴都逐点满足 v ≤ 17.76%，
  // 因此"松弛模型的最优向量"就是真实最优向量的上界；若两者相等，则现答案全局最优。
  const relaxedCenter = !!(testOptions && testOptions.relaxedCenter);
  const centers = relaxedCenter ? [{
    uA: 0.48, uB: 0.48, hCenter: 12,
    timeline: [{ t0: 0, t1: 24, u: 0.48, v: 0.1776 }],
    used: EMPTY, idxA: [], idxB: [], fillA: [], fillB: [],
    maskA: EMPTY, maskB: EMPTY, cA: 1, cB: 1, rA: 1.776, rB: 1.776,
    cost: 0, relaxed: true,
  }] : enumerateCenters(ops, cfg);
  const budget = makeBudget(cfg);
  // 观测（P0，决策 52 第 ① 步）：只加计数，**不改变任何搜索行为**。
  // 说明：`evaluated` 沿用历史语义（只在单设施路径自增），新的统一计数见 `evaluations`。
  const counters = {
    evaluated: 0, simulated: 0,
    dfsCalls: 0, leaves: 0, branchIters: 0, memoHits: 0, memoMisses: 0,
    closedFormEvals: 0, closedFormHits: 0, retainedEvals: 0, retainedHits: 0,
    evaluations: 0, simCalls: 0, simHits: 0,
    sigHourHits: 0, sigHourEvals: 0, sigRetainedHits: 0,
    simCycle: 0, simDrift: 0, simUnresolved: 0, simDaysSum: 0, simDaysMax: 0,
    prunedR1: 0, memoSkipPruned: 0,
  };
  const approximations = new Set();

  const base = {
    ops, cfg, cats, byCat, catRel, laterRel, allMask, budget, counters, approximations, testOptions,
    simCache: new Map(), availMask: allMask, gapsList: [], incumbent: null,
  };

  let best = null;
  let centersVisited = 0;
  for (const center of centers) {
    if (budget.exhausted) break;
    centersVisited += 1;
    const ctx = {
      ...base, center, cum: recoveryTable(center.timeline), memo: new Map(),
      centerKey: centerFingerprint(center),
    };
    const res = dfs(ctx, 0, center.used, cfg.assistPoints, []);
    if (!res || res === PRUNED) continue;
    // 补位等价替换（§6.8 第 5 条）：白板换成字典序更小的 charId，值不变；必须在算 usedMask 之前做
    upgradeFillers(ops, { picks: res.picks, center });
    const used = res.picks.reduce(
      (m, p) => union(m, union(union(p.crewA, p.crewB || EMPTY), union(p.fillCrewA || EMPTY, p.fillCrewB || EMPTY))),
      center.used,
    );
    const metrics = metricsOf({ score: res.score, usedCount: sizeOf(used) });
    const cand = { score: res.score, metrics, center, catRes: res.catRes, usedMask: used, picks: res.picks };
    if (!best || comparePlans(metrics, best.metrics, cfg) > 0) best = cand;
    // 跨中枢现任（P5）：下一条中枢就能用上，弱中枢会更早被剪
    if (!base.incumbent || comparePlans(metrics, base.incumbent, cfg) > 0) base.incumbent = metrics;
  }

  // 未收敛候选只在"上界仍能威胁最终方案"时才算数（真实值 ≤ 上界）：
  // 否则它不可能赢，忽略是合法的，而不是掩盖。
  const unresolvedAll = base.unresolvedList || [];
  const finalScore = best ? best.score : null;
  const tolU = cfg.limits.valueTol;
  const unresolvedThreats = finalScore
    ? unresolvedAll.filter((u) => {
      const v = finalScore[u.cat] ?? 0;
      return u.bound >= v - tolU;
    })
    : unresolvedAll;
  const budgetUnresolved = unresolvedThreats.length;

  // 只提供"搜索是否完整跑完"这个**事实**，不提供任何"最优"结论：
  // 最优性验证在 tools/test 下对照穷举参考求解器完成（certifyLayout 也仅供测试调用）。
  const searchComplete = !budget.exhausted && budgetUnresolved === 0 && !approximations.size;
  const stopReason = budget.nodeExhausted ? 'node-budget'
    : budget.timeExhausted ? 'time-budget'
      : budgetUnresolved > 0 ? 'non-converged-candidate'
        : approximations.size ? 'approximation-applied'
          : 'complete';
  return {
    plan: best,
    status: {
      searchComplete,
      stopReason,
      centersVisited,
      centersTotal: centers.length,
      nodes: budget.nodes,
      nodeLimit: budget.limit,
      timeLimitMs: budget.msLimit,
      simulated: counters.simulated,
      evaluated: counters.evaluated,
      unresolved: budgetUnresolved,
      unresolvedAll: unresolvedAll.length,
      approximations: [...approximations],
      gaps: [...new Map(base.gapsList.map((g) => [`${g.cat}|${g.reason}|${g.detail}`, g])).values()],
      // 观测（P0）：只报告事实，不参与任何判断
      search: { ...counters },
      assistOn: !!cfg.assistOn,
    },
  };
}
