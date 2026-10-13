"use client";
import { localize as localize_components_PlanResultSummary } from "../i18n/helpers/components_PlanResultSummary.ts";
import { useTranslations, useLocale } from "next-intl";

import { ChevronRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { AnimatedNumber, AnimatedText } from "@/components/AnimatedText";
import { ShiftComparisonDetails } from "@/components/ShiftComparisonCard";
import { Button } from "@/components/ui/button";
import { SummaryMetric } from "@/components/ui/summary-metric";
import { Drawer } from "@/components/ui/drawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type DailyProductionUnavailableReason } from "@/daily-production";
import { type DailyProductionGroup, type ProductionDetailProduct } from "@/daily-production-presentation";
import { createCalculatorProductionPresentation, type ProductionSummaryPresentation } from "@/production-summary-adapters";
import { cn } from "@/lib/utils";

const PRODUCT_KEYS = { experience: "productExperience", "lmd-orders": "productLmd", gold: "productGold", orundum: "productOrundum", shards: "productShards" } as const;
function productLabel(product: { id: string; label: string }, en: boolean) {
  const key = PRODUCT_KEYS[product.id as keyof typeof PRODUCT_KEYS];
  return en && key ? localize_components_PlanResultSummary.text(en, key) : product.label;
}
function productUnit(unit: string, en: boolean) {
  const keys = { "经验": "unitExperience", "龙门币": "unitLmd", "合成玉": "unitOrundum", "枚": "unitPieces" } as const;
  const key = keys[unit as keyof typeof keys];
  return en && key ? localize_components_PlanResultSummary.text(en, key) : unit;
}
import { MOTION_DURATION, MOTION_EASE_OUT } from "@/motion";
import { formatPlanDuration } from "@/rotation-presentation";
import { countShiftPlacementAdjustments } from "@/skland";
import type { BaseBlueprint, MaaJson, RotationJson, ShiftComparison, UserProfile } from "@/types";

type DetailSection = "efficiency" | "comparison";

function dailyNumber(value: number | null): string {
  return value === null ? "—" : Math.round(value).toLocaleString("zh-CN");
}

function unavailableReason(reason: DailyProductionUnavailableReason | undefined, en: boolean): string {
  if (reason === "ambiguous-recipe") return localize_components_PlanResultSummary.text(en, "recipeCannotBeClassified");
  if (reason === "missing-drone-data") return localize_components_PlanResultSummary.text(en, "insufficientDroneData");
  return localize_components_PlanResultSummary.text(en, "insufficientRoomData");
}

const DETAIL_LABEL_KEYS = {
  "自然制造": "estimatedNaturalManufacturing",
  "估算自然制造": "estimatedNaturalManufacturing",
  "无人机制造": "estimatedDroneManufacturing",
  "估算无人机制造": "estimatedDroneManufacturing",
  "估算等效赤金": "estimatedEquivalentGold",
  "日常获取": "dailyAcquisition",
  "自然订单": "estimatedNaturalOrders",
  "估算自然订单": "estimatedNaturalOrders",
  "无人机订单": "estimatedDroneOrders",
  "估算无人机订单": "estimatedDroneOrders",
  "无人机": "estimatedDrones",
  "估算无人机": "estimatedDrones",
  "总产出": "totalOutput",
  "总价值": "totalValue",
  "盈余": "surplus",
  "亏损": "loss",
  "碎片阶段可供": "estimatedShardStageCapacity",
  "估算碎片阶段可供": "estimatedShardStageCapacity",
  "订单阶段可交付": "estimatedOrderStageCapacity",
  "估算订单阶段可交付": "estimatedOrderStageCapacity",
} as const;

const DETAIL_NOTE_KEYS = {
  "限制环节：源石碎片制造": "orundumBottleneckManufacture",
  "限制环节：合成玉订单": "orundumBottleneckTrade",
  "限制环节：两段持平": "orundumBottleneckBalanced",
  "限制环节：暂无搓玉产线": "orundumBottleneckNone",
  "限制环节：产出数据不足": "orundumBottleneckUnavailable",
} as const;

const RELATION_KEYS = {
  "订单原料": "orderMaterial",
  "制造环节": "manufactureStage",
} as const;

function detailLabel(label: string, en: boolean): string {
  const key = DETAIL_LABEL_KEYS[label as keyof typeof DETAIL_LABEL_KEYS];
  return en && key ? localize_components_PlanResultSummary.text(en, key) : label;
}

function detailNote(note: string, en: boolean): string {
  const key = DETAIL_NOTE_KEYS[note as keyof typeof DETAIL_NOTE_KEYS];
  return en && key ? localize_components_PlanResultSummary.text(en, key) : note;
}

function productRelation(relation: string, en: boolean): string {
  const key = RELATION_KEYS[relation as keyof typeof RELATION_KEYS];
  return en && key ? localize_components_PlanResultSummary.text(en, key) : relation;
}

export function PlanResultSummary({
  profile,
  rotation,
  maa,
  layout,
  activeShift,
  comparison,
  durationMs,
  planRevision,
  animationRevision = planRevision,
  animateEntrance = true,
  onEntranceConsumed,
  onPerformanceIssue,
  feedbackDisabled = false,
  controlsSlot,
  productionPresentation,
  presentationTitle,
  presentationSubtitle,
  mode = "calculator",
}: {
  profile?: UserProfile;
  rotation?: RotationJson;
  maa: MaaJson;
  layout: BaseBlueprint;
  activeShift: number;
  comparison: ShiftComparison | null;
  durationMs: number;
  planRevision?: string;
  animationRevision?: string;
  animateEntrance?: boolean;
  onEntranceConsumed?: (revision: string) => void;
  onPerformanceIssue?: () => void;
  feedbackDisabled?: boolean;
  controlsSlot?: ReactNode;
  /** A manual page may supply an estimate-only presentation without entering solver data paths. */
  productionPresentation?: ProductionSummaryPresentation;
  presentationTitle?: ReactNode;
  presentationSubtitle?: ReactNode;
  mode?: "calculator" | "manual";
}) {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale === "en";
  const shouldReduceMotion = useReducedMotion();
  const [animateOnMount] = useState(animateEntrance);
  const [detailSection, setDetailSection] = useState<DetailSection>("efficiency");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const performanceFeedbackPendingRef = useRef(false);
  useEffect(() => {
    if (animateOnMount && planRevision) onEntranceConsumed?.(planRevision);
  }, [animateOnMount, onEntranceConsumed, planRevision]);
  if (!profile && !rotation && !productionPresentation) return null;

  const calculatorPresentation: ProductionSummaryPresentation = rotation
    ? createCalculatorProductionPresentation({ layout, maa, rotation })
    : { source: "pending", groups: [], detailsAvailable: false, solverProduction: null, droneProduction: undefined };
  const activePresentation = productionPresentation ?? calculatorPresentation;
  const solverDaily = activePresentation.solverProduction;
  const productGroups = activePresentation.groups;
  const adjustmentCount = countShiftPlacementAdjustments(comparison);
  const activeDetailSection = detailSection === "comparison" && comparison ? "comparison" : "efficiency";
  const canOpenDetails = activePresentation.detailsAvailable;
  const manual = mode === "manual";
  const openDetails = (section: DetailSection) => {
    setDetailSection(section);
    setDrawerOpen(true);
  };
  const requestPerformanceFeedback = () => {
    performanceFeedbackPendingRef.current = true;
    setDrawerOpen(false);
  };
  const handleDrawerCloseComplete = () => {
    if (!performanceFeedbackPendingRef.current) return;
    performanceFeedbackPendingRef.current = false;
    onPerformanceIssue?.();
  };

  return (
    <>
      <motion.section
        className="relative mb-5 overflow-hidden border border-[#313131]/18 bg-[#F3F1EA] text-[#313131] shadow-[0_12px_30px_rgba(35,38,39,0.10)]"
        aria-label={intl("components_PlanResultSummary.scheduleResultSummary")}
        {...(manual ? { "data-manual-production-summary": "" } : { "data-plan-summary": "", "data-plan-result-summary": "" })}
        data-plan-revision={planRevision}
        data-plan-entrance={animateOnMount ? "animated" : "steady"}
        data-active-shift={activeShift}
        initial={animateOnMount
          ? { opacity: 0, y: shouldReduceMotion ? 0 : 14, scale: shouldReduceMotion ? 1 : 0.992 }
          : false}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: shouldReduceMotion ? 0 : -4 }}
        transition={{ duration: shouldReduceMotion ? MOTION_DURATION.feedback : 0.46, delay: shouldReduceMotion ? 0 : 0.04, ease: MOTION_EASE_OUT }}
      >
        {animateOnMount ? (
          <motion.span key={`accent-${planRevision}`} className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 origin-left bg-[#FFD501]" aria-hidden="true" initial={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: [0, 1, 1, 0] }} transition={{ duration: shouldReduceMotion ? 0 : 0.62, delay: shouldReduceMotion ? 0 : 0.08, times: [0, 0.15, 0.82, 1], ease: MOTION_EASE_OUT }} />
        ) : null}
        <div data-animation-revision={animationRevision} className="grid min-h-[84px] grid-cols-[minmax(10rem,1.05fr)_minmax(0,5fr)] items-stretch max-[820px]:grid-cols-1">
          <motion.button type="button" className={cn("group relative flex min-w-0 items-center justify-between gap-3 overflow-hidden bg-[#272A2B] px-5 py-3 text-left text-white focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[#FFD800] max-[820px]:row-span-1 max-sm:min-h-16", comparison && "row-span-2", !canOpenDetails && "cursor-default")} data-plan-details-trigger="efficiency" data-plan-primary-details-trigger disabled={!canOpenDetails} whileHover={canOpenDetails && !shouldReduceMotion ? { x: 2 } : undefined} whileTap={canOpenDetails && !shouldReduceMotion ? { scale: 0.985 } : undefined} onClick={() => { if (canOpenDetails) openDetails("efficiency"); }}>
            <motion.span className="min-w-0" data-plan-metric initial={animateOnMount ? { opacity: 0, x: shouldReduceMotion ? 0 : -10 } : false} animate={{ opacity: 1, x: 0 }} transition={{ duration: shouldReduceMotion ? MOTION_DURATION.feedback : 0.36, delay: shouldReduceMotion ? 0 : 0.1, ease: MOTION_EASE_OUT }}>
              <strong className="block truncate text-lg font-medium">{presentationTitle ?? <><span className="font-number">{layout.template}</span> {intl("components_PlanResultSummary.basePlan")}</>}</strong>
              <span className="mt-1 block text-[10px] text-white/45">{presentationSubtitle ?? <>{intl("components_PlanResultSummary.generatedIn")} <span className="font-number">{en ? formatPlanDuration(durationMs).replace(" 秒", "s") : formatPlanDuration(durationMs)}</span> · {intl("components_PlanResultSummary.viewDetails")}</>}</span>
            </motion.span>
            <ChevronRight className="size-4 shrink-0 text-white/55 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </motion.button>

          <div className={cn("grid min-w-0 max-sm:grid-cols-2", controlsSlot ? "grid-cols-5" : "grid-cols-3")} aria-label={intl("components_PlanResultSummary.estimatedDailyProduction")} data-daily-production-summary data-production-source={activePresentation.source}>
            {productGroups.map((productGroup, index) => (
              <motion.button
                key={productGroup.id}
                type="button"
                className={cn("group relative flex min-h-[84px] min-w-0 flex-col items-stretch justify-start overflow-hidden border-r border-[#313131]/10 px-3 py-3 text-left transition-colors hover:bg-white/55 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-primary max-sm:min-h-[78px] max-sm:border-t", productGroup.id === "orundum" && !controlsSlot && "max-sm:col-span-2")}
                data-plan-details-trigger="efficiency"
                data-daily-product-group={productGroup.id}
                whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
                disabled={!canOpenDetails}
                onClick={() => { if (canOpenDetails) openDetails("efficiency"); }}
              >
                <motion.span
                  className="relative z-10 block w-full min-w-0 self-start"
                  data-plan-metric
                  initial={animateOnMount ? { opacity: 0, y: shouldReduceMotion ? 0 : 10 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: shouldReduceMotion ? MOTION_DURATION.feedback : 0.36, delay: shouldReduceMotion ? 0 : 0.15 + index * 0.065, ease: MOTION_EASE_OUT }}
                >
                  <span className="block min-w-0" data-daily-product={productGroup.primary.id}>
                    <SummaryMetric
                      label={productLabel(productGroup.primary, en)}
                      value={<AnimatedNumber value={dailyNumber(productGroup.primary.amount.value)} drift={{ x: 0, y: shouldReduceMotion ? 0 : 8 }} />}
                      unit={productGroup.primary.amount.value === null ? undefined : productUnit(productGroup.primary.unit, en)}
                      note={productGroup.primary.amount.value === null && productGroup.primary.amount.unavailableReason ? <span className="mt-1 block truncate text-[10px] font-semibold text-amber-800">{unavailableReason(productGroup.primary.amount.unavailableReason, en)}</span> : null}
                    />
                  </span>
                  {productGroup.supporting ? (
                    <span className="mt-2 flex min-w-0 items-center gap-1.5 bg-[#313131]/[0.045] px-1.5 py-1" data-daily-product={productGroup.supporting.id} data-product-role="supporting">
                      <Image src={productGroup.supporting.icon} alt="" width={16} height={16} unoptimized loading="eager" className="size-4 shrink-0 object-contain" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-[9px] font-medium text-[#313131]/55">{productLabel(productGroup.supporting, en)}</span>
                      <strong className="font-number flex shrink-0 items-baseline gap-0.5 text-[11px] leading-none tabular-nums">
                        <AnimatedNumber value={dailyNumber(productGroup.supporting.amount.value)} drift={{ x: 0, y: shouldReduceMotion ? 0 : 5 }} />
                        {productGroup.supporting.amount.value === null ? null : <span className="text-[8px] font-medium text-[#313131]/45">{productUnit(productGroup.supporting.unit, en)}</span>}
                      </strong>
                    </span>
                  ) : null}
                </motion.span>
                <Image src={productGroup.primary.icon} alt="" width={32} height={32} unoptimized loading="eager" className="pointer-events-none absolute right-1.5 top-1.5 size-8 object-contain opacity-75 transition-transform duration-200 group-hover:scale-105" aria-hidden="true" />
                <motion.span className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-[#313131]/18" aria-hidden="true" initial={animateOnMount ? { scaleX: 0 } : false} animate={{ scaleX: 1 }} transition={{ duration: shouldReduceMotion ? 0 : 0.42, delay: shouldReduceMotion ? 0 : 0.2 + index * 0.065, ease: MOTION_EASE_OUT }} />
              </motion.button>
            ))}
            {controlsSlot ? <div className="contents" data-plan-summary-controls>{controlsSlot}</div> : null}
          </div>

          {comparison ? (
            <motion.button type="button" className="col-start-2 min-w-0 border-t border-[#313131]/10 bg-[#E7E3D8] px-4 py-2.5 text-left transition-colors hover:bg-[#DDD8CA] focus-visible:outline-2 focus-visible:outline-primary max-[820px]:col-start-1 max-sm:min-h-14" data-shift-comparison data-plan-details-trigger="comparison" whileTap={shouldReduceMotion ? undefined : { scale: 0.99 }} onClick={() => openDetails("comparison")}>
              <span className="flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate">{intl.rich("components_PlanResultSummary.rich1", { element1: (chunks) => (<strong className="font-number">{chunks}</strong>), value2: () => (<AnimatedText value={comparison.planIndex + 1} />), value3: () => (<AnimatedText value={`${comparison.score}%`} />) })}</span>
                <span className="shrink-0 text-[#313131]/60">
                  {adjustmentCount === 0
                    ? (intl("components_PlanResultSummary.noChanges"))
                    : (intl.rich("components_PlanResultSummary.rich2", { element1: (chunks) => (<strong className="font-number text-[#313131]">{chunks}</strong>), value2: () => (<AnimatedText value={adjustmentCount} />) }))}
                </span>
              </span>
              <span className="mt-1 block h-1 overflow-hidden bg-[#313131]/10" role="progressbar" aria-label={intl("components_PlanResultSummary.nonDormitoryFacilityMatchPercentage")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={comparison.score}>
                <motion.span
                  className="block h-full bg-primary"
                  initial={animateOnMount
                    ? { scaleX: shouldReduceMotion ? Math.max(0, Math.min(100, comparison.score)) / 100 : 0 }
                    : false}
                  animate={{ scaleX: Math.max(0, Math.min(100, comparison.score)) / 100 }}
                  transition={{ duration: shouldReduceMotion ? 0 : MOTION_DURATION.content, ease: MOTION_EASE_OUT }}
                  style={{ transformOrigin: "left center" }}
                />
              </span>
            </motion.button>
          ) : null}
        </div>
      </motion.section>

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} onCloseComplete={handleDrawerCloseComplete} title={intl("components_PlanResultSummary.scheduleDetails")} description={intl("components_PlanResultSummary.reviewDailyOutputProductionImprovementsAndCurrentStaffingMatch")} width={560}>
        <div className="flex h-full min-h-0 flex-col">
          <Tabs value={activeDetailSection} onValueChange={(value) => setDetailSection(value as DetailSection)} className="min-h-0 flex-1 gap-0">
            <TabsList variant="line" className="w-full justify-start gap-1 border-b border-border/70 px-4 py-0" aria-label={intl("components_PlanResultSummary.scheduleDetailCategories")}>
              <TabsTrigger value="efficiency" className="min-h-11 flex-none px-3">{intl("components_PlanResultSummary.outputImprovements")}</TabsTrigger>
              {comparison ? <TabsTrigger value="comparison" className="min-h-11 flex-none px-3">{intl("components_PlanResultSummary.currentMatch")}</TabsTrigger> : null}
            </TabsList>
            <div data-yeye-scroll="auto" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-6" data-plan-details-section={activeDetailSection}>
              <TabsContent value="efficiency" className="m-0">
                <motion.div initial={{ opacity: 0, x: shouldReduceMotion ? 0 : -12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: shouldReduceMotion ? 0 : MOTION_DURATION.state, ease: MOTION_EASE_OUT }}>
                  <EfficiencyDetails productGroups={productGroups} en={en} solverProduction={solverDaily} droneProduction={activePresentation.droneProduction} />
                </motion.div>
              </TabsContent>
              {comparison ? (
                <TabsContent value="comparison" className="m-0">
                  <motion.div initial={{ opacity: 0, x: shouldReduceMotion ? 0 : 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: shouldReduceMotion ? 0 : MOTION_DURATION.state, ease: MOTION_EASE_OUT }}>
                    <ShiftComparisonDetails comparison={comparison} />
                  </motion.div>
                </TabsContent>
              ) : null}
            </div>
          </Tabs>
          {onPerformanceIssue ? <div className="shrink-0 border-t border-[#313131]/12 px-5 py-2.5">
            <Button
              type="button"
              variant="link"
              className="h-11 justify-start px-0 text-xs font-medium text-[#313131]/58 hover:text-[#313131]"
              data-plan-performance-feedback
              disabled={feedbackDisabled}
              title={feedbackDisabled ? (intl("components_PlanResultSummary.theFullRosterSampleCannotSubmitFeedback")) : undefined}
              onClick={requestPerformanceFeedback}
            >
              {intl("components_PlanResultSummary.reportSolvePerformance")}
            </Button>
            {feedbackDisabled ? <p className="mt-1 text-xs text-[#313131]/55">{intl("components_PlanResultSummary.theFullRosterSampleCannotSubmitFeedback2")}</p> : null}
          </div> : null}
        </div>
      </Drawer>
    </>
  );
}

function ProductionDetailItem({ product, supporting = false, en }: { product: ProductionDetailProduct; supporting?: boolean; en: boolean }) {
  return (
    <article
      className={cn(
        "grid gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]",
        supporting && "ml-6 bg-muted/40 px-3 py-2 sm:ml-12",
      )}
      data-production-detail={product.id}
      data-product-role={supporting ? "supporting" : "primary"}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Image src={product.icon} alt="" width={32} height={32} unoptimized loading="eager" className="size-8 shrink-0 object-contain" aria-hidden="true" />
        <div className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[11px] font-semibold text-muted-foreground">{productLabel(product, en)}</span>
            {product.relation ? <span className="shrink-0 bg-background/80 px-1.5 py-0.5 text-[9px] text-muted-foreground">{productRelation(product.relation, en)}</span> : null}
          </span>
          <strong className={cn("font-technical mt-0.5 flex items-baseline gap-1 leading-none tabular-nums", supporting ? "text-lg" : "text-xl")}>
            <span>{dailyNumber(product.amount.value)}</span>
            {product.amount.value === null ? null : <span className="text-[10px] font-medium text-muted-foreground">{productUnit(product.unit, en)} / {localize_components_PlanResultSummary.text(en, "day")}</span>}
          </strong>
          {product.amount.value === null ? <span className="mt-1 block text-[10px] font-semibold text-amber-800">{unavailableReason(product.amount.unavailableReason, en)}</span> : null}
        </div>
      </div>
      <div className="min-w-0 text-xs">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
          {product.rows.map(([label, value, unit]) => (
            <div key={label} className="flex min-w-0 items-start justify-between gap-2">
              <dt className="min-w-0 flex-1 break-words leading-4 text-muted-foreground">{detailLabel(label, en)}</dt>
              <dd className="font-number shrink-0 font-semibold">{dailyNumber(value)}{value === null || !unit ? "" : ` ${productUnit(unit, en)}`}</dd>
            </div>
          ))}
        </dl>
        {product.note ? <p className="mt-1.5 text-muted-foreground">{detailNote(product.note, en)}</p> : null}
      </div>
    </article>
  );
}

function ProductionDetails({ productGroups, en, solverProduction, droneProduction }: { productGroups: DailyProductionGroup[]; en: boolean; solverProduction?: NonNullable<RotationJson["daily"]["production"]> | null; droneProduction?: NonNullable<RotationJson["daily"]["drone_production"]> }) {
  if (!productGroups.length) return null;
  const drone = droneProduction;
  const totalLmd = solverProduction ? solverProduction.lmd + (drone?.lmd ?? 0) : null;
  const totalGoldValue = solverProduction ? solverProduction.pure_gold + (solverProduction.equivalent_gold ?? 0) + (drone?.pure_gold ?? 0) + 5_000 : null;
  const totalExperience = solverProduction ? solverProduction.battle_records + (drone?.battle_records ?? 0) : null;
  const balance = totalLmd !== null && totalGoldValue !== null ? totalGoldValue - totalLmd : null;
  const displayGroups = productGroups.map((productGroup) => {
    if (productGroup.id !== "lmd" || !productGroup.supporting || !solverProduction) return productGroup;
    const valueRows: Array<[string, number | null, string]> = [
      ["总价值", totalGoldValue, ""],
      [balance !== null && balance >= 0 ? "盈余" : "亏损", balance === null ? null : Math.abs(balance), ""],
    ];
    return {
      ...productGroup,
      supporting: { ...productGroup.supporting, rows: [...productGroup.supporting.rows, ...valueRows] },
    };
  });
  return (
    <section aria-label={localize_components_PlanResultSummary.text(en, "estimatedDailyProductionDetails")} data-production-details data-production-source={productGroups[0].source}>
      <h3 className="text-sm font-semibold">{localize_components_PlanResultSummary.text(en, "estimatedDailyProduction")}</h3>
      <div className="mt-2 divide-y divide-border/70 border-y border-border/70">
        {displayGroups.map((productGroup) => (
          <section key={productGroup.id} className="space-y-2 py-3" data-production-group={productGroup.id}>
            <ProductionDetailItem product={productGroup.primary} en={en} />
            {productGroup.supporting ? <ProductionDetailItem product={productGroup.supporting} supporting en={en} /> : null}
          </section>
        ))}
      </div>
      {solverProduction ? (
        <div className="mt-3 flex items-center justify-between border-b border-border/70 pb-3 text-sm" data-money-book-ratio>
          <span className="text-muted-foreground">{localize_components_PlanResultSummary.text(en, "moneyBookRatio")}</span>
          <strong className="font-number text-base">{totalExperience === 0 ? localize_components_PlanResultSummary.text(en, "noExperienceManufactured") : `${(totalLmd! / totalExperience!).toFixed(2)}`}</strong>
        </div>
      ) : null}
    </section>
  );
}

function EfficiencyDetails({ productGroups, en, solverProduction, droneProduction }: { productGroups: DailyProductionGroup[]; en: boolean; solverProduction?: NonNullable<RotationJson["daily"]["production"]> | null; droneProduction?: NonNullable<RotationJson["daily"]["drone_production"]> }) {
  return (
    <section className="pt-4" aria-label={localize_components_PlanResultSummary.text(en, "outputAndImprovementDetails")} data-efficiency-details>
      <ProductionDetails productGroups={productGroups} en={en} solverProduction={solverProduction} droneProduction={droneProduction} />
    </section>
  );
}
