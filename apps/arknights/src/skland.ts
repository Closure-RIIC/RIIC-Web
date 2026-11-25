import type { MaaJson, MaaOperatorSlot, MaaRoom, MaaRooms, SklandInfrastructureGroup, SklandScheduleInfrastructure, ShiftComparison } from "@riic/arknights-domain/types";

const SKLAND_TO_MAA: Partial<Record<SklandInfrastructureGroup, string>> = {
  control: "control",
  trading: "trading",
  manufacture: "manufacture",
  power: "power",
  meeting: "meeting",
  hire: "hire",
};

/**
 * 不参与当前班次比较的设施（见 docs/SKLAND_DATA_CAPABILITIES.md）：
 * - 宿舍本来就不计入匹配率；
 * - 训练室、加工站按既定口径从精简排班快照中过滤，不参与匹配率/调整数/MAA 房间比较；
 * - 回收站不在森空岛上报的设施列表里，纳入只会稳定产生「需换入」并拉低匹配率。
 * 这些设施在「计划侧」也要跳过，否则计划里的人在「实际侧」永远找不到，会被误判为「需换入」。
 */
const INCOMPARABLE_MAA_GROUPS = new Set<string>(["dormitory", "training", "processing", "recycle"]);

const PLACEMENT_ADJUSTMENT_ISSUES = new Set<ShiftComparison["adjustments"][number]["issues"][number]>([
  "missing",
  "unexpected",
  "misplaced",
]);

function operatorName(value: string | MaaOperatorSlot | null): string | null {
  if (typeof value === "string") return value.trim() || null;
  return value?.name?.trim() || null;
}

function roomNames(room: MaaRoom | undefined): string[] {
  return room?.operators?.flatMap((value) => {
    const name = operatorName(value);
    return name ? [name] : [];
  }) ?? [];
}

function locationKey(group: string, index: number): string {
  return `${group}:${index}`;
}

function sameFacilityType(left: string, right: string): boolean {
  return left.split(":", 1)[0] === right.split(":", 1)[0];
}

export function compareShifts(maaJson: MaaJson | undefined, infrastructure: SklandScheduleInfrastructure | undefined): ShiftComparison[] {
  if (!maaJson?.plans?.length || !infrastructure) return [];
  const tired = new Set(infrastructure.tiredOperators);
  const actualLocationByOperator = new Map<string, string>();

  for (const room of infrastructure.rooms) {
    const group = SKLAND_TO_MAA[room.group];
    if (!group) continue;
    const key = locationKey(group, room.index);
    const names = new Set(room.operators.map((operator) => operator.name));
    for (const name of names) actualLocationByOperator.set(name, key);
  }

  return maaJson.plans.map((plan, planIndex) => {
    const plannedLocationByOperator = new Map<string, string>();
    for (const [group, rooms] of Object.entries(plan.rooms) as [keyof MaaRooms, MaaRoom[] | undefined][]) {
      if (INCOMPARABLE_MAA_GROUPS.has(group)) continue;
      rooms?.forEach((room, index) => {
        for (const name of roomNames(room)) plannedLocationByOperator.set(name, locationKey(group, index));
      });
    }

    const matched: string[] = [];
    const missing: string[] = [];
    const misplaced: string[] = [];
    for (const [name, expectedLocation] of plannedLocationByOperator) {
      const actualLocation = actualLocationByOperator.get(name);
      if (actualLocation && sameFacilityType(actualLocation, expectedLocation)) matched.push(name);
      else if (actualLocation) misplaced.push(name);
      else missing.push(name);
    }

    const unexpected = [...actualLocationByOperator.keys()].filter((name) => !plannedLocationByOperator.has(name));
    const tiredScheduled = [...plannedLocationByOperator.keys()].filter((name) => tired.has(name));
    const adjustments = [...new Set([...plannedLocationByOperator.keys(), ...actualLocationByOperator.keys()])]
      .flatMap((name) => {
        const currentRoomKey = actualLocationByOperator.get(name) ?? null;
        const targetRoomKey = plannedLocationByOperator.get(name) ?? null;
        const issues = [] as ShiftComparison["adjustments"][number]["issues"];
        if (!currentRoomKey && targetRoomKey) issues.push("missing");
        if (currentRoomKey && !targetRoomKey) issues.push("unexpected");
        if (currentRoomKey && targetRoomKey && !sameFacilityType(currentRoomKey, targetRoomKey)) issues.push("misplaced");
        if (targetRoomKey && tired.has(name)) issues.push("tired");
        return issues.length ? [{ operator: name, currentRoomKey, targetRoomKey, issues }] : [];
      })
      .sort((left, right) => left.operator.localeCompare(right.operator, "zh-CN"));
    const denominator = new Set([...plannedLocationByOperator.keys(), ...actualLocationByOperator.keys()]).size || 1;
    return {
      planIndex,
      score: Math.round((matched.length / denominator) * 100),
      matched: matched.sort(),
      missing: missing.sort(),
      unexpected: unexpected.sort(),
      misplaced: misplaced.sort(),
      tiredScheduled: tiredScheduled.sort(),
      adjustments,
    };
  });
}

export function closestShift(comparisons: ShiftComparison[]): ShiftComparison | null {
  return comparisons.reduce<ShiftComparison | null>((best, item) => (!best || item.score > best.score ? item : best), null);
}

export function countShiftPlacementAdjustments(comparison: ShiftComparison | null | undefined): number {
  return comparison?.adjustments.filter((adjustment) => (
    adjustment.issues.some((issue) => PLACEMENT_ADJUSTMENT_ISSUES.has(issue))
  )).length ?? 0;
}
