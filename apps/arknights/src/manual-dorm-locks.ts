import type { ManualScheduleDraft, ManualShift } from "./manual-schedule.ts";

export interface ManualDormLock {
  roomId: string;
  slotIndex: number;
  fromShift: number;
  operator: string | null;
}

export function readManualDormLocks(value: unknown, shiftCount: number): ManualDormLock[] {
  if (!Array.isArray(value)) return [];
  const locks: ManualDormLock[] = [];
  const slots = new Set<string>();
  const operators = new Set<string>();
  for (const entry of value) {
    const lock = entry as Partial<ManualDormLock> | null;
    if (!lock || typeof lock.roomId !== "string" || !lock.roomId ||
        typeof lock.slotIndex !== "number" || !Number.isInteger(lock.slotIndex) || lock.slotIndex < 0 || lock.slotIndex >= 5 ||
        typeof lock.fromShift !== "number" || !Number.isInteger(lock.fromShift) || lock.fromShift < 0 || lock.fromShift >= shiftCount ||
        (lock.operator !== null && (typeof lock.operator !== "string" || !lock.operator))) continue;
    const key = `${lock.roomId}:${lock.slotIndex}`;
    if (slots.has(key) || (lock.operator && operators.has(lock.operator))) continue;
    slots.add(key);
    if (lock.operator) operators.add(lock.operator);
    locks.push({ roomId: lock.roomId, slotIndex: lock.slotIndex, fromShift: lock.fromShift, operator: lock.operator });
  }
  return locks;
}

export function dormLocksAt(draft: ManualScheduleDraft, shiftIndex: number, cycle = 0): ManualDormLock[] {
  return draft.dormLocks?.filter(lock => cycle > 0 || lock.fromShift <= shiftIndex) ?? [];
}

export function applyDormLocks(shift: ManualShift, locks: readonly ManualDormLock[]): ManualShift {
  if (!locks.length) return shift;
  const occupants = new Set(locks.map(lock => lock.operator));
  const rooms = Object.fromEntries(Object.entries(shift.rooms).map(([id, room]) => [id, {
    ...room, operators: room.operators.map(name => occupants.has(name) ? null : name),
  }]));
  for (const { roomId, slotIndex, operator } of locks) {
    const room = rooms[roomId] ??= { operators: [] };
    while (room.operators.length <= slotIndex) room.operators.push(null);
    room.operators[slotIndex] = operator;
  }
  return { ...shift, rooms };
}

export function scheduledShiftWithDormLocks(draft: ManualScheduleDraft, shiftIndex: number): ManualShift | undefined {
  const shift = draft.shifts[shiftIndex];
  return shift && applyDormLocks(shift, dormLocksAt(draft, shiftIndex));
}
