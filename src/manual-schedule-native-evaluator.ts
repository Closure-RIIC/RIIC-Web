import { evaluateNativeSchedule, type NativeEvalRequestV1, type NativeEvalResponseV1 } from "./lib/infra-eval/client.ts";
import { manualRoomCapacity, manualLayoutForShift, manualRoomForShift, type ManualScheduleDraft } from "./manual-schedule.ts";
import { normalizeOperboxEntries } from "./operbox-normalization.ts";
import { resolveManualSpecialTradeOutput } from "./manual-trade-special-rules.ts";
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

/** The shipped v1 WASM validates scheduled names against room slots only, although
 * settlement supports training_assist. Supply isolated reference shifts for those
 * assistants, then discard them and recompute weights from the real shifts only.
 * This does not change occupancy or cross-facility skills in any real shift. */
async function evaluateNativeWithTrainingReferences(request: NativeEvalRequestV1): Promise<NativeEvalResponseV1> {
  const referenced = new Set(request.shifts.flatMap(shift => shift.rooms.flatMap(room => room.operators.map(operator => operator.name))));
  const assistants = [...new Set(request.shifts.flatMap(shift => shift.training_assist && !referenced.has(shift.training_assist.name) ? [shift.training_assist.name] : []))];
  if (!assistants.length) return evaluateNativeSchedule(request);
  const layout = request.layout as BaseBlueprint;
  const training = layout.rooms.find(room => room.kind === "training_room");
  if (!training) return evaluateNativeSchedule(request);
  const response = await evaluateNativeSchedule({ ...request, shifts: [...request.shifts, ...assistants.map(name => ({
    duration_hours: 1,
    rooms: layout.rooms.map(room => ({ room_id: room.id, operators: room.id === training.id ? [{ name }] : [] })),
  }))] });
  const shifts = response.shifts.slice(0, request.shifts.length);
  const total = request.shifts.reduce((sum, shift) => sum + shift.duration_hours, 0);
  const weighted = { ...response.weighted };
  for (const key of Object.keys(weighted) as Array<keyof typeof weighted>) {
    weighted[key] = shifts.reduce((sum, shift, index) => sum + shift.totals[key] * request.shifts[index]!.duration_hours / total, 0);
  }
  return { ...response, shifts, weighted };
}

/** A product-changing schedule may have a completely vacant shift. The native
 * validator still requires one referenced operator per request; place one from
 * another shift in a throwaway reference shift, then keep only the vacant one. */
async function evaluateVacantShift(request: NativeEvalRequestV1, fallback: NativeEvalRequestV1["scheduled_operators"][number]): Promise<NativeEvalResponseV1> {
  const layout = request.layout as BaseBlueprint;
  const referenceRoom = layout.rooms.find(room => room.kind === "training_room") ?? layout.rooms.find(room => room.kind === "dormitory");
  if (!referenceRoom) throw new Error("空班次需要至少一个辅助设施用于计算。");
  const response = await evaluateNativeSchedule({
    ...request,
    scheduled_operators: [fallback],
    shifts: [...request.shifts, {
      duration_hours: 1,
      rooms: layout.rooms.map(room => ({ room_id: room.id, operators: room.id === referenceRoom.id ? [{ name: fallback.name }] : [] })),
    }],
  });
  const shifts = response.shifts.slice(0, request.shifts.length);
  return { ...response, shifts, weighted: { ...shifts[0]!.totals } };
}

/** The native protocol has one layout, so product-changing shifts need separate calls. */
async function evaluateShiftProducts(input: Parameters<typeof buildNativeEvalRequest>[0]): Promise<NativeEvalResponseV1> {
  const request = buildNativeEvalRequest(input);
  if (!request.scheduled_operators.length) throw new Error("请至少安排一名干员后再计算产出。");
  if (!input.draft.shifts.some(shift => Object.values(shift.rooms).some(room => room.product))) {
    return evaluateNativeWithTrainingReferences(request);
  }
  const responses: NativeEvalResponseV1[] = [];
  for (const [index, shift] of input.draft.shifts.entries()) {
    const nativeShift = request.shifts[index]!;
    const assigned = new Set([...nativeShift.rooms.flatMap(room => room.operators.map(operator => operator.name)), ...(nativeShift.training_assist ? [nativeShift.training_assist.name] : [])]);
    const singleRequest = {
      ...request, scheduled_operators: request.scheduled_operators.filter(operator => assigned.has(operator.name)),
      layout: manualLayoutForShift(input.layout, shift), shifts: [nativeShift],
    };
    responses.push(assigned.size
      ? await evaluateNativeWithTrainingReferences(singleRequest)
      : await evaluateVacantShift(singleRequest, request.scheduled_operators[0]!));
  }
  const total = input.draft.shifts.reduce((sum, shift) => sum + shift.durationHours, 0);
  const weighted = { ...responses[0]!.weighted };
  for (const key of Object.keys(weighted) as Array<keyof typeof weighted>) {
    weighted[key] = responses.reduce((sum, response, index) => sum + response.weighted[key] * input.draft.shifts[index]!.durationHours / total, 0);
  }
  return { ...responses[0]!, weighted, shifts: responses.map((response, index) => ({ ...response.shifts[0]!, index })), diagnostics: responses.flatMap(response => response.diagnostics) };
}

