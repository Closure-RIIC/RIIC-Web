import { manualTemplate, type Assignment, type Result, type Workspace } from "@riic/endfield-solver/model.mjs";
import { MFG_LAYOUTS, operatorEffects } from "@riic/endfield-solver/simulation.mjs";
import type {
  EffectTable, RoomEffectResolver, RoomEffects, StepBoostConfig, StepBoostEntry, StepConfig, StepRoom, StepRoomKey, StepRoomKind,
} from "./step-types.ts";

/** 舱室显示名。key 本身仍是求解器的 `中枢/会客室/制造舱1/制造舱2/培养舱`。 */
const LABELS: Record<StepRoomKey, string> = {
  中枢: "总控中枢",
  会客室: "会客室",
  制造舱1: "制造舱 Ⅰ",
  制造舱2: "制造舱 Ⅱ",
  培养舱: "培养舱",
};

const KINDS: Record<StepRoomKey, StepRoomKind> = {
  中枢: "center", 会客室: "guest", 制造舱1: "mfg", 制造舱2: "mfg", 培养舱: "grow",
};

/** 显示用的舱室 key → `ship-data` 里的房间名（技能效果用这一列匹配）。 */
const SOLVER_ROOMS: Record<StepRoomKey, "中枢" | "制造舱" | "培养舱" | "会客室"> = {
  中枢: "中枢", 会客室: "会客室", 制造舱1: "制造舱", 制造舱2: "制造舱", 培养舱: "培养舱",
};

/** 旧步进页的默认换班时刻：中枢 13 点，其余 14 点。 */
const DEFAULT_HOURS: Record<StepRoomKey, number> = {
  中枢: 13, 会客室: 14, 制造舱1: 14, 制造舱2: 14, 培养舱: 14,
};

const STEP_KEYS: StepRoomKey[] = ["中枢", "会客室", "制造舱1", "制造舱2", "培养舱"];

function isStepRoomKey(value: string): value is StepRoomKey {
  return (STEP_KEYS as string[]).includes(value);
}

export function clampHour(value: unknown, fallback: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(23, Math.max(1, number));
}

export function clampMood(value: unknown, fallback = 100): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(100, Math.max(0, Math.round(number)));
}

/** 制造舱产物由 `options.mfg` 决定；培养舱由 `options.grow` 里非 0 的槽决定。 */
export function productsFor(key: StepRoomKey, options: Workspace["options"]): string[] {
  if (key === "中枢") return [];
  if (key === "会客室") return ["线索"];
  if (key === "培养舱") return Object.keys(options.grow).filter(kind => (options.grow[kind] ?? 0) > 0);
  const layout = MFG_LAYOUTS[options.mfg] ?? MFG_LAYOUTS["1干员1武器"];
  return [key === "制造舱1" ? layout[0] : layout[1]];
}

function emptyCrew(slots: number): (string | null)[] {
  return Array.from({ length: Math.max(0, slots) }, () => null);
}

function baseRoom(key: StepRoomKey, slots: number, workspace: Workspace): StepRoom {
  return {
    key, label: LABELS[key], kind: KINDS[key], slots,
    hour: DEFAULT_HOURS[key], single: true, products: productsFor(key, workspace.options),
    enabled: true, crewA: emptyCrew(slots), crewB: emptyCrew(slots),
  };
}

/** 把名单裁到工位数，并丢弃已不在名单里的干员。 */
function fitCrew(names: readonly string[] | undefined, slots: number, owned: ReadonlySet<string>): (string | null)[] {
  return Array.from({ length: Math.max(0, slots) }, (_, index) => {
    const name = names?.[index];
    return typeof name === "string" && name && owned.has(name) ? name : null;
  });
}

/** 只在 `options` 合法时生成骨架；异常配置返回空数组，界面显示提示而不是崩溃。 */
function roomTemplate(workspace: Workspace): Assignment[] {
  try { return manualTemplate(workspace.options); }
  catch { return []; }
}


