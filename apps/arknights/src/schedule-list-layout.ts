import type { RoomGroup, RoomRow } from "./schedule";

export interface ListScheduleGroup {
  label: string;
  rows: RoomRow[];
}

const LIST_FUNCTIONAL_FACILITY_GROUPS = new Set<RoomGroup>([
  "hire",
  "power",
  "meeting",
  "processing",
  "training",
  "recycling",
]);

const LIST_ALIGNED_OPERATOR_ORIGIN_GROUPS = new Set<RoomGroup>([
  "control",
  "trading",
  "manufacture",
  "dormitory",
]);

const LIST_FUNCTIONAL_FACILITY_ORDER: Partial<Record<RoomGroup, number>> = {
  power: 0,
  training: 1,
  recycling: 1.5,
  meeting: 2,
  hire: 3,
  processing: 4,
};

const MOBILE_LIST_GROUP_ORDER: Partial<Record<RoomGroup, number>> = {
  control: 0,
  meeting: 1,
  manufacture: 2,
  trading: 3,
  power: 4,
  hire: 5,
};

export const LIST_OPERATOR_ORIGIN_PX = 248;
export const LIST_OPERATOR_FRAME_SIZE_PX = 80;
export const LIST_OPERATOR_GAP_MAX_PX = 20;
export const LIST_FUNCTIONAL_GROUP_GAP_PX = 12;
export const LIST_MEETING_OPERATOR_WIDTH_PX =
  LIST_OPERATOR_FRAME_SIZE_PX * 2 + LIST_OPERATOR_GAP_MAX_PX;

const LIST_OPERATOR_COLUMN_GAP = "clamp(0.75rem, 1.25vw, 1.25rem)";
const LIST_FUNCTIONAL_GRID_CLASS =
  "xl:grid-cols-[repeat(24,minmax(0,1fr))]";
const LIST_FUNCTIONAL_OPERATOR_PLACEMENT_CLASS =
  "xl:absolute xl:inset-y-0";

export function isListFunctionalFacilityRoom(group: RoomGroup): boolean {
  return LIST_FUNCTIONAL_FACILITY_GROUPS.has(group);
}

export function listRoomUsesAlignedOperatorOrigin(group: RoomGroup): boolean {
  return LIST_ALIGNED_OPERATOR_ORIGIN_GROUPS.has(group);
}

export function listRoomHeightClass(group: RoomGroup): string {
  if (group === "manufacture") return "h-[160px]";
  if (isListFunctionalFacilityRoom(group)) return "h-[128px]";
  return "h-[144px]";
}

export function listRoomTitleSizeClass(): string {
  return "text-[18px] max-sm:text-[16px]";
}

export function listMobileOperatorGridClass(): string {
  return "max-[819px]:grid max-[819px]:w-full max-[819px]:max-w-[304px] max-[819px]:grid-cols-5 max-[819px]:[column-gap:0.375rem] max-[819px]:gap-y-2 max-[819px]:overflow-visible max-[819px]:pb-2";
}

export function listFunctionalOperatorPosition(
  group: RoomGroup,
): { columnGap: string; left: string } | undefined {
  if (!isListFunctionalFacilityRoom(group)) return undefined;

  return {
    columnGap: LIST_OPERATOR_COLUMN_GAP,
    left: group === "meeting" || group === "training" || group === "recycling"
      ? `max(0px, min(${LIST_OPERATOR_ORIGIN_PX}px, calc(100cqw - ${LIST_MEETING_OPERATOR_WIDTH_PX}px)))`
      : `max(0px, min(${LIST_OPERATOR_ORIGIN_PX}px, calc(100cqw - ${LIST_OPERATOR_FRAME_SIZE_PX}px)))`,
  };
}

export function listFunctionalOperatorPlacementClass(
  group: RoomGroup,
): string | undefined {
  return isListFunctionalFacilityRoom(group)
    ? LIST_FUNCTIONAL_OPERATOR_PLACEMENT_CLASS
    : undefined;
}

export function listFunctionalFacilityGridClass(): string {
  return LIST_FUNCTIONAL_GRID_CLASS;
}

export function listFunctionalRoomSpanClass(
  group: RoomGroup,
  powerCount: number,
): string | undefined {
  if (group === "power") return powerCount === 3 ? "xl:col-span-8" : "xl:col-span-12";
  if (group === "hire" || group === "processing") {
    return powerCount === 3 ? "xl:col-span-8" : "xl:col-span-12";
  }
  if (group === "training" || group === "meeting" || group === "recycling") {
    return "xl:col-span-12";
  }
  return undefined;
}

export function buildListScheduleGroups(rows: RoomRow[]): ListScheduleGroup[] {
  const groups = rows.reduce<ListScheduleGroup[]>((currentGroups, row) => {
    const groupLabel = isListFunctionalFacilityRoom(row.group)
      ? "功能设施"
      : row.groupLabel;
    const group = currentGroups.find((item) => item.label === groupLabel);

    if (group) {
      group.rows.push(row);
    } else {
      currentGroups.push({ label: groupLabel, rows: [row] });
    }

    return currentGroups;
  }, []);

  const functionalGroup = groups.find((group) => group.label === "功能设施");
  functionalGroup?.rows.sort(
    (left, right) =>
      (LIST_FUNCTIONAL_FACILITY_ORDER[left.group] ?? Number.MAX_SAFE_INTEGER)
      - (LIST_FUNCTIONAL_FACILITY_ORDER[right.group] ?? Number.MAX_SAFE_INTEGER),
  );

  return groups;
}

/** Mobile follows the in-game assignment overview while desktop keeps its denser functional grouping. */
export function buildMobileListScheduleGroups(rows: RoomRow[]): ListScheduleGroup[] {
  const groups = rows.reduce<ListScheduleGroup[]>((currentGroups, row) => {
    const group = currentGroups.find((item) => item.rows[0]?.group === row.group);

    if (group) {
      group.rows.push(row);
    } else {
      currentGroups.push({ label: row.groupLabel, rows: [row] });
    }

    return currentGroups;
  }, []);

  return groups
    .map((group, originalIndex) => ({ group, originalIndex }))
    .sort((left, right) => {
      const leftOrder = MOBILE_LIST_GROUP_ORDER[left.group.rows[0]?.group ?? "default"];
      const rightOrder = MOBILE_LIST_GROUP_ORDER[right.group.rows[0]?.group ?? "default"];
      if (leftOrder !== undefined || rightOrder !== undefined) {
        return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER);
      }
      return left.originalIndex - right.originalIndex;
    })
    .map(({ group }) => group);
}
