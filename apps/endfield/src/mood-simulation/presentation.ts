import type { StepRoomKey, StepView } from "../step/step-types.ts";

export interface OperatorState {
  name: string;
  room: StepRoomKey;
  mood: number;
  status: "work" | "rest" | "standby" | "zero";
}

/** 使用游标处的引擎快照，不用未来采样点近似当前心情。 */
export function operatorsAt(view: StepView, room?: StepRoomKey): OperatorState[] {
  return view.ops.filter(op => !room || op.roomKey === room).map(op => ({
    name: op.name, room: op.roomKey, mood: op.mood,
    status: op.mood <= 0 ? "zero" : view.rooms[op.roomKey]?.activeRound !== op.round ? "standby" : op.working ? "work" : "rest",
  }));
}
