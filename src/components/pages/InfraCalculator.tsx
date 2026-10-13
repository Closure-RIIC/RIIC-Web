"use client";
import { localize as localize_components_pages_InfraCalculator } from "../../i18n/helpers/components_pages_InfraCalculator.ts";

import { useTranslations, useLocale } from "next-intl";

import { ArrowRight, Download, Ellipsis, FlaskConical, Keyboard, Loader2, PencilLine, Play, RefreshCw, Search, Settings2, SlidersHorizontal, X } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ScheduleBoard, ShiftTabs } from "@/components";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlanResultSummarySkeleton } from "@/components/PlanResultSummarySkeleton";
import { ScheduleRunButton } from "@/components/ScheduleRunButton";
import { SkeletonSuspense } from "@/components/ui/skeleton-swap";

import type { FactoryRecipe, TradeOrder } from "@/blueprint";
import { cn } from "@/lib/utils";
import type { ShiftDirection } from "@/motion";
import { onboardingStepStatuses, shouldShowAnonymousSampleTrial } from "@/onboarding";
import type { RoomRow } from "@/schedule";
import type { OperatorAssetRecord } from "@/operatorPortraits";
import { operatorsWithoutLayoutSkills } from "@/layout-skill-highlight";
import type {
  BaseBlueprint,
  FeedbackData,
  MaaPlan,
  OperBoxEntry,
  PublicPlanData,
  ShiftComparison,
} from "@/types";

const PlanResultSummary = lazy(() => import("@/components/PlanResultSummary").then((module) => ({ default: module.PlanResultSummary })));
const PlanSupportSummary = lazy(() => import("@/components/PlanSupportSummary").then((module) => ({ default: module.PlanSupportSummary })));
const ShortcutGuideDialog = lazy(() => import("@/components").then((module) => ({ default: module.ShortcutGuideDialog })));
const UpgradeSimulationDialog = lazy(() => import("@/components/UpgradeSimulationDialog").then((module) => ({ default: module.UpgradeSimulationDialog })));
const DroneTargetPicker = lazy(() => import("@/components/DroneTargetPicker").then(module => ({ default: module.DroneTargetPicker })));
const ScheduleImageExportAction = lazy(() => import("@/components/ScheduleImageExportAction").then(module => ({ default: module.ScheduleImageExportAction })));
const PlanActionsDialog = lazy(() => import("@/components/PlanActionsDialog").then(module => ({ default: module.PlanActionsDialog })));

function DeferredResultLoading() {
  return <PlanResultSummarySkeleton />;
}

function Panel({ children, className = "", action, title, icon }: {
  children: ReactNode;
  className?: string;
  action?: ReactNode;
  title?: string;
  icon?: ReactNode;
}) {
  return (
    <section className={cn("min-w-0 py-5", className)}>
      {title || icon || action ? (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          {title || icon ? <div className="flex min-w-0 items-start gap-2">{icon}<h2 className="text-sm font-semibold tracking-tight">{title}</h2></div> : null}
          {action ? <div className={cn("ms-auto min-w-0 max-sm:w-full", !title && !icon && "w-full")}>{action}</div> : null}
        </header>
      ) : null}
      <div>{children}</div>
    </section>
  );
}

