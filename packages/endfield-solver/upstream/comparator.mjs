/**
 * 同分裁决（ADR 0002：两级 + 首遇）
 * =============================================================
 * 产出完全相同时只比两件事：
 *   ① 整份布局占用的人数（越少越好）
 *   ② 人数也相同 ⇒ **打平**，由调用方保留"先遇到"的那一个
 *
 * 中枢需求、班长、`charId`、占用串一律不参与裁决。理由与代价见
 * `docs/adr/0002-flatten-tie-breaking.md`：那几级只在"产量相同、人数相同"时起作用，
 * 保留它们会迫使搜索留下大量"产量相同、只是换了人"的等价候选。
 */

export const VALUE_TOL = 1e-9;

/**
 * plan/metrics: `{ score, usedCount }`
 * 返回 > 0 表示 a 更优，< 0 表示 b 更优，0 表示打平（调用方保留先遇到的）。
 */
export function comparePlans(a, b, cfg) {
  const tol = (cfg && cfg.limits ? cfg.limits.valueTol : VALUE_TOL);

  // 1) 产出向量（字典序，越大越好）
  for (let i = 0; i < a.score.length; i++) {
    if (Math.abs(a.score[i] - b.score[i]) <= tol) continue;
    return a.score[i] > b.score[i] ? 1 : -1;
  }
  // 2) 占用人数（越少越好）
  if (a.usedCount !== b.usedCount) return a.usedCount < b.usedCount ? 1 : -1;
  // 3) 打平：不设第三级（首遇由调用方保证）
  return 0;
}
