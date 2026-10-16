import type { MowerFacility, MowerPlanDocument } from "./mower-plan.ts";

export const MOWER_EDITOR_STORAGE_KEY = "riic-web-mower-editor-v1";

export interface MowerEditorDocument extends MowerPlanDocument {
  title: string;
  author: string;
  description: string;
  id: string;
}

export const MOWER_PRODUCTION_KEYS = Array.from({ length: 9 }, (_, index) => (
  `room_${Math.floor(index / 3) + 1}_${index % 3 + 1}`
));

export const MOWER_FIXED_ROOMS = [
  { key: "central", name: "控制中枢", en: "Control Center", column: 4, row: 1, capacity: 5 },
  { key: "meeting", name: "会客室", en: "Reception", column: 5, row: 1, capacity: 2 },
  { key: "dormitory_1", name: "宿舍 1", en: "Dormitory 1", column: 4, row: 2, capacity: 5 },
  { key: "dormitory_2", name: "宿舍 2", en: "Dormitory 2", column: 4, row: 3, capacity: 5 },
  { key: "dormitory_3", name: "宿舍 3", en: "Dormitory 3", column: 4, row: 4, capacity: 5 },
  { key: "dormitory_4", name: "宿舍 4", en: "Dormitory 4", column: 4, row: 5, capacity: 5 },
  { key: "factory", name: "加工站", en: "Workshop", column: 5, row: 2, capacity: 1 },
  { key: "contact", name: "办公室", en: "Office", column: 5, row: 3, capacity: 1 },
  { key: "train", name: "训练室", en: "Training", column: 5, row: 4, capacity: 2 },
  { key: "recycle", name: "回收站", en: "Recycling Station", column: 5, row: 5, capacity: 2 },
] as const;

function facility(name: string, names: string[], product?: string): MowerFacility {
  return { name, plans: names.map((agent) => ({ agent, group: "", replacement: [] })), ...(product ? { product } : {}) };
}

export function createMowerEditorDocument(): MowerEditorDocument {
  return {
    default: "plan1",
    title: "153 示例排班",
    author: "",
    description: "",
    id: "",
    plan1: {
      central: facility("控制中枢", ["阿米娅", "凯尔希", "夕", "焰尾", "薇薇安娜"]),
      meeting: facility("会客室", ["令"]),
      room_1_1: facility("贸易站", ["巫恋", "但书", "龙舌兰"], "lmd"),
      room_1_2: facility("制造站", ["砾", "斑点", "夜烟"], "gold"),
      room_1_3: facility("制造站", ["温蒂", "清流", "森蚺"], "gold"),
      room_2_1: facility("制造站", ["红云", "刻俄柏", "泡泡"], "exp3"),
      room_2_2: facility("制造站", ["断罪者", "食铁兽", "白雪"], "exp3"),
      room_2_3: facility("制造站", ["槐琥", "梅尔", "赫默"], "exp3"),
      room_3_1: facility("发电站", ["雷蛇"]),
      room_3_2: facility("发电站", ["格雷伊"]),
      room_3_3: facility("发电站", ["白面鸮"]),
      dormitory_1: facility("宿舍", ["爱丽丝", "Free", "Free", "Free", "Free"]),
      dormitory_2: facility("宿舍", ["闪灵", "Free", "Free", "Free", "Free"]),
      dormitory_3: facility("宿舍", ["丽兹", "Free", "Free", "Free", "Free"]),
      dormitory_4: facility("宿舍", ["杜林", "Free", "Free", "Free", "Free"]),
      factory: facility("加工站", []),
      contact: facility("办公室", ["梓兰"]),
      train: facility("训练室", []),
      recycle: facility("回收站", []),
    },
    conf: { ling_xi: 1, exhaust_require: "", rest_in_full: "", resting_priority: "", workaholic: "", refresh_trading: "", refresh_drained: "", ope_resting_priority: "" },
    backup_plans: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validPlan(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((room) => room === null || (
    isRecord(room)
    && (room.name === undefined || typeof room.name === "string")
    && (room.product === undefined || room.product === null || typeof room.product === "string")
    && (room.plans === undefined || (Array.isArray(room.plans) && room.plans.every((entry) => (
      isRecord(entry) && typeof entry.agent === "string"
      && (entry.group === undefined || typeof entry.group === "string")
      && (entry.replacement === undefined || (Array.isArray(entry.replacement) && entry.replacement.every((name) => typeof name === "string")))
    ))))
  ));
}

export function parseMowerEditorDocument(text: string): MowerEditorDocument {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || (value.default !== undefined && value.default !== "plan1") || !validPlan(value.plan1)) {
    throw new Error("Invalid Mower plan.json");
  }
  if (value.conf !== undefined && (!isRecord(value.conf) || Object.values(value.conf).some((entry) => typeof entry !== "string" && typeof entry !== "number"))) {
    throw new Error("Invalid Mower configuration");
  }
  const backups = value.backup_plans ?? [];
  if (!Array.isArray(backups) || backups.some((backup) => !isRecord(backup) || !validPlan(backup.plan ?? {}))) {
    throw new Error("Invalid Mower backup plans");
  }
  const defaults = createMowerEditorDocument();
  return {
    ...value,
    default: "plan1",
    title: typeof value.title === "string" ? value.title : "Mower",
    author: typeof value.author === "string" ? value.author : "",
    description: typeof value.description === "string" ? value.description : "",
    id: typeof value.id === "string" || typeof value.id === "number" ? String(value.id) : "",
    plan1: structuredClone(value.plan1) as MowerPlanDocument["plan1"],
    conf: { ...defaults.conf, ...(value.conf as MowerPlanDocument["conf"] ?? {}) },
    backup_plans: backups.map((backup) => ({
      ...backup,
      name: typeof backup.name === "string" ? backup.name : "Backup",
      plan: backup.plan ?? {},
      conf: isRecord(backup.conf) ? backup.conf : {},
      task: isRecord(backup.task) ? backup.task : {},
      trigger: isRecord(backup.trigger) ? backup.trigger : {},
      trigger_timing: typeof backup.trigger_timing === "string" ? backup.trigger_timing : "AFTER_PLANNING",
    })),
  };
}