function CalculatorStartPanel({
  websiteAuthenticated,
  hasPersonalBox,
  sampleLoading,
  loading,
  plannerReady,
  runCooldownSeconds,
  accountControl,
  onStartPersonalFlow,
  onRunSampleTrial,
  onRun,
  onOpenSetup,
  onDismissOnboarding,
}: {
  websiteAuthenticated: boolean;
  hasPersonalBox: boolean;
  sampleLoading: boolean;
  loading: boolean;
  plannerReady: boolean;
  runCooldownSeconds: number;
  accountControl?: ReactNode;
  onStartPersonalFlow: () => void;
  onRunSampleTrial: () => Promise<boolean>;
  onRun: () => void;
  onOpenSetup: () => void;
  onDismissOnboarding: () => void;
}) {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale === "en";
  const statuses = onboardingStepStatuses({
    authenticated: websiteAuthenticated,
    hasPersonalBox,
    hasSuccessfulPlan: false,
  });
  const steps = [
    {
      title: intl("components_pages_InfraCalculator.signIn"),
      eyebrow: intl("components_pages_InfraCalculator.account"),
      description: localize_components_pages_InfraCalculator.text(en, "additional1", { choice1: ((en)) && (websiteAuthenticated) ? "yes" : "no", choice2: (!(en)) && (websiteAuthenticated) ? "yes" : "no" }),
      group: "control",
    },
    {
      title: intl("components_pages_InfraCalculator.importYourBox"),
      eyebrow: intl("components_pages_InfraCalculator.operators"),
      description: localize_components_pages_InfraCalculator.text(en, "additional2", { choice1: ((en)) && (hasPersonalBox) ? "yes" : "no", choice2: (!(en)) && (hasPersonalBox) ? "yes" : "no" }),
      group: "trading",
    },
    {
      title: intl("components_pages_InfraCalculator.generateYourFirstPlan"),
      eyebrow: intl("components_pages_InfraCalculator.baseSchedule"),
      description: intl("components_pages_InfraCalculator.getThreeShiftsKeyRoomNotesAndAnMaa"),
      group: "manufacture",
    },
  ] as const;
  const personalActionLabel = runCooldownSeconds > 0 && websiteAuthenticated && hasPersonalBox
    ? intl("components_pages_InfraCalculator.retryInS2", { runCooldownSeconds: runCooldownSeconds })
    : localize_components_pages_InfraCalculator.text(en, "additional3", { choice1: ((en)) && (!websiteAuthenticated) ? "yes" : "no", choice2: ((en) && (!websiteAuthenticated)) && (hasPersonalBox) ? "yes" : "no", choice3: ((en) && !(!websiteAuthenticated)) && (hasPersonalBox && !plannerReady) ? "yes" : "no", choice4: ((en) && !(!websiteAuthenticated) && !(hasPersonalBox && !plannerReady)) && (hasPersonalBox) ? "yes" : "no", choice5: (!(en)) && (!websiteAuthenticated) ? "yes" : "no", choice6: (!(en) && (!websiteAuthenticated)) && (hasPersonalBox) ? "yes" : "no", choice7: (!(en) && !(!websiteAuthenticated)) && (hasPersonalBox && !plannerReady) ? "yes" : "no", choice8: (!(en) && !(!websiteAuthenticated) && !(hasPersonalBox && !plannerReady)) && (hasPersonalBox) ? "yes" : "no" });
  const personalActionAriaLabel = hasPersonalBox ? (intl("components_pages_InfraCalculator.generateSchedule")) : (intl("components_pages_InfraCalculator.configureBoxAndLayout"));
  const personalPlanUnavailable = websiteAuthenticated && hasPersonalBox && !plannerReady;
  const showAnonymousSampleTrial = shouldShowAnonymousSampleTrial({
    authenticated: websiteAuthenticated,
    hasPersonalBox,
    onboardingActive: true,
  });
  const actionControls = (
    <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row sm:flex-wrap sm:items-center" data-calculator-controls>
      <Button
        type="button"
        size="lg"
        className="min-h-11 sm:min-w-44"
        aria-label={personalActionAriaLabel}
        title={personalPlanUnavailable ? (intl("components_pages_InfraCalculator.plannerUnavailable")) : undefined}
        disabled={sampleLoading || loading || personalPlanUnavailable || runCooldownSeconds > 0}
        onClick={hasPersonalBox && websiteAuthenticated ? onRun : onStartPersonalFlow}
      >
        {loading && hasPersonalBox ? <Loader2 className="animate-spin" /> : <Play />}
        {loading && hasPersonalBox ? intl("components_pages_InfraCalculator.generatingYourFirstPlan") : personalActionLabel}
      </Button>
      {hasPersonalBox ? (
        <div className="inline-flex min-w-0 max-sm:[&_[data-skland-account-control]]:rounded-l-none" data-calculator-setup-group>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={accountControl
              ? "h-9 rounded-r-none max-sm:h-11"
              : "h-9 max-sm:h-11"}
            aria-label={intl("components_pages_InfraCalculator.configureBoxAndBase")}
            onClick={onOpenSetup}
          >
            <Settings2 />{intl("components_pages_InfraCalculator.adjustBoxBase")}
          </Button>
          {accountControl}
        </div>
      ) : null}
      {!hasPersonalBox && accountControl ? <div className="self-center">{accountControl}</div> : null}
      <Button type="button" variant="ghost" className="min-h-11" disabled={sampleLoading} onClick={onDismissOnboarding}>
        {intl("components_pages_InfraCalculator.skipForNow")}
      </Button>
    </div>
  );

  return (
    <section
      className="relative isolate flex min-h-[calc(100svh-3rem)] items-center overflow-hidden bg-[#f7f5ec] px-4 py-8 sm:px-6 md:min-h-svh lg:px-8"
      aria-label={intl("components_pages_InfraCalculator.scheduleSetup")}
      data-calculator-start-panel
      data-onboarding-active="true"
    >
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[34%] bg-[linear-gradient(135deg,transparent_0_38%,rgb(49_49_49/0.035)_38%_62%,transparent_62%)] lg:block" aria-hidden="true" />
      <div className="relative mx-auto flex w-full max-w-5xl flex-col justify-center">
        <ol
          className="grid w-full gap-3 md:grid-cols-2 xl:grid-cols-3"
          aria-label={intl("components_pages_InfraCalculator.stepsToGenerateYourSchedule")}
        >
            {steps.map((step, index) => {
              const status = statuses[index];
              const statusLabel = localize_components_pages_InfraCalculator.text(en, "additional4", { choice1: ((en)) && (status === "complete") ? "yes" : "no", choice2: ((en) && !(status === "complete")) && (status === "current") ? "yes" : "no", choice3: (!(en)) && (status === "complete") ? "yes" : "no", choice4: (!(en) && !(status === "complete")) && (status === "current") ? "yes" : "no" });
              return (
                <li
                  key={step.title}
                  className={cn(
                    "min-w-0",
                    index === 2 && "md:col-span-2 xl:col-span-1",
                  )}
                  aria-current={status === "current" ? "step" : undefined}
                >
                  <article
                    className={cn(
                      "infra-room-surface onboarding-technical-card relative h-full min-h-40 overflow-hidden px-4 py-4 text-white",
                      status === "current" && "ring-1 ring-[var(--room-accent)]",
                    )}
                    data-room-group={step.group}
                  >
                    <div className="infra-room-emblem onboarding-technical-card-emblem pointer-events-none absolute inset-0 bg-left bg-no-repeat" aria-hidden="true" />
                    <div className="relative z-10 flex h-full flex-col">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-h-6 items-center gap-2">
                          <span className="h-5 w-1 shrink-0 bg-[var(--room-accent)]" aria-hidden="true" />
                          <p className="text-xs font-medium tracking-wide text-white/66">
                            <span className="font-number">0{index + 1}</span> · {step.eyebrow}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 border border-white/14 bg-white/6 px-2 py-1 text-[0.68rem] font-medium tracking-wide text-white/58",
                            status === "current" && "border-[var(--room-accent)] text-[var(--room-accent)]",
                            status === "complete" && "text-white/78",
                          )}
                        >
                          {statusLabel}
                        </span>
                      </div>
                      <h2 className="mt-5 text-xl font-semibold tracking-[-0.025em] text-[var(--room-accent)]">
                        {step.title}
                      </h2>
                      <p className="mt-2 text-xs leading-5 text-white/58">{step.description}</p>
                    </div>
                  </article>
                </li>
              );
            })}
        </ol>

        {showAnonymousSampleTrial ? (
          <section
            className="mt-5 flex flex-col gap-4 border border-[#d8c64a] bg-[#fffdf2] px-4 py-4 shadow-[0_10px_28px_rgb(49_49_49/0.07)] sm:flex-row sm:items-center sm:justify-between sm:px-5"
            aria-labelledby="anonymous-sample-trial-title"
            aria-busy={sampleLoading}
            data-anonymous-sample-trial
          >
            <div className="min-w-0">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center bg-[#313131] text-[#FFD800]" aria-hidden="true">
                  <FlaskConical className="size-4" />
                </span>
                <div className="min-w-0">
                  <h2 id="anonymous-sample-trial-title" className="text-sm font-semibold leading-6 text-[#313127]">
                     {intl("components_pages_InfraCalculator.wantToPreviewSchedulingWithoutSigningIn")}
                  </h2>
                  <p className="mt-0.5 text-xs leading-5 text-[#5d5b4d]">{intl("components_pages_InfraCalculator.useServerSideSampleDataToGenerateABrowsable")}</p>
                </div>
              </div>
            </div>
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="min-h-11 shrink-0 border-[#313131] bg-[#313131] text-[#FFD800] hover:bg-[#454545] hover:text-[#FFD800] sm:min-w-52"
              disabled={sampleLoading || loading || !plannerReady || runCooldownSeconds > 0}
              title={!plannerReady ? (intl("components_pages_InfraCalculator.plannerUnavailable")) : undefined}
              onClick={() => void onRunSampleTrial()}
            >
              {sampleLoading ? <Loader2 className="animate-spin" /> : <Play />}
              {sampleLoading ? (intl("components_pages_InfraCalculator.generatingSampleSchedule")) : (intl("components_pages_InfraCalculator.viewSampleSchedule"))}
            </Button>
          </section>
        ) : null}

        {actionControls}
      </div>
    </section>
  );
}

