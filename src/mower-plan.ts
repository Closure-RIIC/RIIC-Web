import type { MaaJson, MaaRoom, MaaRooms } from "./types.ts";

export interface MowerPlanEntry {
  agent: string;
  group?: string;
  replacement?: string[];
}

export interface MowerFacility {
  name?: string;
  plans?: MowerPlanEntry[];
  product?: string | null;
}

export interface MowerBackupPlan {
  name: string;
  plan: Record<string, MowerFacility | null>;
  conf: Record<string, string | number>;
  task: Record<string, string[] | null>;
  trigger: Record<string, unknown>;
  trigger_timing: string;
}

export interface MowerPlanDocument {
  default: "plan1";
  plan1: Record<string, MowerFacility | null>;
  conf: {
    ling_xi: number;
    exhaust_require: string;
    rest_in_full: string;
    resting_priority: string;
    workaholic: string;
    refresh_trading: string;
    refresh_drained: string;
    ope_resting_priority: string;
  };
  backup_plans: MowerBackupPlan[];
}

const MOWER_ROOM_KEYS = Array.from({ length: 3 }, (_, floor) => (
  Array.from({ length: 3 }, (_, position) => `room_${floor + 1}_${position + 1}`)
)).flat();

const MOWER_CONF: MowerPlanDocument["conf"] = {
  ling_xi: 1,
  exhaust_require: "",
  rest_in_full: "",
  resting_priority: "",
  workaholic: "",
  refresh_trading: "",
  refresh_drained: "",
  ope_resting_priority: "",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMowerFacility(value: unknown): value is MowerFacility {
  if (!isRecord(value)) return false;
  if (value.name !== undefined && typeof value.name !== "string") return false;
  if (value.product !== undefined && value.product !== null && typeof value.product !== "string") return false;
  return value.plans === undefined || (
    Array.isArray(value.plans)
    && value.plans.every((plan) => isRecord(plan) && typeof plan.agent === "string")
  );
}

function isMowerPlan(value: unknown): value is MowerPlanDocument {
  if (!isRecord(value) || value.default !== "plan1" || !isRecord(value.plan1)) return false;
  if (value.conf !== undefined && !isRecord(value.conf)) return false;
  return Object.values(value.plan1).every((facility) => facility === null || isMowerFacility(facility));
}

function normalizedName(value: string | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
}

function roomGroupForMowerName(name: string | undefined): keyof MaaRooms | null {
  const normalized = normalizedName(name);
  if (normalized.includes("贸易") || normalized.includes("trading")) return "trading";
  if (normalized.includes("制造") || normalized.includes("manufacture") || normalized === "factory") return "manufacture";
  if (normalized.includes("发电") || normalized.includes("power")) return "power";
  return null;
}

function productForMaa(group: keyof MaaRooms, product: string | null | undefined): string | undefined {
  if (!product) return undefined;
  const normalized = product.trim().toLocaleLowerCase("en-US");
  if (group === "trading") {
    if (["lmd", "gold", "pure gold", "龙门商法"].includes(normalized) || product === "LMD") return "LMD";
    if (["oru", "orundum", "originium shard", "开采协力"].includes(normalized) || product === "Originium Shard") return "Orundum";
    return undefined;
  }
  if (group !== "manufacture") return undefined;
  if (["exp", "exp3", "battle record", "作战记录"].includes(normalized)) return "Battle Record";
  if (["ori", "orirock", "originium shard", "源石碎片"].includes(normalized)) return "Originium Shard";
  if (["all", "通用生产"].includes(normalized)) return "all";
  if (["gold", "pure gold", "贵金属"].includes(normalized)) return "Pure Gold";
  return undefined;
}

function productForMower(group: keyof MaaRooms, product: string | null | undefined): string | undefined {
  if (!product) return undefined;
  const normalized = product.trim().toLocaleLowerCase("en-US");
  if (group === "trading") {
    if (["oru", "orundum", "originium shard", "开采协力"].includes(normalized)) return "orundum";
    if (["lmd", "gold", "pure gold", "龙门商法"].includes(normalized)) return "lmd";
    throw new Error("Unsupported Mower trading product");
  }
  if (group !== "manufacture") return undefined;
  if (["exp", "exp3", "battle record", "作战记录"].includes(normalized)) return "exp3";
  if (["ori", "orirock", "originium shard", "源石碎片"].includes(normalized)) return "orirock";
  if (["gold", "pure gold", "贵金属"].includes(normalized)) return "gold";
  throw new Error("Choose a concrete factory product before exporting to Mower");
}

function roomFromMowerFacility(facility: MowerFacility, group: keyof MaaRooms): MaaRoom {
  const operators = (facility.plans ?? []).map((plan) => {
    const agent = plan.agent.trim();
    return agent && agent !== "Free" ? agent : null;
  });
  const product = productForMaa(group, facility.product);
  return {
    operators,
    sort: true,
    skip: false,
    autofill: group === "dormitory" && (facility.plans ?? []).some((plan) => plan.agent.trim() === "Free"),
    ...(product ? { product } : {}),
  };
}

export function mowerPlanToMaa(value: unknown): MaaJson | null {
  if (!isMowerPlan(value)) return null;
  const source = value.plan1;
  const rooms: MaaRooms = {};
  const fixed: Array<[string, keyof MaaRooms]> = [
    ["central", "control"],
    ["meeting", "meeting"],
    ["contact", "hire"],
    ["factory", "processing"],
  ];
  for (const [key, group] of fixed) {
    const facility = source[key];
    if (facility) rooms[group] = [roomFromMowerFacility(facility, group)];
  }

  const dormKeys = ["dormitory_1", "dormitory_2", "dormitory_3", "dormitory_4"];
  const dormCount = dormKeys.reduce((count, key, index) => source[key] ? index + 1 : count, 0);
  const dormitories = dormKeys.slice(0, dormCount).map((key) => (
    roomFromMowerFacility(source[key] ?? {}, "dormitory")
  ));
  if (dormitories.length) rooms.dormitory = dormitories;

  for (const key of MOWER_ROOM_KEYS) {
    const facility = source[key];
    if (!facility) continue;
    const group = roomGroupForMowerName(facility.name);
    if (!group) {
      if (!facility.name && !facility.plans?.length) continue;
      return null;
    }
    if (!rooms.trading && !rooms.manufacture && !rooms.power) {
      rooms.trading = [];
      rooms.manufacture = [];
      rooms.power = [];
    }
    const groupRooms = rooms[group] ?? [];
    groupRooms.push(roomFromMowerFacility(facility, group));
    rooms[group] = groupRooms;
  }

  if (Object.keys(rooms).length === 0) return null;

  return {
    title: "Mower plan",
    description: "由 Mower plan.json 导入",
    planTimes: "1班",
    plans: [{ name: "Mower plan", duration: 1440, rooms }],
  };
}

function mowerFacility(name: string, room: MaaRoom): MowerFacility {
  const plans = room.operators.flatMap((operator) => {
    const agent = (typeof operator === "string" ? operator : operator?.name ?? "").trim();
    return agent ? [{ agent, group: "", replacement: [] }] : [];
  });
  return {
    name,
    plans,
  };
}

export function maaToMowerPlan(maa: MaaJson, activeShift = 0): MowerPlanDocument {
  const plan = maa.plans[activeShift];
  if (!plan) throw new Error("No active shift to export");
  const productionCount = ["trading", "manufacture", "power"].reduce(
    (count, group) => count + (plan.rooms[group as keyof MaaRooms]?.length ?? 0), 0,
  );
  if (productionCount > 9 || (plan.rooms.dormitory?.length ?? 0) > 4) {
    throw new Error("Mower supports at most 9 production rooms and 4 dormitories");
  }
  const plan1: Record<string, MowerFacility> = {};
  const fixed: Array<[keyof MaaRooms, string, string]> = [
    ["control", "central", "控制中枢"],
    ["meeting", "meeting", "会客室"],
    ["hire", "contact", "办公室"],
    ["processing", "factory", "加工站"],
  ];
  for (const [group, key, name] of fixed) {
    const room = plan.rooms[group]?.[0];
    if (room) plan1[key] = mowerFacility(name, room);
  }

  (plan.rooms.dormitory ?? []).forEach((room, index) => {
    const facility = mowerFacility("宿舍", room);
    if (room.autofill) {
      facility.plans ??= [];
      while (facility.plans.length < 5) {
        facility.plans.push({ agent: "Free", group: "", replacement: [] });
      }
    }
    plan1[`dormitory_${index + 1}`] = facility;
  });

  let productionIndex = 0;
  for (const [group, name] of [["trading", "贸易站"], ["manufacture", "制造站"], ["power", "发电站"]] as const) {
    for (const room of plan.rooms[group] ?? []) {
      const key = MOWER_ROOM_KEYS[productionIndex];
      const product = productForMower(group, room.product);
      plan1[key] = {
        ...mowerFacility(name, room),
        ...(product ? { product } : {}),
      };
      productionIndex += 1;
    }
  }

  return {
    default: "plan1",
    plan1,
    conf: { ...MOWER_CONF },
    backup_plans: [],
  };
}
