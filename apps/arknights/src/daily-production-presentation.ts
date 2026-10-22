import type { DailyProductionAmount, DailyProductionEstimate } from "./daily-production.ts";
import { PRODUCT_ICON_URLS } from "./product-assets.ts";
import type { RotationJson } from "./types.ts";

type SolverDailyProduction = NonNullable<RotationJson["daily"]["production"]>;
const DAILY_GOLD_VALUE = 5_000;
const DAILY_GOLD_UNITS = DAILY_GOLD_VALUE / 500;

/** Shared value-domain accounting; equivalent gold is not physical factory output. */
export function dailyProductionValueBreakdown(
  production: SolverDailyProduction,
  drone: NonNullable<RotationJson["daily"]["drone_production"]> = { lmd: 0, pure_gold: 0, battle_records: 0 },
) {
  return {
    lmd: { natural: production.lmd, drones: drone.lmd, total: production.lmd + drone.lmd },
    experience: { natural: production.battle_records, drones: drone.battle_records, total: production.battle_records + drone.battle_records },
    gold: {
      natural: production.pure_gold,
      equivalent: production.equivalent_gold ?? 0,
      external: DAILY_GOLD_VALUE,
      drones: drone.pure_gold,
      total: production.pure_gold + (production.equivalent_gold ?? 0) + DAILY_GOLD_VALUE + drone.pure_gold,
    },
    orundum: { total: production.orundum },
  };
}

export type ProductionDetailProduct = {
  net?: boolean;
  id: string;
  label: string;
  unit: string;
  icon: string;
  amount: DailyProductionAmount;
  rows: Array<[string, number | null, string]>;
  relation?: string;
  note?: string;
};

export type DailyProductionGroup = {
  id: string;
  source: "solver" | "estimate";
  primary: ProductionDetailProduct;
  supporting?: ProductionDetailProduct;
};

function dailyAmount(value: number): DailyProductionAmount {
  return { value, natural: value, drones: 0 };
}

function solverProduct(
  id: string,
  label: string,
  unit: string,
  icon: string,
  value: number,
  relation?: string,
): ProductionDetailProduct {
  return {
    id,
    label,
    unit,
    icon,
    amount: dailyAmount(value),
    rows: [["求解器日产量", value, unit]],
    ...(relation ? { relation } : {}),
  };
}

function originiumBottleneck(production: DailyProductionEstimate): string {
  if (production.orundum.bottleneck === "manufacture") return "源石碎片制造";
  if (production.orundum.bottleneck === "trade") return "合成玉订单";
  if (production.orundum.bottleneck === "balanced") return "两段持平";
  if (production.orundum.bottleneck === "none") return "暂无搓玉产线";
  return "产出数据不足";
}

function solverGroups(production: SolverDailyProduction, drone: NonNullable<RotationJson["daily"]["drone_production"]> = { lmd: 0, pure_gold: 0, battle_records: 0 }): DailyProductionGroup[] {
  const values = dailyProductionValueBreakdown(production, drone);
  const goldUnits = Math.floor(production.pure_gold / 500);
  const droneGoldUnits = Math.floor(drone.pure_gold / 500);
  const equivalentGoldUnits = Math.floor((production.equivalent_gold ?? 0) / 500);
  const totalGoldUnits = Math.floor(values.gold.total / 500);
  const totalLmd = values.lmd.total;
  const totalExperience = values.experience.total;
  return [
    {
      id: "experience",
      source: "solver",
      primary: {
        ...solverProduct("experience", "经验", "经验", PRODUCT_ICON_URLS.experience, totalExperience),
        amount: { value: totalExperience, natural: production.battle_records, drones: drone.battle_records },
        rows: [["估算自然制造", production.battle_records, "经验"], ["估算无人机", drone.battle_records, "经验"], ["总产出", totalExperience, "经验"]],
      },
    },
    {
      id: "lmd",
      source: "solver",
      primary: {
        ...solverProduct("lmd-orders", "龙门币", "龙门币", PRODUCT_ICON_URLS.lmdOrders, totalLmd),
        amount: { value: totalLmd, natural: production.lmd, drones: drone.lmd },
        rows: [["估算自然订单", production.lmd, "龙门币"], ["估算无人机订单", drone.lmd, "龙门币"], ["总产出", totalLmd, "龙门币"]],
      },
      supporting: {
        ...solverProduct("gold", "赤金", "枚", PRODUCT_ICON_URLS.gold, totalGoldUnits, "订单原料"),
        amount: { value: totalGoldUnits, natural: goldUnits, drones: droneGoldUnits },
        rows: [["估算自然制造", goldUnits, "枚"], ["估算等效赤金", equivalentGoldUnits, "枚"], ["估算无人机制造", droneGoldUnits, "枚"], ["日常获取", DAILY_GOLD_UNITS, "枚"], ["总产出", totalGoldUnits, "枚"]],
      },
    },
    {
      id: "orundum",
      source: "solver",
      primary: solverProduct("orundum", "合成玉", "合成玉", PRODUCT_ICON_URLS.orundum, production.orundum),
      supporting: solverProduct("shards", "源石碎片", "枚", PRODUCT_ICON_URLS.shards, production.originium_shards, "制造环节"),
    },
  ];
}