export interface InfraCalculatorProps {
  layout: BaseBlueprint;
  result: PublicPlanData | null;
  scheduleResult: PublicPlanData | null;
  activeShift: number;
  rows: RoomRow[];
  activePlan: MaaPlan | undefined;
  activeDronePlan: MaaPlan | undefined;
  closestComparison: ShiftComparison | null;
  resultClearNotice: string | null;
  feedbackResult: FeedbackData | null;
  operbox: OperBoxEntry[] | null;
  sampleLoading: boolean;
  loading: boolean;
  canRun: boolean;
  runOutcome?: "idle" | "success" | "error";
  runCooldownSeconds: number;
  hasBox: boolean;
  hasPersonalBox: boolean;
  feedbackDisabledForSampleBox: boolean;
  plannerReady: boolean;
  websiteAuthenticated: boolean;
  showOnboarding: boolean;
  taskQueue?: {
    queuePosition: number | null;
    etaSeconds: number | null;
    pollStopped: boolean;
    error: string | null;
    resumeDisabled: boolean;
    resumeCountdown: number;
    onResumePoll: () => void;
  } | null;
  animatePlanEntrance: boolean;
  animateEmptyScheduleEntrance: boolean;
  onPlanEntranceConsumed: (revision: string) => void;
  requiresAccount?: boolean;
  accountControl?: ReactNode;
  onRunSampleTrial: () => Promise<boolean>;
  onStartPersonalFlow: () => void;
  onDismissOnboarding: () => void;
  onOpenSetup: () => void;
  upgradeSimulationOpen: boolean;
  onOpenUpgradeSimulation: () => void;
  onUpgradeSimulationOpenChange: (open: boolean) => void;
  onRun: () => void;
  onAutoDroneAllocation: () => void;
  onManualDroneAllocation: () => void;
  manualDroneSelection?: boolean;
  onSimulateUpgrades: (trialOperbox: OperBoxEntry[]) => Promise<PublicPlanData>;
  upgradeComparison: { trial: PublicPlanData } | null;
  scheduleVariant: "baseline" | "trial";
  onScheduleVariantChange: (variant: "baseline" | "trial") => void;
  onUpgradeTrialReady: (trial: PublicPlanData) => void;
  onCancelRun: () => void;
  onSetActiveShift: (shift: number) => void;
  onMarkIssue: (row: RoomRow) => void;
  onPerformanceIssue: () => void;
  onFactoryRecipeChange: (roomId: string, recipe: FactoryRecipe) => void;
  onTradeOrderChange: (roomId: string, order: TradeOrder) => void;
  onSwapOperators?: (row: RoomRow, firstSlotIndex: number, secondSlotIndex: number) => void;
  droneTargetRoomId?: string | null;
  onDroneTargetChange?: (row: RoomRow) => void;
  onEditManualSchedule: () => void;
  onDownloadMaa: () => void;
  onDownloadImage: () => Promise<void>;
  showProgressionRecalculate?: boolean;
  showManualScheduleEdit?: boolean;
  scheduleViewControl?: "tabs" | "select";
  shiftViewControl?: "tabs" | "select";
  imageExportScope?: "single" | "all";
  showFeedback?: boolean;
  showImages?: boolean;
  allowReplacementOperatorSort?: boolean;
  highlightNoLayoutSkill?: boolean;
  onClearResultNotice: () => void;
  onDismissResultClearWarning: () => void;
}

