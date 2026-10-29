import type { AppLocale } from "@riic/contracts/locale";
import type { DailyProductionGroup } from "./daily-production-presentation.ts";
import { localize } from "./i18n/helpers/components_PlanResultSummary.ts";

export type OriginiumShardRecipe = "orirock" | "device";

// Game manufacture formulae 13 (Orirock) and 14 (Device) both produce one shard.
// Keep the public solver's gross, non-negative production fields unchanged.
export function withOriginiumLmdCost(groups: DailyProductionGroup[], recipe: OriginiumShardRecipe, en: AppLocale): DailyProductionGroup[] {
  const shards = groups.find((group) => group.id === "orundum")?.supporting?.amount;
  if (!shards || shards.value === 0) return groups;
  const unitCost = recipe === "device" ? 1_000 : 1_600;
  const cost = shards.value === null ? null : shards.value * unitCost;
  return groups.map((group): DailyProductionGroup => {
    if (group.id !== "lmd") return group;
    const gross = group.primary.amount;
    const net = gross.value === null || cost === null ? null : gross.value - cost;
    return {
      ...group,
      primary: {
        ...group.primary,
        net: true,
        label: localize.text(en, "productNetLmd"),
        amount: {
          value: net,
          natural: gross.natural === null || cost === null ? null : gross.natural - cost,
          drones: gross.drones,
          ...(gross.unavailableReason || shards.unavailableReason
            ? { unavailableReason: gross.unavailableReason ?? shards.unavailableReason }
            : {}),
        },
        rows: [
          ...group.primary.rows,
          [localize.text(en, "shardManufacturingCost"), cost === null ? null : -cost, group.primary.unit],
          [localize.text(en, "netIncome"), net, group.primary.unit],
        ],
        note: localize.text(en, "shardCostAssumption", {
          recipe: localize.text(en, recipe === "device" ? "deviceRecipeName" : "orirockRecipeName"),
          cost: unitCost,
        }),
      },
    };
  });
}
