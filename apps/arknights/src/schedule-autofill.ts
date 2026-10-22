export interface MaaRoomAutofillContext {
  group: string;
  skip?: boolean;
  candidates?: string[];
  occupiedSlots: number;
  capacity: number;
}

export function maaRoomAutofill(
  value: unknown,
  context?: MaaRoomAutofillContext,
): boolean {
  if (typeof value === "boolean") return value;
  if (!context || context.group !== "dormitory" || context.skip === true) return false;
  // MAA requires autofill to be disabled when candidates supply the remaining slots.
  if (context.candidates?.length) return false;
  return context.occupiedSlots < context.capacity;
}