export function InfraCalculator(props: InfraCalculatorProps) {
  const intl = useTranslations();
  const [dronePickerOpen, setDronePickerOpen] = useState(false);
  const {
    layout,
    result, scheduleResult, activeShift, rows,
    activePlan, activeDronePlan, closestComparison,
    resultClearNotice,
    feedbackResult,
    operbox,
    sampleLoading, loading, canRun, runCooldownSeconds, hasBox, hasPersonalBox, feedbackDisabledForSampleBox, plannerReady, websiteAuthenticated, showOnboarding, taskQueue, animatePlanEntrance, animateEmptyScheduleEntrance, onPlanEntranceConsumed, requiresAccount = false, accountControl,
    onRunSampleTrial, onStartPersonalFlow, onDismissOnboarding, onOpenSetup, upgradeSimulationOpen, onOpenUpgradeSimulation, onUpgradeSimulationOpenChange, onRun, onAutoDroneAllocation, onManualDroneAllocation, manualDroneSelection = false, onSimulateUpgrades, upgradeComparison, scheduleVariant, onScheduleVariantChange, onUpgradeTrialReady, onCancelRun,
    onSetActiveShift, onMarkIssue, onPerformanceIssue,
    onFactoryRecipeChange, onTradeOrderChange, droneTargetRoomId, onDroneTargetChange,
    onSwapOperators,
    onEditManualSchedule, onDownloadMaa, onDownloadImage, showProgressionRecalculate = true, showManualScheduleEdit = true, scheduleViewControl = "tabs", shiftViewControl = "tabs", imageExportScope = "single", showFeedback = true, showImages = true,
    onClearResultNotice, onDismissResultClearWarning, allowReplacementOperatorSort = false, highlightNoLayoutSkill = false,
  } = props;

  const eliteByOperator = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of operbox ?? []) {
      if (entry.own) map.set(entry.name, entry.elite);
    }
    return map;
  }, [operbox]);
  const levelByOperator = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of operbox ?? []) {
      if (entry.own) map.set(entry.name, entry.level);
    }
    return map;
  }, [operbox]);
  const [shortcutGuideOpen, setShortcutGuideOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [planActionsOpen, setPlanActionsOpen] = useState(false);
  const [operatorQuery, setOperatorQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [imageExporting, setImageExporting] = useState(false);
  const [imageExportFailed, setImageExportFailed] = useState(false);
  const [sortRoomId, setSortRoomId] = useState<string | null>(null);
  const [sortSelection, setSortSelection] = useState<{ roomId: string; slotIndex: number } | null>(null);
  const [highlightCatalog, setHighlightCatalog] = useState<readonly OperatorAssetRecord[]>([]);
  useEffect(() => {
    if (!highlightNoLayoutSkill) return;
    let active = true;
    void import("@/operatorPortraits").then(({ OPERATOR_CATALOG }) => {
      if (active) setHighlightCatalog(OPERATOR_CATALOG);
    }).catch(() => { /* Leave highlighting unavailable until the next toggle. */ });
    return () => { active = false; };
  }, [highlightNoLayoutSkill]);
  const noLayoutSkillOperators = useMemo(() => operatorsWithoutLayoutSkills(highlightCatalog, layout.rooms), [highlightCatalog, layout.rooms]);
  const imageExportInFlight = useRef(false);

  function toggleSortMode(row: RoomRow) {
    setSortRoomId((current) => current === row.roomId ? null : row.roomId);
    setSortSelection(null);
  }

  function handleSortSlotClick(row: RoomRow, slotIndex: number) {
    if (row.roomId !== sortRoomId || !row.operatorSlots[slotIndex]) return;
    if (!sortSelection) {
      setSortSelection({ roomId: row.roomId, slotIndex });
      return;
    }
    if (sortSelection.roomId !== row.roomId) {
      setSortSelection({ roomId: row.roomId, slotIndex });
      return;
    }
    onSwapOperators?.(row, sortSelection.slotIndex, slotIndex);
    setSortSelection(null);
  }

  async function handleImageExport() {
    if (imageExportScope === "all") return;
    if (imageExportInFlight.current) return;
    imageExportInFlight.current = true;
    setImageExporting(true);
    setImageExportFailed(false);
    try {
      await onDownloadImage();
    } catch {
      setImageExportFailed(true);
    } finally {
      imageExportInFlight.current = false;
      setImageExporting(false);
    }
  }

  const imageExportAction = scheduleResult?.maa ? (
    <Suspense fallback={null}>
      <ScheduleImageExportAction disabled={!scheduleResult?.maa || loading} exporting={imageExporting} scope={imageExportScope} onExport={handleImageExport} />
    </Suspense>
  ) : null;

  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const [shiftDirection, setShiftDirection] = useState<ShiftDirection>(0);
  const [fiammettaPortrait, setFiammettaPortrait] = useState<string | null>(null);
  const fiammettaTarget = activePlan?.Fiammetta?.enable
    ? (Array.isArray(activePlan.Fiammetta.target) ? activePlan.Fiammetta.target[0] : activePlan.Fiammetta.target)
    : undefined;
  useEffect(() => {
    let cancelled = false;
    if (!fiammettaTarget) {
      setFiammettaPortrait(null);
      return;
    }
    void import("@/operatorPortraits").then(({ operatorPortraitFor }) => {
      if (!cancelled) setFiammettaPortrait(operatorPortraitFor(fiammettaTarget) ?? null);
    });
    return () => { cancelled = true; };
  }, [fiammettaTarget]);
  const handleSetActiveShift = (nextShift: number) => {
    setSortRoomId(null);
    setSortSelection(null);
    setShiftDirection(nextShift === activeShift ? 0 : nextShift > activeShift ? 1 : -1);
    onSetActiveShift(nextShift);
  };
  const visibleVariantLabel = scheduleVariant === "trial" && upgradeComparison
    ? (intl("components_pages_InfraCalculator.progressionAdjustedPlan"))
    : (intl("components_pages_InfraCalculator.originalPlan"));
  const openProgressionAction = () => {
    setPlanActionsOpen(false);
    onOpenUpgradeSimulation();
  };
  const openManualAction = () => {
    setPlanActionsOpen(false);
    onEditManualSchedule();
  };
  const renderPlanActions = (placement: "desktop" | "mobile") => placement === "desktop" ? (
    <div
      className="hidden flex-wrap items-center justify-end gap-2 md:flex"
      data-calculator-export-actions={placement}
      data-calculator-plan-actions={placement}
    >
      {operbox && showProgressionRecalculate ? (
        <Button type="button" size="sm" variant="outline" onClick={onOpenUpgradeSimulation}>
          <FlaskConical />{intl("components_pages_InfraCalculator.modifyProgressionRecalculate")}
        </Button>
      ) : null}
      {showManualScheduleEdit ? <Button type="button" size="sm" variant="outline" onClick={onEditManualSchedule}>
        <PencilLine />{intl("components_pages_InfraCalculator.editTheCurrentPlan")}<ArrowRight />
      </Button> : null}
      <Button type="button" size="sm" variant="outline" disabled={!result?.maa} onClick={onDownloadMaa}>
        <Download />{intl("components_pages_InfraCalculator.exportToMaa")}
      </Button>
      {imageExportAction}
    </div>
  ) : (
    <div
      className="grid min-w-0 grid-cols-2 items-stretch gap-2"
      data-calculator-export-actions={placement}
      data-calculator-plan-actions={placement}
    >
      <Button type="button" size="sm" variant="outline" className="h-auto min-h-11 min-w-0 w-full whitespace-normal py-2" onClick={() => setPlanActionsOpen(true)}>
        <SlidersHorizontal />{intl("components_pages_InfraCalculator.adjustPlan")}
      </Button>
      <Button type="button" size="sm" variant="outline" className="h-auto min-h-11 min-w-0 w-full whitespace-normal py-2" disabled={!result?.maa} onClick={onDownloadMaa}>
        <Download />{intl("components_pages_InfraCalculator.exportMaa")}
      </Button>
      <div className="contents [&>div]:contents [&_button]:h-auto [&_button]:min-h-11 [&_button]:min-w-0 [&_button]:w-full [&_button]:whitespace-normal [&_button]:py-2">
        {imageExportAction}
      </div>
    </div>
  );

  const renderSearch = () => (
    <div className={cn("flex min-w-0 items-center gap-2 max-md:col-span-2", !mobileSearchOpen && !operatorQuery && "max-md:hidden")}>
      <label className="relative block min-w-0 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          ref={searchInputRef}
          value={operatorQuery}
          onChange={(event) => setOperatorQuery(event.target.value)}
          placeholder={intl("components_pages_InfraCalculator.searchOperatorsOrRoomsInThisSchedule")}
          aria-label={intl("components_pages_InfraCalculator.searchOperatorsOrRoomsInThisSchedule")}
          className="h-9 pr-10 pl-9 max-md:h-11"
        />
        {operatorQuery || mobileSearchOpen ? (
          <button
            type="button"
            onClick={() => { setOperatorQuery(""); setMobileSearchOpen(false); (window.matchMedia("(max-width: 767px)").matches ? searchToggleRef : searchInputRef).current?.focus(); }}
            className="absolute top-1/2 right-0 grid size-9 -translate-y-1/2 place-items-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#FFD800] max-md:size-11"
            aria-label={intl("components_pages_InfraCalculator.clearScheduleSearch")}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </label>
      <Button
        type="button"
        size="icon-lg"
        variant="outline"
        className="hidden size-9 md:inline-flex"
        aria-label={intl("components_pages_InfraCalculator.keyboardShortcuts")}
        title={intl("components_pages_InfraCalculator.keyboardShortcuts")}
        onClick={() => setShortcutGuideOpen(true)}
      >
        <Keyboard />
      </Button>
    </div>
  );

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setMobileSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
      } else if (event.key === "Escape" && document.activeElement === searchInputRef.current) {
        setOperatorQuery("");
        setMobileSearchOpen(false);
        searchInputRef.current?.blur();
        if (window.matchMedia("(max-width: 767px)").matches) searchToggleRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  return (
    <>
      <section
        className="infra-technical-canvas block"
        data-infra-canvas
      >
        <section className="min-w-0">
          <Panel
            className={cn(
              "min-h-[calc(100vh-112px)]",
              !showOnboarding && "max-md:pt-2",
              !scheduleResult && showOnboarding && "py-0",
            )}
            action={!showOnboarding ? (
              <div
                className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-2 md:grid-cols-[minmax(14rem,1fr)_auto_auto] md:items-center"
                data-calculator-controls
              >
                {renderSearch()}
                <div className="relative flex min-w-0 items-center gap-2 md:inline-flex md:gap-0" data-calculator-setup-group>
                <Button ref={searchToggleRef} type="button" size="icon" variant="outline" className="size-11 md:hidden" aria-label={intl("components_pages_InfraCalculator.searchOperatorsOrRoomsInThisSchedule")} aria-expanded={mobileSearchOpen || Boolean(operatorQuery)} onClick={() => { setMobileSearchOpen(true); requestAnimationFrame(() => searchInputRef.current?.focus()); }}><Search /></Button>
                <details className="shrink-0 md:hidden" data-calculator-more-tools>
                  <summary aria-label={intl("components_pages_InfraCalculator.moreTools")} title={intl("components_pages_InfraCalculator.moreTools")} className="flex size-11 cursor-pointer list-none items-center justify-center rounded-lg border border-border bg-background marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD800]">
                    <Ellipsis className="size-4" aria-hidden="true" />
                  </summary>
                  <div className="absolute left-0 top-[calc(100%+0.35rem)] z-30 grid w-[min(18rem,calc(100vw-1.5rem))] gap-2 border border-border bg-background p-2 shadow-lg">
                    <Button type="button" variant="ghost" className="h-11 justify-start" onClick={onOpenSetup}>
                      <Settings2 />{intl("components_pages_InfraCalculator.configureBoxBase")}
                    </Button>
                    <Button type="button" variant="ghost" className="h-11 justify-start" onClick={() => setShortcutGuideOpen(true)}>
                      <Keyboard />{intl("components_pages_InfraCalculator.keyboardShortcuts")}
                    </Button>
                  </div>
                </details>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className={accountControl
                      ? "h-9 min-w-0 rounded-r-none max-md:hidden"
                      : "h-9 min-w-0 max-md:hidden"}
                    aria-label={intl("components_pages_InfraCalculator.configureBoxAndBase")}
                    onClick={onOpenSetup}
                  >
                    <Settings2 />
                    {intl("components_pages_InfraCalculator.configureBoxBase")}
                  </Button>
                  {accountControl}
                </div>
                  <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 md:flex-nowrap">
                    {loading && taskQueue?.error ? (
                      <span className="w-full break-words text-xs text-red-300 md:w-auto" role="status">{taskQueue.error}</span>
                    ) : null}
                    {loading && taskQueue?.pollStopped ? (
                      <div className="relative max-md:w-full">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 max-md:h-11 max-md:w-full"
                          onClick={taskQueue.onResumePoll}
                          disabled={taskQueue.resumeDisabled}
                          aria-label={intl("components_pages_InfraCalculator.checkProgress")}
                        >
                          <RefreshCw />
                          {intl("components_pages_InfraCalculator.checkProgress")}
                        </Button>
                        {taskQueue.resumeCountdown > 0 ? (
                          <span
                            className="pointer-events-none absolute inset-0 grid place-items-center rounded-md bg-black/45 text-lg font-semibold text-white"
                            aria-hidden="true"
                          >
                            {taskQueue.resumeCountdown}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    <ScheduleRunButton canRun={canRun} hasBox={hasBox} plannerReady={plannerReady} requiresAccount={requiresAccount} runCooldownSeconds={runCooldownSeconds} loading={loading} outcome={props.runOutcome} onRun={onRun} onCancel={() => setCancelConfirmOpen(true)} />
                  </div>
              </div>
            ) : null}
          >
            {scheduleResult ? (
              <>
                <SkeletonSuspense fallback={<DeferredResultLoading />}>
                  <PlanResultSummary
                    profile={scheduleResult.profile}
                    rotation={scheduleResult.rotation}
                    maa={scheduleResult.maa}
                    layout={layout}
                    activeShift={activeShift}
                    comparison={closestComparison}
                    durationMs={scheduleResult.durationMs}
                    planRevision={scheduleResult.diagnosticId}
                    animationRevision={result?.diagnosticId ?? scheduleResult.diagnosticId}
                    animateEntrance={animatePlanEntrance}
                    onEntranceConsumed={onPlanEntranceConsumed}
                    onPerformanceIssue={showFeedback ? onPerformanceIssue : undefined}
                    feedbackDisabled={feedbackDisabledForSampleBox}
                    controlsSlot={(
                      <Suspense fallback={null}>
                      <PlanSupportSummary drones={activeDronePlan?.drones} target={fiammettaTarget} portrait={fiammettaPortrait} automatic={!manualDroneSelection} onAutomaticChange={onDroneTargetChange ? (checked) => { if (checked) onAutoDroneAllocation(); else onManualDroneAllocation(); } : undefined} onChooseFacility={() => setDronePickerOpen(true)} />
                      </Suspense>
                    )}
                  />
                </SkeletonSuspense>
              </>
            ) : null}
            {imageExportFailed ? (
              <p role="alert" className="text-sm text-red-700">
                {intl("components_pages_InfraCalculator.exportImageFailed")}
              </p>
            ) : null}
            {!scheduleResult && showOnboarding ? (
              <CalculatorStartPanel
                websiteAuthenticated={websiteAuthenticated}
                hasPersonalBox={hasPersonalBox}
                sampleLoading={sampleLoading}
                loading={loading}
                plannerReady={plannerReady}
                runCooldownSeconds={runCooldownSeconds}
                accountControl={accountControl}
                onStartPersonalFlow={onStartPersonalFlow}
                onRunSampleTrial={onRunSampleTrial}
                onRun={onRun}
                onOpenSetup={onOpenSetup}
                onDismissOnboarding={onDismissOnboarding}
              />
            ) : rows.length > 0 ? <ScheduleBoard
              rows={rows}
              layout={layout}
              planRevision={scheduleResult?.diagnosticId}
              eliteByOperator={eliteByOperator}
              levelByOperator={levelByOperator}
              activeShift={activeShift}
              shiftDirection={shiftDirection}
              activePlan={activePlan}
              searchQuery={operatorQuery}
              animateInitialView={!scheduleResult && animateEmptyScheduleEntrance}
              viewControlsSlot={upgradeComparison ? (
                <Tabs
                  className="w-full sm:w-auto"
                  value={scheduleVariant}
                  onValueChange={(value) => onScheduleVariantChange(value as "baseline" | "trial")}
                >
                  <TabsList className="grid w-full grid-cols-2 sm:inline-flex sm:w-fit" aria-label={intl("components_pages_InfraCalculator.scheduleVariant")}>
                    <TabsTrigger value="baseline">{intl("components_pages_InfraCalculator.originalPlan2")}</TabsTrigger>
                    <TabsTrigger value="trial">{intl("components_pages_InfraCalculator.progressionAdjusted")}</TabsTrigger>
                  </TabsList>
                </Tabs>
              ) : undefined}
              mobileActionsSlot={scheduleResult ? renderPlanActions("mobile") : undefined}
              shiftTabsSlot={(
                <ShiftTabs maaJson={scheduleResult?.maa} rotation={scheduleResult?.rotation} active={activeShift} closest={closestComparison?.planIndex} control={shiftViewControl} onChange={handleSetActiveShift} />
              )}
              shiftInfoSlot={scheduleResult ? renderPlanActions("desktop") : undefined}
              onIssue={showFeedback ? onMarkIssue : undefined}
              feedbackDisabled={feedbackDisabledForSampleBox}
              onFactoryRecipeChange={onFactoryRecipeChange}
              onTradeOrderChange={onTradeOrderChange}
              sortRoomId={allowReplacementOperatorSort ? sortRoomId : null}
              sortSelection={sortSelection}
              onSortToggle={allowReplacementOperatorSort && onSwapOperators ? toggleSortMode : undefined}
              onSortSlotClick={allowReplacementOperatorSort && onSwapOperators ? handleSortSlotClick : undefined}
              viewModeControl={scheduleViewControl}
              hideImages={!showImages}
              highlightNoLayoutSkill={highlightNoLayoutSkill}
              noLayoutSkillOperators={noLayoutSkillOperators}
              droneTargetRoomId={droneTargetRoomId}
              onDroneTargetChange={manualDroneSelection ? onDroneTargetChange : undefined}
            /> : (
              <div className="flex min-h-[420px] items-center justify-center border-y border-dashed border-border/70 py-6 text-center text-sm text-muted-foreground">
                {intl("components_pages_InfraCalculator.noLayoutRoomsToDisplay")}
              </div>
            )}
          </Panel>
          {feedbackResult ? (
            <div className="mt-3 border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700" role="status">
              {intl("components_pages_InfraCalculator.feedbackSubmittedId")}{feedbackResult.feedbackId}
            </div>
          ) : null}
        </section>
      </section>

      {dronePickerOpen && <Suspense fallback={null}><DroneTargetPicker rows={rows} targetRoomId={droneTargetRoomId} manualSelection={manualDroneSelection} onTargetChange={onDroneTargetChange} onAutoAllocation={onAutoDroneAllocation} onOpenChange={setDronePickerOpen} /></Suspense>}

      {resultClearNotice ? (
        <aside className="fixed left-1/2 top-[max(5rem,calc(env(safe-area-inset-top)+5rem))] z-[70] w-[min(720px,calc(100vw-2rem))] -translate-x-1/2 border border-[#FFD800]/70 bg-[#313131] px-4 py-3 text-white shadow-[0_16px_44px_rgba(0,0,0,0.35)]" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <strong className="block text-sm font-semibold text-[#FFD800]">{intl("components_pages_InfraCalculator.previousResultCleared")}</strong>
              <span className="mt-0.5 block text-xs text-white/68">{resultClearNotice}{intl("components_pages_InfraCalculator.runThePlannerAgain")}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={onClearResultNotice}>{intl("components_pages_InfraCalculator.gotIt")}</Button>
              <Button type="button" size="sm" variant="outline" className="border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={onDismissResultClearWarning}>{intl("components_pages_InfraCalculator.donTShowAgain")}</Button>
            </div>
          </div>
        </aside>
      ) : null}
      {operbox && scheduleResult ? (
        <Suspense fallback={null}>
          <UpgradeSimulationDialog
            operbox={operbox}
            baseline={result ?? scheduleResult}
            open={upgradeSimulationOpen}
            showTrigger={false}
            onOpen={onOpenUpgradeSimulation}
            onOpenChange={onUpgradeSimulationOpenChange}
            onSimulate={onSimulateUpgrades}
            onTrialReady={onUpgradeTrialReady}
          />
        </Suspense>
      ) : null}
      {planActionsOpen && <Suspense fallback={null}><PlanActionsDialog hasBox={!!operbox} showProgression={showProgressionRecalculate} showManual={showManualScheduleEdit} visibleVariantLabel={visibleVariantLabel} onOpenChange={setPlanActionsOpen} onProgression={openProgressionAction} onManual={openManualAction} /></Suspense>}
      <Suspense fallback={null}>
        <ShortcutGuideDialog open={shortcutGuideOpen} onOpenChange={setShortcutGuideOpen} />
        <Dialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
          <DialogContent className="gap-5 max-sm:px-4 sm:max-w-sm sm:p-6">
            <DialogHeader className="gap-1.5 px-1 sm:px-2">
              <DialogTitle className="text-lg font-semibold">{intl("components_pages_InfraCalculator.cancelTheCurrentTask")}</DialogTitle>
              <DialogDescription className="text-sm leading-6">
                {intl("components_pages_InfraCalculator.cancelingExitsTheQueueAFutureScheduleRequestWill")}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setCancelConfirmOpen(false)}>
                {intl("components_pages_InfraCalculator.keepWaiting")}
              </Button>
              <Button type="button" variant="destructive" onClick={() => {
                setCancelConfirmOpen(false);
                onCancelRun();
              }}>
                {intl("components_pages_InfraCalculator.cancelTask2")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Suspense>
    </>
  );
}
