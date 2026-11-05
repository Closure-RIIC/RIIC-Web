import type { BaseBlueprint } from "@riic/arknights-domain/types";
import { assignManualOperator, manualRoomCapacity, type ManualScheduleDraft } from "./manual-schedule.ts";

export const POSTER_DORM_SLOTS = 6;

function dormPositions(layout: BaseBlueprint) {
  const rooms = layout.rooms.filter(room => room.kind === "dormitory");
  return Array.from({ length: 5 }, (_, slotIndex) => rooms
    .filter(room => slotIndex < manualRoomCapacity(room))
    .map(room => ({ roomId: room.id, slotIndex }))).flat();
}

/** Read fixed occupants vertically, without letting AUTO or empty beds consume poster slots. */
export function posterDormOperators(layout: BaseBlueprint, draft: ManualScheduleDraft, shiftIndex: number, legacyHanger: string | null = null): (string | null)[] {
  const shift = draft.shifts[shiftIndex];
  const names: (string | null)[] = dormPositions(layout).flatMap(({ roomId, slotIndex }) => {
    const name = shift?.rooms[roomId]?.operators[slotIndex];
    return name ? [name] : [];
  }).slice(0, POSTER_DORM_SLOTS);
  // Old work files stored the sixth card separately from the shared schedule.
  if (legacyHanger && names.length < POSTER_DORM_SLOTS && !names.includes(legacyHanger)) {
    while (names.length < POSTER_DORM_SLOTS - 1) names.push(null);
    names.push(legacyHanger);
  }
  return Array.from({ length: POSTER_DORM_SLOTS }, (_, index) => names[index] ?? null);
}

/** A poster edit writes its six cards back vertically and makes all other dorm beds AUTO. */
export function assignPosterDormOperator(options: {
  layout: BaseBlueprint; draft: ManualScheduleDraft; shiftIndex: number;
  posterSlot: number; operator: string | null; legacyHanger?: string | null; moveExisting?: boolean;
}) {
  const { layout, draft, shiftIndex, posterSlot, operator, legacyHanger, moveExisting } = options;
  const positions = dormPositions(layout);
  const target = positions[posterSlot];
  if (!Number.isInteger(posterSlot) || !target || posterSlot < 0 || posterSlot >= POSTER_DORM_SLOTS || !draft.shifts[shiftIndex]) return { draft, conflict: null };
  const names = posterDormOperators(layout, draft, shiftIndex, legacyHanger);
  const next = structuredClone(draft);
  const shift = next.shifts[shiftIndex]!;
  for (const room of layout.rooms.filter(room => room.kind === "dormitory")) {
    shift.rooms[room.id] = { ...shift.rooms[room.id], operators: Array.from({ length: manualRoomCapacity(room) }, () => null), autofill: true, autofillSlots: [] };
  }
  positions.forEach(({ roomId, slotIndex }, index) => {
    const assignment = shift.rooms[roomId]!;
    const name = index < POSTER_DORM_SLOTS ? names[index] : null;
    assignment.operators[slotIndex] = name ?? null;
    if (!name) assignment.autofillSlots!.push(slotIndex);
  });
  const result = assignManualOperator({ draft: next, layout, shiftIndex, roomId: target.roomId, slotIndex: target.slotIndex, operator, moveExisting });
  if (result.conflict && !moveExisting) return { ...result, draft };
  for (const room of layout.rooms.filter(room => room.kind === "dormitory")) {
    const assignment = result.draft.shifts[shiftIndex]!.rooms[room.id]!;
    assignment.autofill = true;
    assignment.autofillSlots = assignment.operators.flatMap((name, index) => name ? [] : [index]);
    if (!assignment.autofillSlots.length) delete assignment.autofillSlots;
  }
  return { draft: result.draft, conflict: null };
}
