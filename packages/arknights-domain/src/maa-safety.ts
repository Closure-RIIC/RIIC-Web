import { stripInternalFields } from "./internal-field-safety.ts";
import type { MaaJson, MaaRoom, MaaRooms } from "./types.ts";

const MAA_ROOM_KINDS = [
  "trading",
  "manufacture",
  "power",
  "control",
  "dormitory",
  "meeting",
  "hire",
  "processing",
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

    // Training uses role-specific candidate lists; only these public fields travel to MAA.
    if (sourcePlan.rooms.training) sanitizedPlan.rooms.training = sourcePlan.rooms.training.map(room => ({
      ...(validCandidates(room.operatorsA) ? { operatorsA: [...room.operatorsA] } : {}),
      ...(validCandidates(room.operatorsB) ? { operatorsB: [...room.operatorsB] } : {}),
      ...(typeof room.skip === "boolean" ? { skip: room.skip } : {}),
    }));
    // Older solver payloads stored an unrelated private training object under this key.
    if (sourcePlan.rooms.training?.length && sourcePlan.rooms.training.every(room => "operators" in room) && !sanitizedPlan.rooms.training?.some(room => Object.keys(room).length)) {
      delete sanitizedPlan.rooms.training;
    }
    sourcePlan.rooms.recycle?.forEach((room, index) => {
      if (validCandidates(room.candidates)) sanitizedPlan.rooms.recycle![index]!.candidates = [...room.candidates];
    });

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
 * Every dormitory is normalized to `skip: false` + `autofill: true` so MAA
 * always staffs dorms itself; `candidates` is mutually exclusive with
 * autofill and is dropped.
 */
export function prepareMaaForExport<T extends MaaJson>(
  maa: T,
  strictOperatorOrder = true,
  allowReplacementOperatorSort = false,
  preserveExplicitDormRules = false,
): T {
  const exported = sanitizeMaaJson(maa);

  for (const plan of exported.plans) {
    plan.rooms.dormitory?.forEach((room) => {
      if (preserveExplicitDormRules && (room.skip || room.candidates?.length)) {
        if (room.candidates?.length) room.autofill = false;
        return;
      }
      room.skip = false;
      room.autofill = true;
      delete room.candidates;
    });
    if (plan.Fiammetta) plan.Fiammetta.order = "pre";
    if (plan.drones) plan.drones.order = "pre";
    for (const [kind, rooms] of Object.entries(plan.rooms)) {
      if (kind === "training") continue;
      if (!rooms) continue;
      for (const room of rooms) {
        room.sort = strictOperatorOrder || allowReplacementOperatorSort;
      }
    }
  }

  return exported;
}
