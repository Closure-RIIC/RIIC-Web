import type { AutoRotationResult } from "@riic/arknights-domain/auto-rotation";
import type { BaseBlueprint, RoomEfficiency } from "@riic/arknights-domain/types";
import { planToRows, type RoomRow } from "./schedule.ts";
import { addOperatorPresentations } from "./schedule-presentation.ts";

export type AutoRotationQueue = "main" | "backup";

/** Adapt independent queues to the shared board without inventing timed shifts or MAA. */
export function autoRotationToRows(
  result: AutoRotationResult,
  layout: BaseBlueprint,
  queue: AutoRotationQueue,
): RoomRow[] {
  const rooms = new Map(result.rooms.map(room => [room.roomId, room]));
  const dorms = new Map(result.dormSupport.map(room => [room.roomId, room.operators]));
  const products = new Map(layout.rooms.map(room => [room.id, room.product]));
  return addOperatorPresentations(planToRows(undefined, undefined, layout).map(row => {
    const state = rooms.get(row.roomId)?.[queue];
    const operators = state?.operators ?? (row.group === "dormitory" ? dorms.get(row.roomId) : undefined) ?? [];
    const efficiency: RoomEfficiency | undefined = state?.efficiency ?? (state?.productionEfficiency !== undefined
      ? { final_efficiency: state.productionEfficiency }
      : state?.powerChargeEfficiency !== undefined
        ? { power_charge_speed_pct: state.powerChargeEfficiency * 100 }
        : undefined);
    return {
      ...row,
      operators: [...operators],
      operatorSlots: operators.map(name => ({ name, label: name })),
      roomProduct: products.get(row.roomId),
      efficiency,
      rule: "",
      suspicious: state ? !state.complete || state.missingSeats > 0 : false,
    };
  }));
}
