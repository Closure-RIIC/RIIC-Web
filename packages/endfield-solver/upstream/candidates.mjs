/**
 * 候选枚举（对齐主逻辑 §6.4–§6.5，说明见 tools/README.md §5）
 *
 * 关键约定：
 *  - 一个"班组"就是恰好填满工位的一组人（白板也算人，§1/§6.4），因此人数恒等于工位数。
 *  - 值只取决于「签名」= (各类加成向量, 减免之和, 人数)；同一签名下**保留全部具体人选 mask**，
 *    这样互斥判断仍然是精确的（不能只留统计量、丢掉身份）。
 *  - 在这里只做"给定签名对 + 班长 h"的闭式取值；联合分配、模拟确认在 optimizer 里做。
 */

import { EMPTY, add, has, sizeOf, subsetsOfMask, toIndices } from './set.mjs';
import { EPS, SLOTS, crewStats, val } from './evaluator.mjs';

/** 该干员对这个设施是否有加成或减免（= 是否属于"相关干员"） */
export function isUseful(op, facility) {
  if (val(op, facility.room, '减免') > 0) return true;
  for (const c of Object.keys(facility.weights)) if (val(op, facility.room, '加成', c) > 0) return true;
  return false;
}

/** 本设施的相关干员集合（限定在 poolMask 内） */
export function relevantMask(ops, facility, poolMask) {
  let m = EMPTY;
  for (const i of toIndices(poolMask)) if (isUseful(ops[i], facility)) m = add(m, i);
  return m;
}

/**
 * 枚举本设施的"班组签名组"。
 * 输入 relMask（相关干员）、seats（工位数）与 sizes（允许的班组人数，默认只有满工位）；
 * 相关干员里取 |S| ≤ n，不足部分由白板补满 —— 白板不影响签名，但**人数 n 进签名**
 * （E = (1+0.4n)(1+b)，同样的人少一个人就是另一个取值）。
 * 返回 [{ sig, st, n, masks }]，masks 为该签名下全部 S 的掩码。
 *
 * 人数可以小于工位数（文档 §6.7 "减少人数"、决策 18）：两班时 nA≥1 ∧ nB≥1，
 * 单班时 nA≥1，都靠这里的 sizes 表达。
 */
export function crewSignatureGroups(ops, facility, relMask, seats, sizes = null) {
  const bySig = new Map();
  const sizesSorted = (sizes || [seats])
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= seats)
    .sort((a, b) => a - b);
  if (!sizesSorted.length) return [];
  // 子集只枚举一次（上限 = 最大人数），再按"|S| ≤ n"分给人数组
  const subs = subsetsOfMask(relMask, sizesSorted[sizesSorted.length - 1]);
  for (const n of sizesSorted) {
    for (const m of subs) {
      if (sizeOf(m) > n) continue;
      const st = crewStats(ops, m, facility, n);
      const sig = Object.keys(facility.weights)
        .map((c) => st.b[c].toFixed(6)).join(',') + `|${st.r.toFixed(6)}|${n}`;
      let g = bySig.get(sig);
      if (!g) { g = { sig, st, n, masks: [] }; bySig.set(sig, g); }
      g.masks.push(m);
    }
  }
  // 稳定顺序：签名按 (加成向量, 减免, 人数) 升序
  return [...bySig.values()].sort((a, b) => (a.sig < b.sig ? -1 : a.sig > b.sig ? 1 : 0));
}

export { SLOTS, EPS };
