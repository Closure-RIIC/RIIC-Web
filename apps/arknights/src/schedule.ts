import type { BuildingSkillPresentation } from "./operatorPortraits";
import { maaRoomAutofill } from "./schedule-autofill.ts";
import type { BaseBlueprint, BlueprintRoom, MaaOperatorSlot, MaaPlan, MaaRoom, MaaRooms, RoomEfficiency, RoomKind, RotationShift, TrainingRoomShift } from "./types.ts";

export type RoomGroup = keyof MaaRooms | "training" | "recycling";

export interface RoomRow {
  key: string;
  group: RoomGroup;
  groupLabel: string;
  index: number;
  roomId: string;
  title: string;
  level?: number;
  product?: string;
  operators: string[];
  operatorSlots: RoomOperatorSlot[];
  /** Fixed-position slots used by editors; unlike operatorSlots, empty gaps are preserved. */
  slotAssignments?: Array<RoomOperatorSlot | undefined>;
  unavailableSlotIndices?: number[];
  positionSlots?: RoomPositionSlot[];
  autofill: boolean;
  efficiency?: RoomEfficiency;
  /** Manual per-shift paper skill efficiency in percentage points. */
  manualSkillEfficiencyPct?: number;
  efficiencyLabel?: string;
  rule: string;
  suspicious: boolean;
}

export interface RoomOperatorSlot {
  name: string;
  label: string;
  skill?: number;
  profession?: number;
  portrait?: string;
  buildingSkill?: BuildingSkillPresentation;
  portraitAlert?: "missing-power-efficiency";
}

export interface RoomPositionSlot {
  position: "trainee" | "trainer";
  positionLabel: "训练位" | "协助位";
  slot?: RoomOperatorSlot;
}

const GROUP_LABELS: Record<RoomGroup, string> = {
  trading: "贸易站",
  manufacture: "制造站",
  power: "发电站",
  control: "控制中枢",
  dormitory: "宿舍",
  meeting: "会客室",
  hire: "办公室",
  processing: "加工站",
  training: "训练室",
  recycling: "回收站",
};

const GROUP_ORDER: RoomGroup[] = [
  "control",
  "trading",
  "manufacture",
  "power",
  "dormitory",
  "hire",
  "processing",
  "meeting",
  "training",
];

const ROOM_PREFIX: Partial<Record<RoomGroup, string>> = {
  trading: "trade",
  manufacture: "manu",
  power: "power",
  control: "control",
  dormitory: "dorm",
  meeting: "meeting",
  hire: "office",
  processing: "workshop",
  training: "training_room",
};

const BLUEPRINT_GROUP: Partial<Record<RoomKind, RoomGroup>> = {
  control_center: "control",
  trade_post: "trading",
  factory: "manufacture",
  power_plant: "power",
  dormitory: "dormitory",
  office: "hire",
  meeting_room: "meeting",
  workshop: "processing",
  training_room: "training",
};

const PRODUCT_LABELS: Record<string, string> = {
  all: "由求解器选择",
  LMD: "龙门商法",
  "Pure Gold": "贵金属",
  "Battle Record": "作战记录",
  "Originium Shard": "源石碎片",
  gold: "贵金属",
  battle_record: "作战记录",
  originium: "源石碎片",
};

const TRADE_PRODUCT_LABELS: Record<string, string> = {
  LMD: "龙门商法",
  gold: "龙门商法",
  Orundum: "开采协力",
  "Originium Shard": "开采协力",
  originium: "开采协力",
};

const FACTORY_PRODUCT_LABELS: Record<string, string> = {
  all: "由求解器选择",
  "Pure Gold": "贵金属",
  gold: "贵金属",
  "Battle Record": "作战记录",
  battle_record: "作战记录",
  "Originium Shard": "源石碎片",
  originium: "源石碎片",
};

function productLabel(value: unknown, group?: RoomGroup): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (group === "trading") return TRADE_PRODUCT_LABELS[value] ?? PRODUCT_LABELS[value] ?? value;
  if (group === "manufacture") return FACTORY_PRODUCT_LABELS[value] ?? PRODUCT_LABELS[value] ?? value;
  return PRODUCT_LABELS[value] ?? value;
}

function operatorName(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "name" in value) {
    const slot = value as { name?: string; skill?: number };
    return slot.skill ? `${slot.name ?? ""} S${slot.skill}` : slot.name ?? "";
  }
  return "";
}

function operatorSlot(value: unknown): RoomOperatorSlot | null {
  if (typeof value === "string") {
    const name = value.trim();
    if (!name) return null;
    return {
      name,
      label: name,
    };
  }

  if (value && typeof value === "object" && "name" in value) {
    const slot = value as MaaOperatorSlot;
    const name = slot.name?.trim();
    if (!name) return null;
    return {
      name,
      label: slot.skill ? `${name} S${slot.skill}` : name,
      skill: slot.skill,
    };
  }

  return null;
}

function plainOperatorName(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "name" in value) {
    return (value as { name?: string }).name ?? "";
  }
  return "";
}

