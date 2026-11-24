"use client";

import { useLocale } from "use-intl";
import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
import type Messages from "../../../messages/zh-CN/AK_Raw_components_agent_PlanArtifactView.json";
import { readAgentDailyProduction, type AgentProductionProduct } from "../../agent-plan-production.ts";

const text = createLocalizer<typeof Messages>("AK_Raw_components_agent_PlanArtifactView");
const PRODUCT_LABELS: Record<AgentProductionProduct["id"], keyof typeof Messages> = {
  experience: "productionExperience",
  "lmd-orders": "productionLmd",
  gold: "productionGold",
  orundum: "productionOrundum",
  shards: "productionShards",
};
const PRODUCT_UNITS: Record<AgentProductionProduct["id"], keyof typeof Messages> = {
  experience: "productionExperienceUnit",
  "lmd-orders": "productionLmdUnit",
  gold: "productionPiecesUnit",
  orundum: "productionOrundumUnit",
  shards: "productionPiecesUnit",
};

export function AgentPlanProductionSummary({ production }: { production: unknown }) {
  const locale = useLocale();
  const daily = readAgentDailyProduction(production);
  if (!daily) {
    return <p className="text-xs text-muted-foreground" data-agent-production-unavailable>{text.text(locale, "productionUnavailable")}</p>;
  }
  return (
    <section className="grid gap-2" aria-label={text.text(locale, "dailyProductionWithDrones")} data-agent-daily-production>
      <p className="text-xs text-muted-foreground">{text.text(locale, "dailyProductionWithDrones")}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-5">
        {daily.products.map((product) => (
          <div key={product.id} data-agent-production-product={product.id}>
            <dt className="text-muted-foreground">{text.text(locale, product.id === "lmd-orders" && product.net ? "productionNetLmd" : PRODUCT_LABELS[product.id])}</dt>
            <dd className="mt-0.5 font-number font-medium">
              {product.value === null ? "—" : product.value.toLocaleString(locale)}
              {product.value !== null ? <span className="ml-1 font-normal text-muted-foreground">{text.text(locale, PRODUCT_UNITS[product.id])}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      {daily.products.some((product) => product.net) ? (
        <p className="text-xs text-muted-foreground" data-agent-shard-cost>
          {text.text(locale, daily.shardRecipe === "device" ? "deviceShardCost" : "orirockShardCost")}
        </p>
      ) : null}
    </section>
  );
}
