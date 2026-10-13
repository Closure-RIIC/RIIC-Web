import { stripInternalFields } from "./internal-field-safety.ts";
import type { MaaJson, MaaPlan, MaaRoom, MaaRooms } from "./types.ts";

/** Recognize the explicit MAA projection of a Fiammetta-only event. */
export function isFiammettaOnlyPlan(plan: MaaPlan): boolean {
  if (!plan.Fiammetta?.enable || plan.drones?.enable !== false) return false;
  const targets = Array.isArray(plan.Fiammetta.target) ? plan.Fiammetta.target : [plan.Fiammetta.target];
  const rooms = Object.values(plan.rooms).flatMap((group) => group ?? []);
  const active = rooms.filter((room) => room.skip !== true);
  return rooms.some((room) => room.skip === true)
    && active.length === 1
    && targets.some((target) => typeof target === "string" && (active[0]?.operators ?? []).includes(target));
}

const MAA_ROOM_KINDS = [
  "trading",
  "manufacture",
  "power",
  "control",
  "dormitory",
  "meeting",
  "hire",
  "processing",
  "training",
  "recycle",
] as const satisfies readonly (keyof MaaRooms)[];

function validCandidates(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((candidate) => typeof candidate === "string");
}

/**
 * Removes internal runtime fields while preserving the MAA protocol's room-level
 * operator candidates. `candidates` remains blocked everywhere else because the
 * server also uses that name for private executable and data-path diagnostics.
 */
export function sanitizeMaaJson<T extends MaaJson>(maa: T): T {
  const source = structuredClone(maa);
  const sanitized = stripInternalFields(source);

  source.plans.forEach((sourcePlan, planIndex) => {
    const sanitizedPlan = sanitized.plans[planIndex];
    if (!sanitizedPlan) return;

    for (const roomKind of MAA_ROOM_KINDS) {
      const sourceRooms = sourcePlan.rooms[roomKind];
      const sanitizedRooms = sanitizedPlan.rooms[roomKind];
      if (!sourceRooms || !sanitizedRooms) continue;

      sourceRooms.forEach((sourceRoom: MaaRoom, roomIndex) => {
        if (validCandidates(sourceRoom.candidates) && sanitizedRooms[roomIndex]) {
          sanitizedRooms[roomIndex].candidates = [...sourceRoom.candidates];
        }
      });
    }
  });

  return sanitized;
}

/**
 * Prepare a schedule for MAA export.
 *
 * MAA uses `sort: true` to respect the operator order in each room's
 * `operators` array. The array already follows the order shown in the UI,
 * so preserve it exactly while removing runtime-only fields.
 * Regular shifts normalize dormitories to `skip: false` + `autofill: true`;
 * Fiammetta-only events preserve skipped rooms. `candidates` is mutually
 * exclusive with autofill and is dropped.
 */
export function prepareMaaForExport<T extends MaaJson>(
  maa: T,
  strictOperatorOrder = true,
  allowReplacementOperatorSort = false,
): T {
  const exported = sanitizeMaaJson(maa);

  for (const plan of exported.plans) {
    const eventOnly = isFiammettaOnlyPlan(plan);
    plan.rooms.training ??= [{ operators: [], skip: true }];
    plan.rooms.recycle ??= [{ operators: [], ...(eventOnly ? { skip: true } : { autofill: true }) }];
    for (const room of plan.rooms.training) {
      const occupied = [...(room.operatorsA ?? []), ...(room.operatorsB ?? []), ...(room.operators ?? [])].some((name) => typeof name === "string" && name.trim());
      if (!occupied) room.skip = true;
    }
    for (const room of plan.rooms.recycle) {
      const occupied = [...(room.operatorsA ?? []), ...(room.operatorsB ?? []), ...(room.operators ?? [])].some((name) => typeof name === "string" && name.trim());
      if (!occupied && room.skip !== true && !room.candidates?.length) room.autofill = true;
    }
    plan.rooms.dormitory?.forEach((room) => {
      room.skip = eventOnly;
      room.autofill = !eventOnly;
      delete room.candidates;
    });
    if (plan.Fiammetta) plan.Fiammetta.order = "pre";
    if (plan.drones) plan.drones.order = "pre";
    for (const rooms of Object.values(plan.rooms)) {
      if (!rooms) continue;
      for (const room of rooms) {
        room.sort = strictOperatorOrder || allowReplacementOperatorSort;
      }
    }
  }

  return exported;
}
