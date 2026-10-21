/**
 * 干员数据装载：**唯一数据源 = `data/ship-data.json`**
 * =====================================================================
 * 该文件是从客户端 `TableCfg` 解析出的副本（`meta.tables` 里列了来源表），
 * 干员条目结构：
 *
 *   { charId, name, shipSkills: [
 *       { slot, roomType, roomName, skillId, name, level, postfix,
 *         desc, effect: { key, rate, expTypeName, ... }, unlock? } ] }
 *
 * 这里把 `shipSkills` 归一化成求解器内部的技能档位：
 *   `{ room, kind, cat?, value, tier, unlock }`
 *   - `room`  ← `roomType`（0 中枢 / 1 制造舱 / 2 培养舱 / 3、5 会客室）
 *   - `kind`  ← `effect.key`：`RoomMoodConsumeDown` → 减免、`MoodRecoveryAll` → 恢复、其余 → 加成
 *   - `cat`   ← 加成类按描述里的产物词判：干员经验 / 武器经验 / 菌类 / 晶植 / 矿物（会客室默认「线索」）
 *   - `value` ← `effect.rate`
 *   - `tier`  ← `postfix`（α / β / γ）
 *   - `unlock`← 解锁所需精英化阶段。**客户端主表里才有**，本工作区把它补写进 `shipSkills[].unlock`；
 *               读不到就按 0 处理（= 该档位不设精英化门槛）
 *
 * 概率类技能（`ClueProbabilityUp`）不进确定性模型，直接跳过。
 * 同一 `(room, kind, cat, unlock)` 只留最高值；同一 `(room, kind, cat)` 内按 unlock 升序。
 */

// RIIC browser adapter: the caller supplies parsed data; no filesystem access.

/** 舱室类型 → 求解器内部的 room 名（与 `documents/帝江号设施类型.md` 一致） */
const ROOM_BY_TYPE = { 0: '中枢', 1: '制造舱', 2: '培养舱', 3: '会客室', 5: '会客室' };

/** `effect.key` → 技能种类 */
export function kindOfKey(key) {
  if (key === 'RoomMoodConsumeDown') return '减免';
  if (key === 'MoodRecoveryAll') return '恢复';
  return '加成';
}

/** 加成类技能的产物类别：先看描述，再看舱室默认值 */
export function catOfSkill(kind, desc, room) {
  if (kind !== '加成') return undefined;
  if (/干员经验/.test(desc)) return '干员经验';
  if (/武器经验/.test(desc)) return '武器经验';
  if (/菌类/.test(desc)) return '菌类';
  if (/晶植/.test(desc)) return '晶植';
  if (/矿物/.test(desc)) return '矿物';
  if (room === '会客室') return '线索';
  return undefined;
}

/** 把一个干员的 `shipSkills` 归一化成技能档位（去重 + 排序，口径见文件头） */
export function normalizeShipSkills(shipSkills) {
  const bag = new Map();
  for (const s of shipSkills || []) {
    const effect = s && s.effect;
    if (!effect || effect.key === 'ClueProbabilityUp') continue;   // 概率类不进模型
    const room = ROOM_BY_TYPE[String(s.roomType)];
    if (!room) continue;
    const kind = kindOfKey(effect.key);
    const cat = catOfSkill(kind, s.desc || '', room);
    const value = Number(effect.rate);
    if (!Number.isFinite(value) || value <= 0) continue;
    const rec = { room, kind };
    if (cat) rec.cat = cat;
    rec.value = value;
    rec.tier = s.postfix;
    rec.unlock = Number.isFinite(Number(s.unlock)) ? Number(s.unlock) : 0;
    const key = `${rec.room}|${rec.kind}|${rec.cat || ''}|${rec.unlock}`;
    const prev = bag.get(key);
    if (!prev || rec.value > prev.value) bag.set(key, rec);
  }
  return [...bag.values()].sort((a, b) => (a.room + a.kind + (a.cat || ''))
    .localeCompare(b.room + b.kind + (b.cat || '')) || a.unlock - b.unlock);
}

/** 按精英化阶段过滤技能档：`unlock ≤ elite` 的档位可用（同一 (room,kind,cat) 取最高档由调用方再挑） */
export function skillsAtElite(skills, elite) {
  return (skills || []).filter((s) => (Number.isFinite(s.unlock) ? s.unlock : 0) <= elite);
}

/**
 * 读 `data/ship-data.json`（或 `--data=` 指定同结构文件）。
 * 返回：
 *   · `charIds`  Map<name, charId>
 *   · `byName`   Map<name, { name, charId, skills }>   skills 已归一化
 *   · `names`    有可用技能档的干员名（保持文件顺序）
 *   · `meta`     原文件的 meta（含数据版本，便于追溯）
 */
export function loadShipData(raw) {
  const list = Array.isArray(raw) ? raw : raw.operators;
  if (!Array.isArray(list)) throw new Error('[ship-data] 找不到 operators 数组');
  const charIds = new Map();
  const byName = new Map();
  const names = [];
  for (const o of list) {
    if (!o || typeof o.name !== 'string') continue;
    if (o.charId) charIds.set(o.name, o.charId);
    const skills = normalizeShipSkills(o.shipSkills);
    byName.set(o.name, { name: o.name, charId: o.charId, skills });
    if (skills.length) names.push(o.name);
  }
  return { charIds, byName, names, meta: raw.meta || null };
}
