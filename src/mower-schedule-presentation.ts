import { MOWER_FIXED_ROOMS, MOWER_PRODUCTION_KEYS } from "./mower-editor.ts";
import type { MowerFacility } from "./mower-plan.ts";
import type { RoomGroup, RoomRow } from "./schedule.ts";
import type { BaseBlueprint, RoomKind, RoomProduct } from "./types.ts";

const fixedGroups: Record<string, RoomGroup> = {
  central: "control", meeting: "meeting", factory: "processing", contact: "hire", train: "training",
};
const kinds: Record<Exclude<RoomGroup, "recycling">, RoomKind> = {
  control: "control_center", trading: "trade_post", manufacture: "factory", power: "power_plant",
  dormitory: "dormitory", meeting: "meeting_room", hire: "office", processing: "workshop", training: "training_room",
};

/** A view of Mower facilities, retaining source keys and every slot without rewriting the document. */
export function mowerSchedulePresentation(plan: Record<string, MowerFacility | null>) {
  const layout: BaseBlueprint = { template: "Mower", drone_cap: 200, scenario: {}, rooms: [] };
  const counts = new Map<RoomGroup, number>();
  const rows: RoomRow[] = [];
  for (const key of [...MOWER_PRODUCTION_KEYS, ...MOWER_FIXED_ROOMS.map((room) => room.key)]) {
    const facility = plan[key];
    const fixed = MOWER_FIXED_ROOMS.find((room) => room.key === key);
    const group: RoomGroup = key.startsWith("room_")
      ? facility?.name === "贸易站" ? "trading" : facility?.name === "发电站" ? "power" : "manufacture"
      : key.startsWith("dormitory_") ? "dormitory" : fixedGroups[key]!;
    const name = facility?.name || fixed?.name || "空设施";
    const index = (counts.get(group) ?? 0) + 1;
    counts.set(group, index);
    const slotAssignments = (facility?.plans ?? []).map(({ agent }) => (
      agent.trim() ? { name: agent, label: agent } : undefined
    ));
    const operatorSlots = slotAssignments.filter((slot) => slot !== undefined);
    let product: RoomProduct | undefined;
    if (group === "trading") product = { trade: { order: facility?.product === "orundum" ? "originium" : "gold" } };
    if (group === "manufacture") product = { factory: { recipe: facility?.product === "exp3" ? "battle_record" : facility?.product === "orirock" ? "originium" : "gold" } };
    if (group === "recycling") continue;
    layout.rooms.push({ id: key, kind: kinds[group], level: group === "dormitory" ? 5 : 3, product });
    rows.push({
      key, roomId: key, group, groupLabel: name, index,
      title: key.startsWith("room_") ? `${name} B${key.split("_")[1]}0${key.split("_")[2]}` : fixed?.name ?? name,
      operators: operatorSlots.map((slot) => slot.name), operatorSlots, slotAssignments,
      autofill: false, rule: "", suspicious: false,
    });
  }
  return { rows, layout };
}