/** 从手动草稿导入；B 班为空视为单班循环。 */
export function roomsFromManual(workspace: Workspace): StepRoom[] {
  const owned = new Set(workspace.operators.map(operator => operator.name));
  const manual = new Map((workspace.manual ?? []).map(room => [room.key, room] as const));
  return roomTemplate(workspace).flatMap(template =>
    isStepRoomKey(template.key) ? [baseRoom(template.key, template.slots, workspace)] : [])
    .map(room => {
    const entry = manual.get(room.key);
    if (!entry) return room;
    const crewA = fitCrew(entry.a, room.slots, owned);
    const crewB = fitCrew(entry.b, room.slots, owned);
    return { ...room, hour: clampHour(entry.hour, room.hour), single: !crewB.some(Boolean), crewA, crewB };
  });
}




/** 名单里每人一份技能效果，供界面与引擎共用。 */
export function effectTable(workspace: Workspace): EffectTable {
  const table: EffectTable = {};
  for (const operator of workspace.operators) table[operator.name] = operatorEffects(operator);
  return table;
}

/** 把技能效果聚合成 `crewStats` 使用的三个量；按 name|room 记忆化。 */
export function roomEffectResolver(table: EffectTable): RoomEffectResolver {
  const cache = new Map<string, RoomEffects>();
  return (name, roomKey) => {
    const id = `${name}|${roomKey}`;
    const cached = cache.get(id);
    if (cached) return cached;
    const solverRoom = SOLVER_ROOMS[roomKey];
    const effects: RoomEffects = { reduce: 0, restore: 0, effMap: {} };
    for (const effect of table[name] ?? []) {
      if (effect.room !== solverRoom) continue;
      if (effect.kind === "减免") effects.reduce += effect.value;
      else if (effect.kind === "恢复") effects.restore += effect.value;
      else if (effect.cat) effects.effMap[effect.cat] = (effects.effMap[effect.cat] ?? 0) + effect.value;
    }
    cache.set(id, effects);
    return effects;
  };
}

export function createBoostEntry(index: number): StepBoostEntry {
  return { hour: index === 0 ? 12 : 18, minute: 0, target: null };
}

/**
 * 助力默认值：只有开启“中枢助力”才有 2 点/日。
 * 有自动方案时，用当天 `assist.cycle[0]` 预填目标（时间仍是默认值）。
 */
export function defaultBoost(workspace: Workspace, result?: Result | null): StepBoostConfig {
  const dailyCount: 0 | 1 | 2 = workspace.options.assist ? 2 : 0;
  const list = Array.from({ length: dailyCount }, (_, index) => createBoostEntry(index));
  const targets = (result?.rooms ?? [])
    .flatMap(room => room.assist?.cycle?.[0] ?? [])
    .filter((name, index, all) => all.indexOf(name) === index);
  targets.slice(0, dailyCount).forEach((name, index) => { list[index].target = name; });
  return { dailyCount, currentDay: 0, days: [{ list }] };
}

/** 模拟起点到结束跨了几个自然日（最多 5 天，与旧页一致）。 */
export function maxBoostDays(startHour: number, maxHours: number): number {
  return Math.min(5, Math.max(1, Math.ceil((startHour + maxHours) / 24)));
}

/** 补齐/裁剪天数与每天的助力条目，保证界面永远拿到完整的 `days[0..n-1]`。 */
export function ensureBoostDays(boost: StepBoostConfig, days: number): StepBoostConfig {
  const count = Math.max(1, Math.min(5, days));
  const normalized = boost.days.slice(0, count).map(day => {
    const list = day.list.slice(0, boost.dailyCount);
    while (list.length < boost.dailyCount) list.push(createBoostEntry(list.length));
    return { list };
  });
  while (normalized.length < count) {
    normalized.push({ list: Array.from({ length: boost.dailyCount }, (_, index) => createBoostEntry(index)) });
  }
  return { ...boost, currentDay: Math.min(boost.currentDay, count - 1), days: normalized };
}



export { LABELS as STEP_ROOM_LABELS, STEP_KEYS };
