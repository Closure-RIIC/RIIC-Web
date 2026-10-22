/**
 * 干员的基建技能解锁判定——全站唯一口径。
 *
 * 名单里只维护一个字段：`latestSpaceshipSkillNodes`，与森空岛
 * `talent.latestSpaceshipSkillNodes` 同名同义——**每个技能槽只存该槽当前的最高档**，
 * 形如 `spaceship_skill_chr_0004_pelica_1_2`（槽 1 第 2 档）。
 * 它与精英化等级互相独立：精英化只是解锁前提，玩家可以不点。
 *
 * 两种使用方式：
 *   · 求解器：直接读 `latestSpaceshipSkillNodes`（生效的本来就是最高档）；
 *   · 界面：调用 `unlockedSkillNodes()` 展开低档，用于"已解锁/未解锁"标记。
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

/** 名单条目里与技能解锁相关的部分 */
export interface SkillRosterEntry {
  elite: number;
  latestSpaceshipSkillNodes?: string[];
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
 * 某个干员**已解锁**的全部技能节点（含低档）。
 *
 * `latestSpaceshipSkillNodes` 只给每个槽的最高档（例如 `1_2` 而不是 `1_1`），
 * 而高档解锁意味着同槽低档也已解锁，所以这里把 `level ≤ 最高档` 的节点全部展开。
 * 技能查询页、名单弹窗等"看解锁状态"的地方直接用这个结果。
 *
 * - `latestSpaceshipSkillNodes` 是数组 → 以此为准（`[]` 表示一个都没解锁）；
 * - 缺省 → 没有账号数据，按 elite 回退估算（每槽取 unlock ≤ elite 的最高档及其低档）。
 */
export function unlockedSkillNodes(
  skills: readonly SkillTierLike[],
  entry: SkillRosterEntry,
): string[] {
  const valid = new Set(skills.map(skillNodeId));
  const nodes = entry.latestSpaceshipSkillNodes;

  if (Array.isArray(nodes)) {
    return expandDowngrades(skills, new Set(nodes.filter((id) => valid.has(id))));
  }

  const best = new Map<number, SkillTierLike>();
  for (const skill of skills) {
    const slot = slotOf(skill);
    if (slot <= 0) continue;
    if ((Number.isFinite(skill.unlock) ? (skill.unlock as number) : 0) > entry.elite) continue;
    const current = best.get(slot);
    if (!current || levelOf(skill) > levelOf(current)) best.set(slot, skill);
  }
  return expandDowngrades(skills, new Set([...best.values()].map(skillNodeId)));
}

/** 槽位与档位：优先用字段，缺失时从节点 ID 解析（catalog 里的技能只带 nodeId/unlock） */
function slotOf(skill: SkillTierLike): number {
  if (skill.slot && skill.slot > 0) return skill.slot;
  return parseSkillNodeId(skillNodeId(skill))?.slot ?? 0;
}

function levelOf(skill: SkillTierLike): number {
  if (typeof skill.level === "number" && skill.level > 0) return skill.level;
  return parseSkillNodeId(skillNodeId(skill))?.level ?? 0;
}

/** 补充：同一槽里低于「已解锁最高档」的节点也算解锁 */
function expandDowngrades(skills: readonly SkillTierLike[], unlocked: Set<string>): string[] {
  const ceiling = new Map<number, number>();
  for (const skill of skills) {
    const slot = slotOf(skill);
    if (slot <= 0 || !unlocked.has(skillNodeId(skill))) continue;
    ceiling.set(slot, Math.max(ceiling.get(slot) ?? 0, levelOf(skill)));
  }
  for (const skill of skills) {
    const slot = slotOf(skill);
    if (slot <= 0) continue;
    const top = ceiling.get(slot);
    if (top === undefined) continue;
    if (levelOf(skill) <= top) unlocked.add(skillNodeId(skill));
  }
  return [...unlocked].sort((a, b) => {
    const left = parseSkillNodeId(a), right = parseSkillNodeId(b);
    return (left?.slot ?? 0) - (right?.slot ?? 0) || (left?.level ?? 0) - (right?.level ?? 0);
  });
}

/**
 * 求解/接力用的节点：每槽只取最高档。
 * 名单里的 `latestSpaceshipSkillNodes` 本来就是最高档，所以这一步通常原样返回；
 * 只有旧存档混入了低档时才会收敛。
 */
export function effectiveSkillNodes(
  skills: readonly SkillTierLike[],
  entry: SkillRosterEntry,
): string[] {
  const unlocked = new Set(unlockedSkillNodes(skills, entry));
  const top = new Map<number, SkillTierLike>();
  for (const skill of skills) {
    const slot = slotOf(skill);
    if (slot <= 0 || !unlocked.has(skillNodeId(skill))) continue;
    const current = top.get(slot);
    if (!current || levelOf(skill) > levelOf(current)) top.set(slot, skill);
  }
  return [...top.values()].map(skillNodeId).sort();
}

/** 判断某个节点是否已解锁（界面灰化用） */
export function isSkillNodeUnlocked(nodes: readonly string[], nodeId: string): boolean {
  return nodes.includes(nodeId);
}

/**
 * 点击一个节点后新的 `latestSpaceshipSkillNodes`。
 *
 * 判断依据是**状态里存的档位**（不是"是否已解锁"）：
 *   ① 该槽存的正是这个节点 → 降档：有更低一档就换成更低档，已经是最低档就删掉该槽；
 *   ② 该槽存的是同槽别的节点 → 直接换成这个节点；
 *   ③ 该槽没有节点 → 加入（解锁到这一档）。
 * 返回值保持"每槽最多一个"，并按槽排序。
 */
export function toggleSkillNode(
  skills: readonly SkillTierLike[],
  current: readonly string[],
  nodeId: string,
): string[] {
  const target = parseSkillNodeId(nodeId);
  // 只接受该干员技能表里真实存在的节点，避免异名/脏数据写进名单
  if (!target || !skills.some((skill) => skillNodeId(skill) === nodeId)) return [...current];
  const slot = target.slot;
  const sameSlot = current.filter((id) => parseSkillNodeId(id)?.slot === slot);
  const stored = sameSlot[0];
  const others = current.filter((id) => parseSkillNodeId(id)?.slot !== slot);

  // ① 点击已存的那一档：降到更低一档；已经是最低档则取消该槽
  if (stored === nodeId) {
    if (target.level > 1) return sortNodes([...others, slotNodeId(skills, slot, target.level - 1)]);
    return sortNodes(others);
  }
  // ② 同槽换档 / ③ 槽内原本没有节点：统一换成点击的这一档
  return sortNodes([...others, nodeId]);
}

/**
 * 精英化变化后修正技能：每个槽若当前档位超出新精英化的解锁能力，
 * 就降到该槽 unlock ≤ 新精英化 的最高档；一档都解锁不了则删掉该槽。
 * 调高精英化不补技能。
 */
export function reconcileSkillNodes(
  skills: readonly SkillTierLike[],
  current: readonly string[],
  elite: number,
): string[] {
  const next: string[] = [];
  const slots = new Set<number>();
  for (const id of current) {
    const parsed = parseSkillNodeId(id);
    if (parsed) slots.add(parsed.slot);
  }
  for (const slot of slots) {
    const options = skills
      .filter((skill) => parseSkillNodeId(skillNodeId(skill))?.slot === slot)
      .sort((a, b) => (parseSkillNodeId(skillNodeId(b))?.level ?? 0) - (parseSkillNodeId(skillNodeId(a))?.level ?? 0));
    const allowed = options.filter((skill) => (Number.isFinite(skill.unlock) ? (skill.unlock as number) : 0) <= elite);
    if (!allowed.length) continue;
    const stored = current.find((id) => parseSkillNodeId(id)?.slot === slot);
    const storedLevel = stored ? parseSkillNodeId(stored)?.level ?? 0 : 0;
    const pick = options.find((skill) => {
      const level = parseSkillNodeId(skillNodeId(skill))?.level ?? 0;
      return level <= storedLevel && allowed.includes(skill);
    }) ?? allowed[0];
    next.push(skillNodeId(pick));
  }
  return sortNodes(next);
}

/**
 * 精英化变化后实际需要的精英化：点击的技能档位若要求更高的精英化，
 * 自动提到该档位的要求值（降低精英化由 reconcileSkillNodes 处理）。
 */
export function requiredElite(skills: readonly SkillTierLike[], nodes: readonly string[], elite: number): number {
  let required = elite;
  for (const id of nodes) {
    const skill = skills.find((item) => skillNodeId(item) === id);
    const unlock = skill && Number.isFinite(skill.unlock) ? (skill.unlock as number) : 0;
    if (unlock > required) required = unlock;
  }
  return required;
}

/** 取某槽某一档的节点 ID（找不到时退回同槽最高档） */
function slotNodeId(skills: readonly SkillTierLike[], slot: number, level: number): string {
  const exact = skills.find((skill) => {
    const parsed = parseSkillNodeId(skillNodeId(skill));
    return parsed?.slot === slot && parsed.level === level;
  });
  if (exact) return skillNodeId(exact);
  const sameSlot = skills
    .filter((skill) => parseSkillNodeId(skillNodeId(skill))?.slot === slot)
    .sort((a, b) => (parseSkillNodeId(skillNodeId(b))?.level ?? 0) - (parseSkillNodeId(skillNodeId(a))?.level ?? 0));
  return sameSlot.length ? skillNodeId(sameSlot[0]) : "";
}

function sortNodes(nodes: readonly string[]): string[] {
  return nodes.filter((id) => parseSkillNodeId(id)).sort((a, b) => {
    const left = parseSkillNodeId(a), right = parseSkillNodeId(b);
    return (left?.slot ?? 0) - (right?.slot ?? 0) || (left?.level ?? 0) - (right?.level ?? 0);
  });
}

/**
 * 名单里某人的 `latestSpaceshipSkillNodes`；没有该字段时返回 undefined（走精英化回退）。
 */
export function accountSkillNodes(
  roster: readonly ({ name: string } & SkillRosterEntry)[],
  name: string,
): string[] | undefined {
  return roster.find((entry) => entry.name === name)?.latestSpaceshipSkillNodes;
}
