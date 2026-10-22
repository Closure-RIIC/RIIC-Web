import type { PublicPlanData } from "@riic/arknights-domain/types";

export function withDefaultDormAutofill(result: PublicPlanData): PublicPlanData {
  const next = structuredClone(result);
  for (const plan of next.maa.plans) {
    for (const room of plan.rooms.dormitory ?? []) {
      room.autofill = true;
      // MAA candidates and automatic filling are mutually exclusive.
      delete room.candidates;
    }
  }
  return next;
}
