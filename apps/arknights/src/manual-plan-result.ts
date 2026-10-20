import { estimateDailyProduction } from "./daily-production.ts";
import { droneProductionForSelectedMaaTargets, equivalentGoldForRotation } from "./drone-production-core.ts";
import { manualScheduleToMaa, type ManualScheduleDraft } from "./manual-schedule.ts";
import { evaluateManualSchedule, type ManualEvaluationWarning, type ManualRoomEvaluation } from "./manual-schedule-evaluator.ts";
import { evaluateCrossFacilityEfficiency, evaluateManualScheduleWithNativeEngine } from "./manual-schedule-native-evaluator.ts";
import type { BaseBlueprint, MaaJson, OperBoxEntry, RotationJson } from "./types.ts";

export type ManualPlanResult = {
  kind: "manual";
  revision: 1;
  layout: BaseBlueprint;
  maa: MaaJson;
  rotation: RotationJson;
  roomsByShift: ManualRoomEvaluation[][];
  warnings: ManualEvaluationWarning[];
  elapsedMs: number;
};

function applyManualProduction(input: {
  layout: BaseBlueprint;
  maa: MaaJson;
  rotation: RotationJson;
}) {
  const natural = estimateDailyProduction(input);
  input.rotation.daily.production = {
    lmd: natural.lmdOrders.natural ?? 0,
    pure_gold: natural.gold.natural ?? 0,
    battle_records: natural.experience.natural ?? 0,
    originium_shards: natural.shards.natural ?? 0,
    orundum: natural.orundum.value ?? 0,
    equivalent_gold: equivalentGoldForRotation(input.rotation),
  };
  input.rotation.daily.drone_production = droneProductionForSelectedMaaTargets(input);
}

export async function assembleNativeManualPlanResult(input: {
  draft: ManualScheduleDraft;
  layout: BaseBlueprint;
  operbox: readonly OperBoxEntry[] | null;
}): Promise<ManualPlanResult> {
  const layout = structuredClone(input.layout);
  const draft = structuredClone(input.draft);
  const maa = manualScheduleToMaa(draft, layout, draft.fiammettaEnabled);
  const evaluation = await evaluateManualScheduleWithNativeEngine({ draft, layout, operbox: input.operbox });
  const rotation = structuredClone(evaluation.rotation);
  applyManualProduction({ layout, maa, rotation });
  return {
    kind: "manual",
    revision: 1,
    layout,
    maa,
    rotation,
    roomsByShift: evaluation.roomsByShift,
    warnings: evaluation.warnings,
    elapsedMs: evaluation.elapsedMs,
  };
}

export async function assemblePaperManualPlanResult(input: {
  draft: ManualScheduleDraft;
  layout: BaseBlueprint;
  operbox: readonly OperBoxEntry[] | null;
}): Promise<ManualPlanResult> {
  const layout = structuredClone(input.layout);
  const draft = structuredClone(input.draft);
  const maa = manualScheduleToMaa(draft, layout, draft.fiammettaEnabled);
  const crossFacilityEfficiencyByShift = await evaluateCrossFacilityEfficiency({ draft, layout, operbox: input.operbox });
  const evaluation = evaluateManualSchedule({ draft, layout, operbox: input.operbox, crossFacilityEfficiencyByShift });
  const rotation = structuredClone(evaluation.rotation);
  applyManualProduction({ layout, maa, rotation });
  return {
    kind: "manual",
    revision: 1,
    layout,
    maa,
    rotation,
    roomsByShift: evaluation.roomsByShift,
    warnings: evaluation.warnings,
    elapsedMs: evaluation.elapsedMs,
  };
}
