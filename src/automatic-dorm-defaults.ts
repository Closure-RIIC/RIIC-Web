import type { PublicPlanData } from "./types.ts";
import { isFiammettaOnlyPlan } from "./maa-safety.ts";

export function withDefaultDormAutofill(result: PublicPlanData): PublicPlanData {
  const next = structuredClone(result);
  for (const plan of next.maa.plans) {
    const eventOnly = isFiammettaOnlyPlan(plan);
    for (const room of plan.rooms.dormitory ?? []) {
      room.autofill = !eventOnly;
      // MAA candidates and automatic filling are mutually exclusive.
      delete room.candidates;
    }
  }
  return next;
}
