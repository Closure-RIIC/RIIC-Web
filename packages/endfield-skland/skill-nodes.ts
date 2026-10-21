/**
 * 干员的基建技能解锁判定——全站唯一口径。
 *
 * 森空岛返回的 `talent.latestSpaceshipSkillNodes` 是**玩家实际解锁的最高档节点**，
 * 形如 `spaceship_skill_chr_0004_pelica_1_2`（槽 1 第 2 档）。
 * 它与精英化等级**互相独立**：精英化只是解锁前提，玩家可以不点。
 *
 * 三种输入：
 *   · `skillIds` 是数组 → 以此为准（`[]` 表示确实一个都没解锁）；
 *   · `skillIds` 缺省（undefined）→ 没有账号数据，按 elite 回退估算；
 *   · 两者都没有 → 空。
 *
 * 纯函数、零依赖：求解器与界面共用，避免"页面显示已解锁、求解器按未解锁算"。
 */

/** 解析技能节点所需的最小字段 */
export interface SkillTierLike {
  nodeId?: string;
  slot?: number | null;
  level?: number | null;
  unlock?: number;
  charId?: string;
}

/** 节点 ID 里的槽位与档位：spaceship_skill_<charId>_<slot>_<level> */
export function parseSkillNodeId(nodeId: string): { slot: number; level: number } | null {
  const match = /^spaceship_skill_(.+)_(\d+)_(\d+)$/.exec(nodeId);
  if (!match) return null;
  const slot = Number(match[2]);
  const level = Number(match[3]);
  return Number.isInteger(slot) && Number.isInteger(level) ? { slot, level } : null;
}

/** 技能档位 → 节点 ID（用于和森空岛数据对比） */
export function skillNodeId(skill: SkillTierLike): string {
  return skill.nodeId ?? `spaceship_skill_${skill.charId ?? "?"}_${skill.slot}_${skill.level}`;
}

/**
 * 某个干员当前生效的技能节点。
 *
 * @param skills 该干员在求解器数据里的全部技能档位
 * @param skillIds 森空岛给的已解锁节点；undefined 表示没有这份数据
 * @param elite 精英化阶段，仅在 skillIds 缺省时使用
 */
export function resolvedSkillNodes(
  skills: readonly SkillTierLike[],
  skillIds: readonly string[] | undefined,
  elite: number,
): string[] {
  const valid = new Set(skills.map(skillNodeId));

  if (Array.isArray(skillIds)) {
    // 以账号数据为准；只保留该干员真实存在的节点，去重、排序。
    const own = [...new Set(skillIds.filter((id) => valid.has(id)))];
    return own.sort((a, b) => {
      const left = parseSkillNodeId(a), right = parseSkillNodeId(b);
      return (left?.slot ?? 0) - (right?.slot ?? 0) || (left?.level ?? 0) - (right?.level ?? 0);
    });
  }

  // 无账号数据：每个槽取 unlock <= elite 的最高档（与旧的 skillsAtElite 同口径）。
  const best = new Map<number, SkillTierLike>();
  for (const skill of skills) {
    const slot = skill.slot ?? 0;
    if (slot <= 0) continue;
    if ((Number.isFinite(skill.unlock) ? (skill.unlock as number) : 0) > elite) continue;
    const current = best.get(slot);
    if (!current || (skill.level ?? 0) > (current.level ?? 0)) best.set(slot, skill);
  }
  return [...best.values()].map(skillNodeId).sort();
}

/** 判断某个节点是否已解锁（界面灰化用） */
export function isSkillNodeUnlocked(nodes: readonly string[], nodeId: string): boolean {
  return nodes.includes(nodeId);
}

/**
 * 界面侧的便捷口径：名单里某人的 `skillIds`；没有该字段时返回 undefined（走精英化回退）。
 */
export function accountSkillIds(
  roster: readonly { name: string; skillIds?: string[] }[],
  name: string,
): string[] | undefined {
  return roster.find((entry) => entry.name === name)?.skillIds;
}
