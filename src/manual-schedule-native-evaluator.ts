import { factoryRecipeFor, tradeOrderFor } from "./blueprint.ts";
import { evaluateNativeSchedule, type NativeEvalRequestV1, type NativeEvalResponseV1 } from "./lib/infra-eval/client.ts";
import { manualRoomCapacity, type ManualScheduleDraft } from "./manual-schedule.ts";
import { normalizeOperboxEntries } from "./operbox-normalization.ts";
import type { ManualEvaluationWarning, ManualRoomEvaluation, ManualScheduleEvaluation } from "./manual-schedule-evaluator.ts";
import type { BaseBlueprint, OperBoxEntry, RotationRoomLine, RotationShift } from "./types.ts";

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function namesForRoom(draft: ManualScheduleDraft, shiftIndex: number, roomId: string, capacity: number): string[] {
  return (draft.shifts[shiftIndex]?.rooms[roomId]?.operators ?? [])
    .slice(0, capacity)
    .filter((name): name is string => Boolean(name?.trim()));
}

export type CrossFacilityEfficiencyByShift = ReadonlyMap<number, ReadonlyMap<string, number>>;

export function buildNativeEvalRequest(input: {
  draft: ManualScheduleDraft;
  layout: BaseBlueprint;
  operbox: readonly OperBoxEntry[] | null;
}): NativeEvalRequestV1 {
  const shifts = input.draft.shifts.map((shift, shiftIndex) => {
    const trainingRoom = input.layout.rooms.find((room) => room.kind === "training_room");
    const rooms = input.layout.rooms.map((room) => ({
      room_id: room.id,
      operators: namesForRoom(input.draft, shiftIndex, room.id, manualRoomCapacity(room))
        .slice(0, room.kind === "training_room" ? 1 : undefined)
        .map((name) => ({ name })),
    }));
    const trainer = trainingRoom
      ? namesForRoom(input.draft, shiftIndex, trainingRoom.id, manualRoomCapacity(trainingRoom))[1]
      : undefined;
    return {
      duration_hours: Math.round(shift.durationHours),
      rooms,
      ...(trainer ? { training_assist: { name: trainer } } : {}),
    };
  });

  const assignedNames = new Set(shifts.flatMap((shift) => [
    ...shift.rooms.flatMap((room) => room.operators.map((operator) => operator.name)),
    ...(shift.training_assist ? [shift.training_assist.name] : []),
  ]));
  const operboxByName = new Map(
    normalizeOperboxEntries(input.operbox ?? [])
      .filter((entry) => entry.own)
      .map((entry) => [entry.name, entry]),
  );
  for (const name of assignedNames) {
    if (!operboxByName.has(name)) throw new Error(`[MISSING_SCHEDULED_OPERATOR] ${name} is not owned in the current operator box`);
  }

  return {
    schema_version: 1,
    layout: structuredClone(input.layout),
    scheduled_operators: [...assignedNames].map((name) => operboxByName.get(name)!),
    shifts,
  };
}

export async function evaluateCrossFacilityEfficiency(input: {
  draft: ManualScheduleDraft;
  layout: BaseBlueprint;
  operbox: readonly OperBoxEntry[] | null;
}): Promise<CrossFacilityEfficiencyByShift> {
  const response = await evaluateNativeSchedule(buildNativeEvalRequest(input));
  return new Map(response.shifts.map((shift, shiftIndex) => [
    shiftIndex,
    new Map(shift.rooms
      .filter((room) => room.settlement_status === "evaluated")
      .map((room) => [room.room_id, room.display_global_basis_points / 1_000])),
  ]));
}

function roomEvaluation(input: {
  response: NativeEvalResponseV1;
  draft: ManualScheduleDraft;
  layout: BaseBlueprint;
  shiftIndex: number;
}): ManualRoomEvaluation[] {
  const nativeShift = input.response.shifts[input.shiftIndex];
  if (!nativeShift) return [];
  return nativeShift.rooms.flatMap((room) => {
    if (room.settlement_status !== "evaluated") return [];
    const layoutRoom = input.layout.rooms.find((candidate) => candidate.id === room.room_id);
    if (!layoutRoom) return [];
    const factoryRecipe = layoutRoom.kind === "factory" ? factoryRecipeFor(layoutRoom) : undefined;
    const factoryOutputKind = factoryRecipe === "gold"
      ? "pure_gold"
      : factoryRecipe === "battle_record"
        ? "battle_records"
        : factoryRecipe === "originium"
          ? "originium_shards"
          : undefined;
    const outputKind = layoutRoom.kind === "trade_post"
      ? (tradeOrderFor(layoutRoom) === "originium" ? "originium_shards" : "lmd")
      : factoryOutputKind ?? (layoutRoom.kind === "power_plant" ? "power" : undefined);
    return [{
      roomId: room.room_id,
      members: namesForRoom(input.draft, input.shiftIndex, room.room_id, manualRoomCapacity(layoutRoom)),
      baseEfficiency: room.display_base_basis_points / 1_000,
      skillEfficiency: room.display_skill_basis_points / 1_000,
      globalEfficiency: room.display_global_basis_points / 1_000,
      totalEfficiency: room.display_total_basis_points / 1_000,
      orderMultiplier: room.order_multiplier_basis_points / 1_000,
      finalEfficiency: room.display_final_basis_points / 1_000,
      goldEquivalentEfficiency: room.gold_equivalent_basis_points / 1_000,
      tradeEquivalentEfficiency: room.trade_equivalent_basis_points / 1_000,
      dailyOutput: null,
      ...(outputKind ? { outputKind } : {}),
    }];
  });
}

