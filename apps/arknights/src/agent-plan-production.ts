import type { BaseBlueprint, MaaJson, RotationJson } from "@riic/arknights-domain/types";
import { droneStoragePlanIndex } from "@riic/arknights-domain/drone-plan-mapping";
import { createCalculatorProductionPresentation } from "./production-summary-adapters.ts";
import { originiumLmdCost, type OriginiumShardRecipe } from "./originium-lmd-cost.ts";

const PRODUCT_IDS = ["experience", "lmd-orders", "gold", "orundum", "shards"] as const;

export interface AgentProductionProduct {
  id: typeof PRODUCT_IDS[number];
  label: string;
  unit: string;
  /** The calculator's displayed daily value, already rounded and including drones. */
  value: number | null;
  net: boolean;
  breakdown: Array<{ label: string; value: number | null; unit: string }>;
}

export interface AgentDailyProduction {
  schemaVersion: 1;
  basis: "daily_24h";
  includesDrones: true;
  source: "solver" | "estimate" | "pending";
  products: AgentProductionProduct[];
  shardRecipe: OriginiumShardRecipe;
  droneAllocations: Array<{
    shift: number;
    durationHours: number;
    room: "trading" | "manufacture";
    index: number;
  }>;
}

function displayedValue(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : Math.round(value);
}

/** Use the calculator's product groups, gold units and shard costs without recalculating yields. */
export function createAgentDailyProduction(input: {
  layout: BaseBlueprint;
  maa: MaaJson;
  rotation: RotationJson;
  shardRecipe?: OriginiumShardRecipe;
}): AgentDailyProduction {
  const shardRecipe = input.shardRecipe ?? "orirock";
  const presentation = createCalculatorProductionPresentation(input);
  const products = presentation.groups.flatMap(group => [group.primary, ...(group.supporting ? [group.supporting] : [])]);
  const shards = products.find(product => product.id === "shards")?.amount;
  const hasShardCosts = !!shards && shards.value !== 0;
  const { cost } = originiumLmdCost(shards?.value ?? null, shardRecipe);
  return {
    schemaVersion: 1,
    basis: "daily_24h",
    includesDrones: true,
    source: presentation.source,
    products: PRODUCT_IDS.map(id => {
      const product = products.find(item => item.id === id)!;
      const net = id === "lmd-orders" && hasShardCosts;
      const value = net
        ? product.amount.value === null || cost === null ? null : product.amount.value - cost
        : product.amount.value;
      return {
        id,
        label: net ? "净龙门币" : product.label,
        unit: product.unit,
        value: displayedValue(value),
        net,
        breakdown: [
          ...product.rows.map(([label, amount, unit]) => ({ label, value: displayedValue(amount), unit })),
          ...(net ? [
            { label: "碎片制造成本", value: cost === null ? null : displayedValue(-cost), unit: product.unit },
            { label: "净收入", value: displayedValue(value), unit: product.unit },
          ] : []),
        ],
      };
    }),
    shardRecipe,
    droneAllocations: input.rotation.shifts.flatMap((shift, position) => {
      const sourcePlanIndex = input.maa.plans[shift.index] ? shift.index : position;
      const drones = input.maa.plans[droneStoragePlanIndex(sourcePlanIndex, input.maa.plans.length)]?.drones;
      return drones?.enable ? [{ shift: position + 1, durationHours: shift.duration_hours, room: drones.room, index: drones.index }] : [];
    }),
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validValue(value: unknown): boolean {
  return value === null || typeof value === "number" && Number.isFinite(value);
}

/** Historical messages contain efficiency fields under this name; never interpret them as yields. */
export function readAgentDailyProduction(value: unknown): AgentDailyProduction | null {
  if (!record(value) || value.schemaVersion !== 1 || value.basis !== "daily_24h" || value.includesDrones !== true
    || !["solver", "estimate", "pending"].includes(String(value.source))
    || !["orirock", "device"].includes(String(value.shardRecipe))
    || !Array.isArray(value.products) || value.products.length !== PRODUCT_IDS.length
    || !Array.isArray(value.droneAllocations)) return null;
  const ids = new Set<string>();
  for (const product of value.products) {
    if (!record(product) || !PRODUCT_IDS.includes(product.id as AgentProductionProduct["id"])
      || ids.has(String(product.id)) || typeof product.label !== "string" || typeof product.unit !== "string"
      || !validValue(product.value) || typeof product.net !== "boolean" || !Array.isArray(product.breakdown)
      || !product.breakdown.every(row => record(row) && typeof row.label === "string" && typeof row.unit === "string" && validValue(row.value))) return null;
    ids.add(String(product.id));
  }
  if (!value.droneAllocations.every(item => record(item)
    && Number.isInteger(item.shift) && Number(item.shift) > 0
    && typeof item.durationHours === "number" && Number.isFinite(item.durationHours) && item.durationHours > 0
    && ["trading", "manufacture"].includes(String(item.room))
    && Number.isInteger(item.index) && Number(item.index) > 0)) return null;
  return value as unknown as AgentDailyProduction;
}

export function agentDailyProductionLines(production: AgentDailyProduction): string[] {
  return [
    `预估日均产出（完整轮班折算24小时，已含无人机）：${production.products.map(product => `${product.label} ${product.value ?? "不可用"} ${product.unit}/日`).join("，")}。`,
    ...(production.products.some(product => product.net)
      ? [`碎片成本假设：${production.shardRecipe === "device" ? "装置，每枚1000" : "固源岩，每枚1600"}龙门币；此摘要使用明确的配方假设，不读取计算器抽屉中的临时成本切换。`]
      : []),
    `产出口径：${JSON.stringify({ source: production.source, shardRecipe: production.shardRecipe, products: production.products })}`,
  ];
}