export function buildNativeEvalRequest(input: {
  draft: ManualScheduleDraft;
  layout: BaseBlueprint;
  operbox: readonly OperBoxEntry[] | null;
}): NativeEvalRequestV1 {
  const shifts = input.draft.shifts.map((shift, shiftIndex) => {
    const trainingRoom = input.layout.rooms.find((room) => room.kind === "training_room");
    const rooms = input.layout.rooms.map((room) => {
      const assignment = input.draft.shifts[shiftIndex]?.rooms[room.id];
      return {
        room_id: room.id,
        ...(assignment?.product ? { product: structuredClone(assignment.product) } : {}),
        operators: namesForRoom(input.draft, shiftIndex, room.id, manualRoomCapacity(room))
          .slice(0, room.kind === "training_room" ? 1 : undefined)
          .map((name) => ({ name })),
      };
    });
    const trainer = trainingRoom
      ? namesForRoom(input.draft, shiftIndex, trainingRoom.id, manualRoomCapacity(trainingRoom))[1]
      : undefined;
    return {
      duration_hours: Math.max(1, Math.round(shift.durationHours)),
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
  const response = await evaluateShiftProducts(input);
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
  operbox: readonly OperBoxEntry[] | null;
  shiftIndex: number;
}): ManualRoomEvaluation[] {
  const nativeShift = input.response.shifts[input.shiftIndex];
  if (!nativeShift) return [];
  return nativeShift.rooms.flatMap((room) => {
    if (room.settlement_status !== "evaluated") return [];
    const baseRoom = input.layout.rooms.find((candidate) => candidate.id === room.room_id);
    if (!baseRoom) return [];
    const layoutRoom = manualRoomForShift(baseRoom, input.draft.shifts[input.shiftIndex]?.rooms[room.room_id]);
    const product = layoutRoom.product;
    const factoryRecipe = layoutRoom.kind === "factory" && product && "factory" in product
      ? product.factory.recipe
      : undefined;
    const factoryOutputKind = factoryRecipe === "gold"
      ? "pure_gold"
      : factoryRecipe === "battle_record"
        ? "battle_records"
        : factoryRecipe === "originium"
          ? "originium_shards"
          : undefined;
    const outputKind = layoutRoom.kind === "trade_post"
      ? (product && "trade" in product && product.trade.order === "originium" ? "originium_shards" : "lmd")
      : factoryOutputKind ?? (layoutRoom.kind === "power_plant" ? "power" : undefined);
    const specialTrade = layoutRoom.kind === "trade_post"
      ? resolveManualSpecialTradeOutput({
          level: layoutRoom.level,
          order: product && "trade" in product ? product.trade.order : "gold",
          members: namesForRoom(input.draft, input.shiftIndex, room.room_id, manualRoomCapacity(layoutRoom)).map(name => {
            const member = input.operbox?.find(entry => entry.name === name);
            return { name, ...(member ? { id: member.id, elite: member.elite } : {}) };
          }),
        })
      : undefined;
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
      ...(specialTrade?.rule ? { specialTradeAnchor: specialTrade.rule } : {}),
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
  const response = await evaluateShiftProducts(input);
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
        trade: shifts.reduce((sum, shift) => sum + shift.scores.trade_score * shift.duration_hours / totalHours, 0),
        manufacture: shifts.reduce((sum, shift) => sum + shift.scores.manu_prod_sum * shift.duration_hours / totalHours, 0),
        power: shifts.reduce((sum, shift) => sum + shift.scores.power_charge_sum * shift.duration_hours / totalHours, 0),
      },
    },
    roomsByShift,
    warnings,
    elapsedMs: performance.now() - startedAt,
  } satisfies ManualScheduleEvaluation;
  return evaluation;
}
