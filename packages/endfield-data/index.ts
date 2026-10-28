import data from "./catalog.json";
export { default as workbenchArtwork } from "./workbench.json";
export { compareOperatorRelease } from "./operator-releases";

export type DisplayOperator = (typeof data.operators)[keyof typeof data.operators];
export type DisplayWeapon = (typeof data.weapons)[keyof typeof data.weapons];
/**
 * catalog.json 里的一条技能记录；`unlock` 是真实的精英化解锁要求。
 *
 * `target` / `enTarget` 把效果收窄到一个产物：
 * 制造舱（ManufactureEfficiencyUp）是干员经验 / 武器经验，
 * 培养舱（GrowSpeedUp）是菌类 / 晶植 / 矿物，
 * 线索倾向（ClueProbabilityUp）是「线索 N」并附带 `clueTier`。
 * 其余技能没有目标，这些字段缺省。
 *
 * 单独声明而不是从 JSON 推断：同步脚本会逐步补充字段，类型要能先于数据存在。
 */
export interface DisplaySkill {
  id: string;
  name: string;
  enName: string;
  description: string;
  enDescription: string;
  unlock: number | null;
  roomType: number;
  room: string;
  enRoom: string;
  effectKey: string;
  effectName: string;
  enEffectName: string;
  icon: string;
  targetId?: number;
  target?: string;
  enTarget?: string;
  clueIndex?: number;
  clueTier?: number;
  clueTierName?: string;
  enClueTierName?: string;
}
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

/**
 * 界面用的技能档位。`nodeId` 与 `id` 同值，满足求解器侧 `SkillTierLike` 的形状；
 * 槽位/档位从节点 ID 解析，`unlock` 直接取 catalog 的值。
 */
export type DisplaySkillTier = DisplaySkill & { nodeId: string; slot: number; level: number; unlock: number };

/**
 * 按干员名（或 ID）取技能档位——界面判断“这一档要不要精英化”的唯一来源。
 * 槽位、档位、解锁要求都来自 catalog.json，不需要再用求解器的数据覆盖。
 */
export function skillTiersOf(idOrName: string): DisplaySkillTier[] {
  const tiers: DisplaySkillTier[] = [];
  for (const skill of skillsOf(idOrName)) {
    const parsed = skillNodeSlotLevel(skill.id);
    if (!parsed || skill.unlock === null || !Number.isFinite(skill.unlock)) continue;
    tiers.push({ ...skill, unlock: skill.unlock, nodeId: skill.id, slot: parsed.slot, level: parsed.level });
  }
  return tiers;
}

/** 把一个干员的所有技能按 catalog 视图收窄，供界面遍历（含 target 等新字段）。 */
export function skillsOf(idOrName: string): readonly DisplaySkill[] {
  return (operatorData(idOrName)?.skills ?? []) as readonly DisplaySkill[];
}

/** 全部干员的技能视图：遍历时用，保证每条技能都带 target 等可选字段。 */
export function allSkills(): readonly DisplaySkill[] {
  return operatorCatalog.flatMap(operator => operator.skills as readonly DisplaySkill[]);
}
