import { estimateDailyProduction } from "./daily-production.ts";
import { dailyProductionGroups, type DailyProductionGroup } from "./daily-production-presentation.ts";
import type { ManualPlanResult } from "./manual-plan-result.ts";
import { PRODUCT_ICON_URLS } from "./product-assets.ts";
import type { BaseBlueprint, MaaJson, RotationJson } from "./types.ts";

export type ProductionPresentationSource = "solver" | "estimate" | "pending";

export type ProductionSummaryPresentation = {
  source: ProductionPresentationSource;
  groups: DailyProductionGroup[];
  detailsAvailable: boolean;
  solverProduction: NonNullable<RotationJson["daily"]["production"]> | null;
  droneProduction: RotationJson["daily"]["drone_production"] | undefined;
};

export function createCalculatorProductionPresentation(input: {
  layout: BaseBlueprint;
  maa: MaaJson;
  rotation: RotationJson;
}): ProductionSummaryPresentation {
  const solverProduction = input.rotation.daily.production ?? null;
  const droneProduction = input.rotation.daily.drone_production;
  const estimate = estimateDailyProduction(input);
  const groups = dailyProductionGroups(estimate, solverProduction, droneProduction);
  return {
    source: groups[0]?.source ?? "estimate",
    groups,
    detailsAvailable: groups.length > 0,
    solverProduction,
    droneProduction,
  };
}

function pendingGroups(): DailyProductionGroup[] {
  return [
    { id: "experience", source: "estimate", primary: { id: "experience", label: "经验", unit: "经验", icon: PRODUCT_ICON_URLS.experience, amount: { value: null, natural: null, drones: null }, rows: [] } },
    { id: "lmd", source: "estimate", primary: { id: "lmd-orders", label: "龙门币", unit: "龙门币", icon: PRODUCT_ICON_URLS.lmdOrders, amount: { value: null, natural: null, drones: null }, rows: [] }, supporting: { id: "gold", label: "赤金", unit: "枚", icon: PRODUCT_ICON_URLS.gold, amount: { value: null, natural: null, drones: null }, rows: [] } },
    { id: "orundum", source: "estimate", primary: { id: "orundum", label: "合成玉", unit: "合成玉", icon: PRODUCT_ICON_URLS.orundum, amount: { value: null, natural: null, drones: null }, rows: [] }, supporting: { id: "shards", label: "源石碎片", unit: "枚", icon: PRODUCT_ICON_URLS.shards, amount: { value: null, natural: null, drones: null }, rows: [] } },
  ];
}

export function createManualProductionPresentation(input: ManualPlanResult | null | {
  computed: boolean;
  layout: BaseBlueprint;
  maa: MaaJson;
  evaluation: ({ rotation: RotationJson } & Record<string, unknown>) | null;
}): ProductionSummaryPresentation {
  if (input && "computed" in input) {
    if (!input.computed || !input.evaluation) {
      return {
        source: "pending",
        groups: pendingGroups(),
        detailsAvailable: false,
        solverProduction: null,
        droneProduction: undefined,
      };
    }
    const estimate = estimateDailyProduction({ layout: input.layout, maa: input.maa, rotation: input.evaluation.rotation });
    const solverProduction = input.evaluation.rotation.daily.production ?? null;
    const droneProduction = input.evaluation.rotation.daily.drone_production;
    const groups = dailyProductionGroups(estimate, solverProduction, droneProduction);
    return {
      source: groups[0]?.source ?? "estimate",
      groups,
      detailsAvailable: true,
      solverProduction,
      droneProduction,
    };
  }
  const result = input;
  if (!result) {
    return {
      source: "pending",
      groups: pendingGroups(),
      detailsAvailable: false,
      solverProduction: null,
      droneProduction: undefined,
    };
  }
  const estimate = estimateDailyProduction({
    layout: result.layout,
    maa: result.maa,
    rotation: result.rotation,
  });
  const solverProduction = result.rotation.daily.production ?? null;
  const droneProduction = result.rotation.daily.drone_production;
  const groups = dailyProductionGroups(estimate, solverProduction, droneProduction);
  return {
    source: groups[0]?.source ?? "estimate",
    groups,
    detailsAvailable: true,
    solverProduction,
    droneProduction,
  };
}
