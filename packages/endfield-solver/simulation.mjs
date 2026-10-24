/**
 * 帝江号「步进模拟」的公共数据边界。
 *
 * 模拟页需要的是“某个干员在某个舱室提供多少效率/减免/恢复”，
 * 这恰好就是求解器 `prepare()` 已经归一化过的技能档位。
 * 这里把同一份数据以只读方式暴露给界面，避免第二套技能表或第二套数值口径。
 *
 * 归并规则与 `upstream/evaluator.mjs` 的 `val()` 完全一致：
 * 同一 `(room, kind, cat)` 只取最大值。`normalizeShipSkills` 按 `(…, unlock)`
 * 去重，所以低档与高档会同时存在，直接相加会把 8% + 12% 算成 20%。
 */

import raw from "./data/ship-data.json" with { type: "json" };
import { loadShipData, skillsAtElite, skillsAtNodes } from "./upstream/ship-data.mjs";
import { MFG_LAYOUTS } from "./upstream/config.mjs";
import { ASSIST_MOOD, CENTER_CAP, COST_BASE, HEAD, REC_BASE, SLOTS } from "./upstream/evaluator.mjs";

const data = loadShipData(raw);

export { MFG_LAYOUTS };

/** 模拟使用的速率常量；与求解器共用同一组数字，测试锁定相等。 */
export const SIM_RATES = Object.freeze({
  /** 每小时心情消耗（未计减免） */
  work: COST_BASE,
  /** 每小时心情恢复（未计中枢加成） */
  rest: REC_BASE,
  /** 每人带来的基础产出加成 */
  head: HEAD,
  /** 每次中枢助力恢复的心情 */
  assist: ASSIST_MOOD,
  /** 单个舱室的工位数上限 */
  slots: SLOTS,
  /** 中枢恢复加成的最长有效时长（小时），仅用于和求解器对照 */
  centerCapHours: CENTER_CAP,
});

/**
 * 某干员“当前已解锁”的技能效果，每个 `(room|kind|cat)` 只保留最高档。
 *
 * - `latestSpaceshipSkillNodes` 是数组 → 以实际解锁的节点为准（`[]` 表示一个都没解锁）；
 * - 缺省 → 没有账号数据，按 `elite` 回退。
 *
 * @param {{ name?: string, elite?: number, latestSpaceshipSkillNodes?: string[] }} operator
 * @returns {{ room: string, kind: string, cat?: string, value: number, tier?: string, unlock: number, nodeId?: string, slot?: number|null, level?: number|null }[]}
 */
export function operatorEffects(operator) {
  const record = data.byName.get(operator?.name);
  if (!record) return [];
  const unlocked = Array.isArray(operator.latestSpaceshipSkillNodes)
    ? skillsAtNodes(record.skills, operator.latestSpaceshipSkillNodes)
    : skillsAtElite(record.skills, Number.isInteger(operator.elite) ? operator.elite : 0);
  const best = new Map();
  for (const skill of unlocked) {
    const key = `${skill.room}|${skill.kind}|${skill.cat ?? ""}`;
    const previous = best.get(key);
    if (!previous || skill.value > previous.value) best.set(key, skill);
  }
  return [...best.values()];
}

/** 干员是否有可排班的基建技能（用于界面的“无技能”提示）。 */
export function hasShipSkills(name) {
  const record = data.byName.get(name);
  return !!record && record.skills.length > 0;
}
