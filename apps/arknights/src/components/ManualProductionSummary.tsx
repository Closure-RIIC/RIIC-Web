"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "use-intl";
import { RotateCcw } from "lucide-react";

import { PlanResultSummary } from "@/components/PlanResultSummary";
import { createManualProductionPresentation } from "@/production-summary-adapters";
import type { ManualPlanResult } from "@/manual-plan-result";
import { manualProductionDeltas } from "@/manual-editing";
import { Button } from "@/components/ui/button";

type ManualProductionSummaryProps = {
  result: ManualPlanResult | null;
  activeShift: number;
  controlsSlot?: ReactNode;
  baseline?: ManualPlanResult | null;
  outdated?: boolean;
  pending?: boolean;
  onRecalculate?: () => void;
};

export function ManualProductionSummary({ result, activeShift, controlsSlot, baseline, outdated = false, pending = false, onRecalculate }: ManualProductionSummaryProps) {
  const text = useTranslations("ManualEditingFeedback");
  const locale = useLocale();
  const presentation = createManualProductionPresentation(result);
  const deltas = result && baseline && !outdated && !pending ? manualProductionDeltas(result, baseline) : null;
  const productAnnotations = Object.fromEntries(presentation.groups.flatMap(group => [group.primary, ...(group.supporting ? [group.supporting] : [])]).map(product => {
    const delta = deltas?.[product.id];
    const rounded = delta == null ? null : Math.round(delta * 100) / 100;
    return [product.id, <span key={product.id} data-manual-product-feedback={product.id} data-delta={rounded ?? undefined}
      className={`mt-1 block text-[11px] font-medium leading-snug ${outdated || pending ? "text-amber-800" : rounded === null || rounded === 0 ? "text-[#313131]/65" : rounded > 0 ? "text-emerald-800" : "text-red-800"}`}>
      {outdated || pending ? text("previous") : deltas ? rounded === null ? text("unavailable") : rounded === 0 ? text("unchanged") : new Intl.NumberFormat(locale, { maximumFractionDigits: 2, signDisplay: "always" }).format(rounded) : null}
    </span>];
  }));
  const summaryNotice = <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-[#313131]/10 px-3 py-2 text-xs ${outdated || pending ? "bg-amber-50 text-amber-900" : "text-[#313131]/75"}`} data-manual-calculation-status={pending ? "calculating" : !result ? "empty" : outdated ? "outdated" : "current"}>
    <span role="status" aria-live="polite">{pending ? text("calculating") : !result ? text("notCalculated") : outdated ? text("outdated") : text("current")}</span>
    {deltas ? <span>{text("comparison")}</span> : outdated && !pending && onRecalculate ? <Button type="button" size="sm" variant="ghost" className="min-h-11 sm:min-h-8" onClick={onRecalculate}><RotateCcw />{text("recalculate")}</Button> : null}
  </div>;
  return <PlanResultSummary
    layout={result?.layout ?? { template: "—", drone_cap: 0, scenario: {}, rooms: [] }}
    maa={result?.maa ?? { title: "手动排班", description: "", plans: [] }}
    activeShift={activeShift}
    comparison={null}
    durationMs={result?.elapsedMs ?? 0}
    productionPresentation={presentation}
    mode="manual"
    animateEntrance={false}
    controlsSlot={controlsSlot}
    summaryNotice={summaryNotice}
    productAnnotations={productAnnotations}
  />;
}