function roomLine(room: ManualRoomEvaluation, kind: BaseBlueprint["rooms"][number]["kind"]): RotationRoomLine {
  const line: RotationRoomLine = {
    room_id: room.roomId,
    ...(kind === "power_plant" ? {} : { base_efficiency: room.baseEfficiency }),
    equivalent_efficiency: kind === "trade_post"
      ? room.tradeEquivalentEfficiency ?? room.skillEfficiency
      : room.skillEfficiency,
    global_efficiency: room.globalEfficiency,
    total_efficiency: room.totalEfficiency,
    final_efficiency: room.finalEfficiency,
    order_multiplier: room.orderMultiplier,
  };
  if (kind === "trade_post") {
    line.trade_score = room.finalEfficiency;
    line.trade_skill_pct = room.skillEfficiency * 100;
    line.trade_display_pct = (room.skillEfficiency + room.globalEfficiency) * 100;
    line.trade_equivalent_efficiency = room.tradeEquivalentEfficiency ?? room.skillEfficiency;
    line.gold_equivalent_efficiency = room.goldEquivalentEfficiency;
  } else if (kind === "factory") {
    line.manu_score = room.finalEfficiency * 100;
    line.manu_prod_skill = room.skillEfficiency * 100;
    line.manu_display_pct = (room.skillEfficiency + room.globalEfficiency) * 100;
  } else if (kind === "power_plant") {
    line.power_score = room.finalEfficiency;
    line.power_skill_pct = room.skillEfficiency * 100;
    line.power_display_pct = room.skillEfficiency * 100;
    line.power_charge_speed_pct = room.skillEfficiency * 100;
  }
  return line;
}

export async function evaluateManualScheduleWithNativeEngine(input: {
  draft: ManualScheduleDraft;
  layout: BaseBlueprint;
  operbox: readonly OperBoxEntry[] | null;
}): Promise<ManualScheduleEvaluation> {
  const startedAt = performance.now();
  const request = buildNativeEvalRequest(input);
  const response = await evaluateNativeSchedule(request);
  const totalHours = input.draft.shifts.reduce((sum, shift) => sum + shift.durationHours, 0) || 24;
  const roomsByShift = input.draft.shifts.map((_, index) => roomEvaluation({ ...input, response, shiftIndex: index }));
  const shifts: RotationShift[] = input.draft.shifts.map((shift, index) => {
    const nativeShift = response.shifts[index];
    if (!nativeShift) throw new Error(`WASM response is missing shift ${index + 1}`);
    const rooms = roomsByShift[index] ?? [];
    const trade = nativeShift.totals.trade_final_basis_points / 1_000;
    const manufacture = nativeShift.totals.manufacture_basis_points / 1_000;
    const power = nativeShift.totals.power_basis_points / 1_000;
    return {
      index,
      duration_hours: shift.durationHours,
      active_teams: [],
      resting_team: "",
      scores: {
        trade_score: trade,
        manu_prod_sum: manufacture,
        power_charge_sum: power,
        room_lines: rooms.map((room) => {
          const kind = input.layout.rooms.find((candidate) => candidate.id === room.roomId)?.kind;
          return roomLine(room, kind ?? "workshop");
        }),
      },
      weighted_trade: rounded(trade * shift.durationHours / totalHours),
      weighted_manu: rounded(manufacture * shift.durationHours / totalHours),
      weighted_power: rounded(power * shift.durationHours / totalHours),
    };
  });
  const warnings: ManualEvaluationWarning[] = [{
    code: "unsupported-rule",
    message: `Rust 原生评估 ${response.engine.ruleset}：各班独立结算，不模拟跨班心情、库存、无人机或菲亚梅塔运行时状态。`,
  }];
  const evaluation = {
    rotation: {
      profile: "abc_12_12_12" as const,
      shifts,
      daily: {
        trade: response.weighted.trade_final_basis_points / 1_000,
        manufacture: response.weighted.manufacture_basis_points / 1_000,
        power: response.weighted.power_basis_points / 1_000,
      },
    },
    roomsByShift,
    warnings,
    elapsedMs: performance.now() - startedAt,
  } satisfies ManualScheduleEvaluation;
  return evaluation;
}
