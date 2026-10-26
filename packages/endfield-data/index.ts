import data from "./catalog.json";
export { default as workbenchArtwork } from "./workbench.json";
export { compareOperatorRelease } from "./operator-releases";

export type DisplayOperator = (typeof data.operators)[keyof typeof data.operators];
export type DisplayWeapon = (typeof data.weapons)[keyof typeof data.weapons];
/** catalog.json 里的一条技能记录；`unlock` 是真实的精英化解锁要求。 */
export type DisplaySkill = DisplayOperator["skills"][number];
export const operators: Record<string, DisplayOperator> = data.operators;
export const weapons: Record<string, DisplayWeapon> = data.weapons;
const byName = new Map(Object.values(operators).flatMap(op => [[op.name, op], [op.enName, op]] as const));
export function operatorData(idOrName: string): DisplayOperator | undefined { return operators[idOrName] ?? byName.get(idOrName); }
export function weaponData(id: string): DisplayWeapon | undefined { return weapons[id]; }

// ---------------------------------------------------------------------------
// 界面侧的统一入口：显示用数据一律来自 catalog.json，不读求解器的 ship-data。
// ---------------------------------------------------------------------------

/** 全部干员，用于名单弹窗、技能 wiki 等需要遍历的地方。 */
export const operatorCatalog: DisplayOperator[] = Object.values(operators);

/** 节点 ID 里的槽位与档位：spaceship_skill_<charId>_<slot>_<level>。 */
export function skillNodeSlotLevel(nodeId: string | undefined): { slot: number; level: number } | null {
  const match = nodeId ? /^spaceship_skill_(.+)_(\d+)_(\d+)$/.exec(nodeId) : null;
  if (!match) return null;
  return { slot: Number(match[2]), level: Number(match[3]) };
}

/** 界面用的技能档位：补上从节点 ID 解析的槽位/档位，`unlock` 直接取 catalog 的值。 */
export type DisplaySkillTier = DisplaySkill & { nodeId: string; slot: number; level: number };

/**
 * 按干员名（或 ID）取技能档位——界面判断“这一档要不要精英化”的唯一来源。
 * 槽位、档位、解锁要求都来自 catalog.json，不需要再用求解器的数据覆盖。
 */
export function skillTiersOf(idOrName: string): DisplaySkillTier[] {
  const operator = operatorData(idOrName);
  if (!operator) return [];
  return operator.skills.flatMap(skill => {
    const parsed = skillNodeSlotLevel(skill.id);
    return parsed && skill.unlock !== null && Number.isFinite(skill.unlock)
      ? [{ ...skill, nodeId: skill.id, slot: parsed.slot, level: parsed.level }]
      : [];
  });
}