function roomOperators(room: MaaRoom): string[] {
  if (!Array.isArray(room.operators)) return [];
  return room.operators.map(operatorName).filter(Boolean);
}

function roomOperatorSlots(room: MaaRoom): RoomOperatorSlot[] {
  if (!Array.isArray(room.operators)) return [];
  return room.operators.map(operatorSlot).filter((slot): slot is RoomOperatorSlot => Boolean(slot));
}

function plainRoomOperators(room: MaaRoom): string[] {
  if (!Array.isArray(room.operators)) return [];
  return room.operators.map(plainOperatorName).filter(Boolean);
}

function includesAny(operators: string[], names: string[]): boolean {
  return names.some((name) => operators.some((operator) => operator.includes(name)));
}

function ruleFor(group: RoomGroup, operators: string[]): string {
  if (group === "trading") {
    if (includesAny(operators, ["但书"])) return "但书优先贸易 meta";
    if (includesAny(operators, ["可露希尔"])) return "可露希尔贸易 meta";
    if (includesAny(operators, ["龙舌兰", "巫恋"])) return "龙舌兰/巫恋订单体系";
    return "贸易散件工具人";
  }

  if (group === "manufacture") {
    if (includesAny(operators, ["安哲拉", "斯卡蒂", "歌蕾蒂娅", "幽灵鲨", "乌尔比安"])) {
      return "深海猎人制造体系";
    }
    if (includesAny(operators, ["帕拉斯", "石棉", "火神"])) return "标准化制造组";
    if (includesAny(operators, ["芬", "泡普卡", "斑点"])) return "急性子/慢性子回退池";
    return "制造工具人池";
  }

  if (group === "control") return "中枢全局注入";
  if (group === "power") return "发电效率";
  if (group === "training") return "不参与 MAA 导出";
  return "辅助设施";
}

function titleFor(group: RoomGroup, index: number): string {
  const label = GROUP_LABELS[group];
  if (["control", "meeting", "processing", "hire", "training"].includes(group)) return label;
  return `${label} ${index + 1}`;
}

function roomIdFor(group: RoomGroup, index: number): string {
  const prefix = ROOM_PREFIX[group] ?? group;
  if (["control", "meeting", "workshop", "office", "training_room"].includes(prefix)) return prefix;
  return `${prefix}_${index + 1}`;
}

function formatNumber(value: number, digits = 1): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

function efficiencyLabel(group: RoomGroup, efficiency: RoomEfficiency | undefined): string | undefined {
  if (!efficiency) return undefined;

  if (group === "trading") {
    if (typeof efficiency.trade_skill_pct === "number") {
      return `纯技能效率 ${formatNumber(efficiency.trade_skill_pct)}%`;
    }
  }

  if (group === "manufacture") {
    if (typeof efficiency.manu_prod_skill === "number") {
      return `纯技能效率 ${formatNumber(efficiency.manu_prod_skill)}%`;
    }
  }

  if (group === "power") {
    const score = efficiency.power_skill_pct
      ?? (typeof efficiency.power_score === "number" ? Math.max(0, efficiency.power_score - 100) : undefined);
    if (typeof score === "number") {
      return `纯技能效率 ${formatNumber(score)}%`;
    }
  }

  return undefined;
}

function efficiencyMapFor(shift: RotationShift | undefined): Map<string, RoomEfficiency> {
  const map = new Map<string, RoomEfficiency>();
  const roomLines = Array.isArray(shift?.scores?.room_lines) ? shift.scores.room_lines : [];
  for (const line of roomLines) {
    map.set(line.room_id, line);
  }
  return map;
}

function levelMapFor(layout: BaseBlueprint | undefined): Map<string, number> {
  const map = new Map<string, number>();
  for (const room of layout?.rooms ?? []) {
    map.set(room.id, room.level);
  }
  return map;
}

function roomMapFor(layout: BaseBlueprint | undefined): Map<string, BlueprintRoom> {
  const map = new Map<string, BlueprintRoom>();
  for (const room of layout?.rooms ?? []) {
    map.set(room.id, room);
  }
  return map;
}

function blueprintProductLabel(room: BlueprintRoom): string | undefined {
  if (!room.product) return undefined;
  if ("factory" in room.product) return productLabel(room.product.factory.recipe, "manufacture");
  if ("trade" in room.product) return productLabel(room.product.trade.order, "trading");
  return undefined;
}

function trainingPositionSlots(shift: TrainingRoomShift | undefined): RoomPositionSlot[] {
  return [
    {
      position: "trainee",
      positionLabel: "训练位",
      ...(shift?.trainee ? { slot: { name: shift.trainee, label: shift.trainee } } : {}),
    },
    {
      position: "trainer",
      positionLabel: "协助位",
      ...(shift?.trainer ? { slot: { name: shift.trainer, label: shift.trainer } } : {}),
    },
  ];
}

