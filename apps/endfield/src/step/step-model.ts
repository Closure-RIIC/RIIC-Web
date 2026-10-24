import { manualTemplate, type Assignment, type Result, type Workspace } from "@riic/endfield-solver/model.mjs";
import { MFG_LAYOUTS, operatorEffects } from "@riic/endfield-solver/simulation.mjs";
import type {
  EffectTable, RoomEffectResolver, RoomEffects, StepBoostConfig, StepBoostEntry, StepConfig, StepRoom, StepRoomKey, StepRoomKind,
} from "./step-types.ts";

export type ImportSource = "manual" | "result" | "template";

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

/** 只按设施配置生成舱室，不带任何名单。 */
export function roomsFromTemplate(workspace: Workspace): StepRoom[] {
  return roomTemplate(workspace).flatMap(template =>
    isStepRoomKey(template.key) ? [baseRoom(template.key, template.slots, workspace)] : []);
}

/** 从手动草稿导入；B 班为空视为单班循环。 */
export function roomsFromManual(workspace: Workspace): StepRoom[] {
  const owned = new Set(workspace.operators.map(operator => operator.name));
  const manual = new Map((workspace.manual ?? []).map(room => [room.key, room] as const));
  return roomsFromTemplate(workspace).map(room => {
    const entry = manual.get(room.key);
    if (!entry) return room;
    const crewA = fitCrew(entry.a, room.slots, owned);
    const crewB = fitCrew(entry.b, room.slots, owned);
    return { ...room, hour: clampHour(entry.hour, room.hour), single: !crewB.some(Boolean), crewA, crewB };
  });
}

/** 从最近一次求解结果导入（自动或手动评估都适用）。 */
export function roomsFromResult(workspace: Workspace, result: Result | null): StepRoom[] {
  if (!result?.center) return roomsFromManual(workspace);
  const owned = new Set(workspace.operators.map(operator => operator.name));
  const center = result.center;
  return roomsFromTemplate(workspace).map(room => {
    if (room.key === "中枢") {
      return {
        ...room, hour: clampHour(center.hour, room.hour), single: false,
        crewA: fitCrew(center.a, room.slots, owned), crewB: fitCrew(center.b, room.slots, owned),
      };
    }
    const plan = result.rooms.find(item => item.key === room.key);
    if (!plan) return { ...room, single: true };
    const crewA = fitCrew(plan.a, room.slots, owned);
    const crewB = fitCrew(plan.b, room.slots, owned);
    // 单班方案的 hour 是 24（没有换班），回退到默认时刻而不是压成 23。
    const hour = plan.hour >= 1 && plan.hour <= 23 ? plan.hour : room.hour;
    return { ...room, hour, single: plan.single || !crewB.some(Boolean), crewA, crewB };
  });
}

/** 默认数据来源：手动草稿有内容优先，其次最近结果，最后设施骨架。 */
export function defaultSource(workspace: Workspace, result: Result | null): ImportSource {
  if ((workspace.manual ?? []).some(room => room.a.some(Boolean) || room.b.some(Boolean))) return "manual";
  if (result?.center) return "result";
  return "template";
}

export function buildStepConfig(workspace: Workspace, result: Result | null, source: ImportSource): StepConfig {
  const rooms = source === "result" ? roomsFromResult(workspace, result)
    : source === "manual" ? roomsFromManual(workspace)
      : roomsFromTemplate(workspace);
  return { rooms, moods: {}, work: {}, boost: defaultBoost(workspace, result) };
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
      else if (effect.kind === "加成" && effect.cat) effects.effMap[effect.cat] = (effects.effMap[effect.cat] ?? 0) + effect.value;
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

/** 当前所有舱室已排班的干员名（助力目标只能从这里选）。 */
export function scheduledNames(rooms: readonly StepRoom[]): Set<string> {
  const names = new Set<string>();
  for (const room of rooms) {
    for (const name of room.crewA) if (name) names.add(name);
    if (!room.single) for (const name of room.crewB) if (name) names.add(name);
  }
  return names;
}

/** 换班时刻的合法性；返回给界面显示的中文错误。 */
export function validateStepConfig(config: StepConfig, owned: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const room of config.rooms) {
    if (!room.enabled) continue;
    if (!Number.isInteger(room.hour) || room.hour < 1 || room.hour > 23) problems.push(`${room.label}：换班时刻必须是 1–23 的整点`);
    const crews: [string, (string | null)[]][] = room.single ? [["A", room.crewA]] : [["A", room.crewA], ["B", room.crewB]];
    for (const [shift, crew] of crews) {
      for (const name of crew) {
        if (!name) continue;
        if (!owned.has(name)) { problems.push(`${room.label} ${shift} 班：${name} 不在名单中`); continue; }
        if (seen.has(name)) problems.push(`干员「${name}」被重复排班`);
        seen.add(name);
      }
    }
  }
  return problems;
}

export { LABELS as STEP_ROOM_LABELS, STEP_KEYS };
