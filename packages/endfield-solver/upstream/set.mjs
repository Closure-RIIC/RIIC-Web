/**
 * 位掩码集合：32 人以上，用 BigInt 表示（JS 位运算是 32 位有符号整数，单个 1<<index 不够）
 * 对外只暴露这几个操作，集中实现便于测试。
 */

export const EMPTY = 0n;
export const FULL = (n) => (1n << BigInt(n)) - 1n;

export const bit = (i) => 1n << BigInt(i);
export const add = (m, i) => m | bit(i);
export const remove = (m, i) => m & ~bit(i);
export const has = (m, i) => (m & bit(i)) !== 0n;
export const union = (a, b) => a | b;
export const inter = (a, b) => a & b;
export const without = (a, b) => a & ~b;
export const isEmpty = (m) => m === 0n;
export const intersects = (a, b) => (a & b) !== 0n;
export const diff = (a, b) => a & ~b;

export function sizeOf(m) {
  let c = 0;
  let x = m;
  while (x) { x &= x - 1n; c += 1; }
  return c;
}

export function toIndices(m) {
  const out = [];
  let i = 0;
  let x = m;
  while (x) {
    if (x & 1n) out.push(i);
    x >>= 1n;
    i += 1;
  }
  return out;
}

export function fromIndices(list) {
  let m = 0n;
  for (const i of list) m |= bit(i);
  return m;
}

/** 所有 size ≤ k 的子集（返回掩码数组），按位序稳定 */
export function subsetsUpTo(n, k) {
  const out = [EMPTY];
  const rec = (start, cur, depth) => {
    if (depth === k) return;
    for (let i = start; i < n; i++) {
      const next = add(cur, i);
      out.push(next);
      rec(i + 1, next, depth + 1);
    }
  };
  rec(0, EMPTY, 0);
  return out;
}

/** 给定可用集合与上限 k，枚举其所有 size ≤ k 的子集 */
export function subsetsOfMask(mask, k) {
  const idx = toIndices(mask);
  const out = [EMPTY];
  const rec = (start, cur, depth) => {
    if (depth === k) return;
    for (let j = start; j < idx.length; j++) {
      const next = add(cur, idx[j]);
      out.push(next);
      rec(j + 1, next, depth + 1);
    }
  };
  rec(0, EMPTY, 0);
  return out;
}

/** 恰好 size = k 的子集（返回掩码数组）；k 超过集合大小则返回空 */
export function subsetsOfSize(mask, k) {
  const idx = toIndices(mask);
  const out = [];
  if (k < 0 || k > idx.length) return out;
  const rec = (start, cur, depth) => {
    if (depth === k) { out.push(cur); return; }
    for (let j = start; j <= idx.length - (k - depth); j++) {
      rec(j + 1, add(cur, idx[j]), depth + 1);
    }
  };
  rec(0, EMPTY, 0);
  return out;
}