export function estimateGroups(
  production: DailyProductionEstimate,
  drone: NonNullable<RotationJson["daily"]["drone_production"]> = { lmd: 0, pure_gold: 0, battle_records: 0 },
): DailyProductionGroup[] {
  const amountWithDrones = (natural: DailyProductionAmount, drones: number): DailyProductionAmount => natural.value === null || natural.natural === null
    ? { value: null, natural: null, drones: null, ...(natural.unavailableReason ? { unavailableReason: natural.unavailableReason } : {}) }
    : { value: natural.natural + drones, natural: natural.natural, drones };
  const lmdOrders = amountWithDrones(production.lmdOrders, drone.lmd);
  const experience = amountWithDrones(production.experience, drone.battle_records);
  const goldValue = amountWithDrones(production.gold, drone.pure_gold);
  const goldUnits: DailyProductionAmount = goldValue.value === null || goldValue.natural === null || goldValue.drones === null
    ? { value: null, natural: null, drones: null, ...(goldValue.unavailableReason ? { unavailableReason: goldValue.unavailableReason } : {}) }
    : {
        value: Math.floor(goldValue.value / 500),
        natural: Math.floor(goldValue.natural / 500),
        drones: Math.floor(goldValue.drones / 500),
      };
  return [
    {
      id: "experience",
      source: "estimate",
      primary: {
        id: "experience",
        label: "经验",
        unit: "经验",
        icon: PRODUCT_ICON_URLS.experience,
        amount: experience,
        rows: [["自然制造", experience.natural, "经验"], ["无人机制造", experience.drones, "经验"]],
      },
    },
    {
      id: "lmd",
      source: "estimate",
      primary: {
        id: "lmd-orders",
        label: "龙门币",
        unit: "龙门币",
        icon: PRODUCT_ICON_URLS.lmdOrders,
        amount: lmdOrders,
        rows: [["自然订单", lmdOrders.natural, "龙门币"], ["无人机订单", lmdOrders.drones, "龙门币"]],
      },
      supporting: {
        id: "gold",
        label: "赤金",
        unit: "枚",
        icon: PRODUCT_ICON_URLS.gold,
        amount: goldUnits,
        rows: [["自然制造", goldUnits.natural, "枚"], ["无人机制造", goldUnits.drones, "枚"]],
        relation: "订单原料",
      },
    },
    {
      id: "orundum",
      source: "estimate",
      primary: {
        id: "orundum",
        label: "合成玉",
        unit: "合成玉",
        icon: PRODUCT_ICON_URLS.orundum,
        amount: production.orundum,
        rows: [["碎片阶段可供", production.orundum.manufactureCapacity, "合成玉"], ["订单阶段可交付", production.orundum.tradeCapacity, "合成玉"]],
        note: `限制环节：${originiumBottleneck(production)}`,
      },
      supporting: {
        id: "shards",
        label: "源石碎片",
        unit: "枚",
        icon: PRODUCT_ICON_URLS.shards,
        amount: production.shards,
        rows: [["自然制造", production.shards.natural, "枚"], ["无人机制造", production.shards.drones, "枚"]],
        relation: "制造环节",
      },
    },
  ];
}

function withSolverTotal(product: ProductionDetailProduct, value: number): ProductionDetailProduct {
  return {
    ...product,
    amount: { ...product.amount, value },
    rows: product.rows.map(([label, rowValue, unit]) => [`估算${label}`, rowValue, unit]),
  };
}

function solverGroupsWithEstimate(
  production: SolverDailyProduction,
  estimate: DailyProductionEstimate,
  drone?: NonNullable<RotationJson["daily"]["drone_production"]>,
): DailyProductionGroup[] {
  const groups = solverGroups(production, drone);
  const estimated = estimateGroups(estimate);
  const originium = estimated.find((group) => group.id === "orundum");
  if (!originium) return groups;
  return groups.map((group) => group.id !== "orundum"
    ? group
    : {
        ...originium,
        source: "solver" as const,
        primary: withSolverTotal(originium.primary, production.orundum),
        ...(originium.supporting
          ? { supporting: withSolverTotal(originium.supporting, production.originium_shards) }
          : {}),
      });
}

export function dailyProductionGroups(
  estimate: DailyProductionEstimate | null,
  solverProduction: SolverDailyProduction | null,
  droneProduction?: NonNullable<RotationJson["daily"]["drone_production"]>,
): DailyProductionGroup[] {
  if (solverProduction && estimate) return solverGroupsWithEstimate(solverProduction, estimate, droneProduction);
  if (solverProduction) return solverGroups(solverProduction, droneProduction);
  return estimate ? estimateGroups(estimate, droneProduction) : [];
}
