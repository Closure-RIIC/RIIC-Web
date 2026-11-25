import type { BaseBlueprint } from "@riic/arknights-domain/types";
import { assignManualOperator, manualRoomCapacity, type ManualScheduleDraft } from "./manual-schedule.ts";
import { dormLocksAt, scheduledShiftWithDormLocks } from "./manual-dorm-locks.ts";

export const POSTER_DORM_SLOTS = 6;

function dormPositions(layout: BaseBlueprint) {
  const rooms = layout.rooms.filter(room => room.kind === "dormitory");
  return Array.from({ length: 5 }, (_, slotIndex) => rooms
    .filter(room => slotIndex < manualRoomCapacity(room))
    .map(room => ({ roomId: room.id, slotIndex }))).flat();
}

export function posterDormPosition(layout: BaseBlueprint, posterSlot: number) {
  if (!Number.isInteger(posterSlot) || posterSlot < 0 || posterSlot >= POSTER_DORM_SLOTS) return null;
  return dormPositions(layout)[posterSlot] ?? null;
}

/** Read fixed occupants vertically, without letting AUTO or empty beds consume poster slots. */
export function posterDormOperators(layout: BaseBlueprint, draft: ManualScheduleDraft, shiftIndex: number, legacyHanger: string | null = null): (string | null)[] {
  const shift = scheduledShiftWithDormLocks(draft, shiftIndex);
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
  const locks = dormLocksAt(draft, shiftIndex);
  const isLocked = (roomId: string, slotIndex: number) => locks.some(lock => lock.roomId === roomId && lock.slotIndex === slotIndex);
  const lockedOperators = new Set(locks.map(lock => lock.operator));
  if (isLocked(target.roomId, target.slotIndex) || (operator && lockedOperators.has(operator))) return { draft, conflict: null };
  const names = posterDormOperators(layout, draft, shiftIndex, legacyHanger);
  const next = structuredClone(draft);
  const shift = next.shifts[shiftIndex]!;
  const preservedOperators = new Set(lockedOperators);
  for (const room of layout.rooms.filter(room => room.kind === "dormitory")) {
    const previous = shift.rooms[room.id];
    const operators = Array.from({ length: manualRoomCapacity(room) }, (_, slotIndex) => {
      const planned = previous?.operators[slotIndex] ?? null;
      if (!isLocked(room.id, slotIndex) && !lockedOperators.has(planned)) return null;
      preservedOperators.add(planned);
      return planned;
    });
    shift.rooms[room.id] = { ...previous, operators, autofill: true };
  }
  positions.forEach(({ roomId, slotIndex }, index) => {
    const name = names[index];
    if (name && !isLocked(roomId, slotIndex) && !preservedOperators.has(name)) shift.rooms[roomId]!.operators[slotIndex] = name;
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