function layoutToRows(layout: BaseBlueprint | undefined, trainingShift?: TrainingRoomShift): RoomRow[] {
  if (!layout) return [];

  const rows: RoomRow[] = [];
  const groupCounts = new Map<RoomGroup, number>();
  const sortedRooms = [...layout.rooms].sort((left, right) => {
    const leftGroup = BLUEPRINT_GROUP[left.kind];
    const rightGroup = BLUEPRINT_GROUP[right.kind];
    return (leftGroup ? GROUP_ORDER.indexOf(leftGroup) : Number.MAX_SAFE_INTEGER)
      - (rightGroup ? GROUP_ORDER.indexOf(rightGroup) : Number.MAX_SAFE_INTEGER);
  });

  for (const room of sortedRooms) {
    const group = BLUEPRINT_GROUP[room.kind];
    if (!group) continue;
    const index = groupCounts.get(group) ?? 0;
    groupCounts.set(group, index + 1);
    const positionSlots = group === "training" ? trainingPositionSlots(trainingShift) : undefined;
    const operatorSlots = positionSlots
      ? positionSlots.flatMap((positionSlot) => positionSlot.slot ? [positionSlot.slot] : [])
      : [];
    rows.push({
      key: `${group}-${room.id}`,
      group,
      groupLabel: GROUP_LABELS[group],
      index,
      roomId: room.id,
      title: titleFor(group, index),
      level: room.level,
      product: blueprintProductLabel(room),
      operators: operatorSlots.map((slot) => slot.name),
      operatorSlots,
      ...(positionSlots ? { positionSlots } : {}),
      autofill: false,
      rule: ruleFor(group, []),
      suspicious: false,
    });
  }

  return rows;
}

export function planToRows(
  plan: MaaPlan | undefined,
  shift?: RotationShift,
  layout?: BaseBlueprint,
  trainingShift?: TrainingRoomShift,
): RoomRow[] {
  if (!plan) return layoutToRows(layout, trainingShift);

  const rows: RoomRow[] = [];
  const efficiencyMap = efficiencyMapFor(shift);
  const levelMap = levelMapFor(layout);
  const layoutRoomMap = roomMapFor(layout);
  const roomsByGroup = plan.rooms && typeof plan.rooms === "object" ? plan.rooms : {};
  for (const group of GROUP_ORDER) {
    if (group === "recycling") continue;
    if (group === "training") {
      const layoutRoom = layout?.rooms.find((room) => room.kind === "training_room");
      if (!layoutRoom) continue;
      const positionSlots = trainingPositionSlots(trainingShift);
      const operatorSlots = positionSlots.flatMap((positionSlot) => positionSlot.slot ? [positionSlot.slot] : []);
      rows.push({
        key: "training-training_room",
        group,
        groupLabel: GROUP_LABELS[group],
        index: 0,
        roomId: layoutRoom.id,
        title: titleFor(group, 0),
        level: layoutRoom.level,
        operators: operatorSlots.map((slot) => slot.name),
        operatorSlots,
        positionSlots,
        autofill: false,
        rule: ruleFor(group, []),
        suspicious: false,
      });
      continue;
    }
    const rooms = Array.isArray(roomsByGroup[group]) ? roomsByGroup[group] : [];
    rooms.forEach((room, index) => {
      const operators = roomOperators(room);
      const sourceOperatorSlots = roomOperatorSlots(room);
      const roomId = roomIdFor(group, index);
      const layoutRoom = layoutRoomMap.get(roomId);
      const sourceEfficiency = efficiencyMap.get(roomId);
      const missingLancetPowerEfficiency = group === "power"
        && sourceOperatorSlots.some((slot) => slot.name === "Lancet-2")
        && sourceEfficiency?.order_multiplier === 1
        && sourceEfficiency.total_efficiency === undefined
        && sourceEfficiency.final_efficiency === undefined;
      const operatorSlots = missingLancetPowerEfficiency
        ? sourceOperatorSlots.map((slot) => slot.name === "Lancet-2"
          ? { ...slot, portraitAlert: "missing-power-efficiency" as const }
          : slot)
        : sourceOperatorSlots;
      const efficiency = missingLancetPowerEfficiency
        ? { ...sourceEfficiency, total_efficiency: 0 }
        : sourceEfficiency;
      rows.push({
        key: `${group}-${index}`,
        group,
        groupLabel: GROUP_LABELS[group],
        index,
        roomId,
        title: titleFor(group, index),
        level: levelMap.get(roomId),
        product: productLabel(room.product, group),
        operators,
        operatorSlots,
        autofill: maaRoomAutofill(room.autofill, {
          group,
          skip: room.skip,
          candidates: room.candidates,
          occupiedSlots: operatorSlots.length,
          capacity: layoutRoom?.dorm_beds ?? 5,
        }),
        efficiency,
        efficiencyLabel: efficiencyLabel(group, efficiency),
        rule: ruleFor(group, plainRoomOperators(room)),
        suspicious: operators.length === 0 && group !== "dormitory",
      });
    });
  }
  return rows;
}
