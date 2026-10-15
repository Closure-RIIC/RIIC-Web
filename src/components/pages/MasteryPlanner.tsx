"use client";
import { WorkbenchPageHeading } from "@/components/workbench/WorkbenchPageHeading";
import { localize as localize_components_pages_MasteryPlanner } from "../../i18n/helpers/components_pages_MasteryPlanner.ts";

import { useTranslations, useLocale } from "use-intl";

import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { Settings2, Timer } from "lucide-react";
import { calculateMastery, eligibleMasteryTargets, normalizeMasteryBox, availableMasteryEnvironments, formatMasteryTime, MASTERY_ENVIRONMENTS, type MasteryInput, type MasteryResult } from "@/mastery";
import { masteryClipboard, masteryInstructions } from "@/mastery-presentation";
import { InfraTechnicalCard, InfraTechnicalHeading } from "@/components/InfraTechnicalCard";
import { SetupActionButton } from "@/components/setup/SetupActionButton";
import { OperatorIdentity } from "@/components/operators/OperatorPickerParts";
import type { OperatorSkillTooltip } from "@/components/OperatorSkillTooltip";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from "@/components/ui/dialog";
import { localizedOperatorName } from "@/i18n/game-data";
import { useGameCatalog } from "@/i18n/game-data-client";
import catalog from "@/generated/arkntools/operator-catalog.json";
import type { OperBoxEntry } from "@/types";

const TargetPicker = lazy(() => import("@/components/mastery/MasteryTargetPicker").then((m) => ({default:m.MasteryTargetPicker})));
const TrainerSkillTooltip = lazy(() => import("@/components/OperatorSkillTooltip").then((m) => ({ default: m.OperatorSkillTooltip })));

function TargetPickerLoading({ onClose }: { onClose: () => void }) {
  const intl = useTranslations("components_mastery_MasteryTargetPicker");
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent aria-busy="true" className="max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)] sm:max-w-[min(880px,calc(100vw-2rem))]">
      <DialogHeader><DialogTitle>{intl("chooseATrainee")}</DialogTitle></DialogHeader>
      <DialogBody className="min-h-0 overflow-hidden pb-5">
        <Skeleton className="h-11" /><Skeleton className="h-9 w-3/4" />
        <div className="grid grid-cols-2 gap-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-20" />)}</div>
      </DialogBody>
    </DialogContent>
  </Dialog>;
}

function MasteryTrainerTooltip(props: ComponentProps<typeof OperatorSkillTooltip>) {
  return <Suspense fallback={props.trigger}><TrainerSkillTooltip {...props} /></Suspense>;
}
export interface MasteryPlannerProps {
  operbox: OperBoxEntry[] | null;
  sourceName: string | null;
  requiresAccount: boolean;
  pending: boolean;
  identityKey: string;
  onOpenSetup: () => void;
  onRequestAccount: () => void;
  pickerRequested: boolean;
  onPickerRequestConsumed: () => void;
}

export function MasteryPlanner({ operbox, sourceName, requiresAccount, pending, onOpenSetup, onRequestAccount, pickerRequested, onPickerRequestConsumed }: MasteryPlannerProps) {
  const intl = useTranslations();
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  const en = locale === "en";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [current, setCurrent] = useState<0 | 1 | 2>(0);
  const [target, setTarget] = useState<1 | 2 | 3>(3);
  const [controlBonus, setControlBonus] = useState(true);
  const [bufferMinutes, setBufferMinutes] = useState(1);
  const [environment, setEnvironment] = useState<Record<string,number>>({});
  const [mode, setMode] = useState<"simple" | "fast">("simple");
  const [copyFeedback, setCopyFeedback] = useState<{ text: string; error: string | null } | null>(null);
  const [scrollRequested, setScrollRequested] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const normalizedBox = useMemo(() => normalizeMasteryBox(operbox ?? []),[operbox]);
  const eligible = useMemo(() => eligibleMasteryTargets(normalizedBox),[normalizedBox]);
  const selected = eligible.find((o) => o.id === selectedId) ?? null;
  if (selectedId && !selected) setSelectedId(null);
  const meta = selected ? catalog.find((o) => o.id === selected.id) : null;
  const environmentKeys = useMemo(() => availableMasteryEnvironments(operbox ?? [], selectedId ?? undefined), [operbox, selectedId]);
  const input = useMemo<MasteryInput>(() => ({
    operbox: operbox ?? [], targetId: selectedId ?? "", current, target, controlBonus, bufferMinutes,
    environment: Object.fromEntries(environmentKeys.map((key) => [key, environment[key] ?? 0])),
  }), [operbox, selectedId, current, target, controlBonus, bufferMinutes, environmentKeys, environment]);
  const calculation = useMemo<{ result: MasteryResult | null; error: string | null }>(() => {
    if (pending || requiresAccount || !input.targetId) return { result: null, error: null };
    try { return { result: calculateMastery(input), error: null }; }
    catch (cause) { return { result: null, error: cause instanceof Error ? cause.message : String(cause) }; }
  }, [input, pending, requiresAccount]);
  const plan = calculation.result?.[mode];
  useEffect(() => {
    if (!scrollRequested || !calculation.result || pickerOpen || pickerRequested) return;
    const frame = requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        block: "start",
      });
      setScrollRequested(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollRequested, calculation.result, pickerOpen, pickerRequested]);
  const displayName = (name: string) => localizedOperatorName(name,locale,gameCatalog);
  const conditions = intl("components_pages_MasteryPlanner.assumesSufficientMoraleMaterialsAndTrainingRoomLevelEnvironment");
  const activeEnvironment = environmentKeys.map((key) => `${en ? MASTERY_ENVIRONMENTS[key]!.english : MASTERY_ENVIRONMENTS[key]!.label} ${input.environment[key]}`).join(" · ");
  const settingsSummary = `${intl("components_pages_MasteryPlanner.controlBonus")} ${controlBonus ? "+5%" : "0%"} · ${intl("components_pages_MasteryPlanner.buffer")} ${bufferMinutes} ${intl("components_pages_MasteryPlanner.min")}${activeEnvironment ? ` · ${activeEnvironment}` : ""}`;
  const clipboardText = plan && selected ? [masteryClipboard(plan,displayName(selected.name),en,displayName),settingsSummary,conditions].join("\n") : null;
  const currentCopyFeedback = clipboardText !== null && copyFeedback?.text === clipboardText ? copyFeedback : null;
  const copied = currentCopyFeedback !== null && currentCopyFeedback.error === null;
  const error = calculation.error ?? currentCopyFeedback?.error;

  async function copyPlan() {
    if (clipboardText === null) return;
    try {
      await navigator.clipboard.writeText(clipboardText);
      setCopyFeedback({ text: clipboardText, error: null });
    } catch { setCopyFeedback({ text: clipboardText, error: intl("components_pages_MasteryPlanner.couldNotCopyPleaseCheckBrowserClipboardPermissions") }); }
  }

  return <section className="grid min-w-0 gap-3 pt-2 pb-8 md:gap-5 md:pt-5" aria-labelledby="mastery-heading" data-mastery-planner>
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0"><WorkbenchPageHeading page="mastery" id="mastery-heading">{intl("components_pages_MasteryPlanner.masteryPlanner")}</WorkbenchPageHeading>
        <p className="mt-1 text-xs leading-5 text-muted-foreground md:mt-2 md:text-sm">{intl("components_pages_MasteryPlanner.chooseAnOperatorGetAStageByStageTrainer")}</p></div>
      <SetupActionButton className="max-md:!h-11 max-md:w-11 max-md:!min-w-0 max-md:!px-0" variant="outline" onClick={onOpenSetup} disabled={pending} aria-label={intl("components_pages_MasteryPlanner.configureBox")} title={intl("components_pages_MasteryPlanner.configureBox")}><Settings2 className="size-4 md:hidden" /><span className="max-md:hidden">{intl("components_pages_MasteryPlanner.configureBox")}</span></SetupActionButton>
    </header>

    <div className="grid gap-3 rounded-[4px] border border-border bg-card p-3 md:gap-5 md:p-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 md:flex md:flex-wrap md:justify-between md:gap-4">
        <div className="min-w-0"><p className="text-xs text-muted-foreground">{intl("components_pages_MasteryPlanner.currentBox")}</p><p className="mt-1 break-words text-sm">{requiresAccount ? (intl("components_pages_MasteryPlanner.signInToUseYourBox")) : sourceName ?? (intl("components_pages_MasteryPlanner.noBoxConfigured"))}</p>
          {selected && meta ? <div className="mt-4 flex items-center gap-3"><OperatorIdentity name={selected.name} portrait={meta.portrait}><span className="text-xs text-muted-foreground">{selected.rarity}★ · {intl("components_pages_MasteryPlanner.elite2")}</span></OperatorIdentity></div> : null}
        </div>
        <SetupActionButton className="max-md:!h-auto max-md:min-h-11 max-md:!min-w-0 max-md:max-w-36 max-md:whitespace-normal max-md:!px-3 max-md:py-2" disabled={pending || (!requiresAccount && !eligible.length)} onClick={() => { if (requiresAccount) onRequestAccount(); else setPickerOpen(true); }}>
          {localize_components_pages_MasteryPlanner.text(en, "additional1", { choice1: ((en)) && (selected) ? "yes" : "no", choice2: (!(en)) && (selected) ? "yes" : "no" })}
        </SetupActionButton>
      </div>
      {!requiresAccount && !pending && !eligible.length ? <p className="text-sm text-muted-foreground">{intl("components_pages_MasteryPlanner.yourBoxHasNoOwnedE2OperatorsImportOr")}</p> : null}
      <div className="grid gap-2 md:flex md:flex-wrap md:items-end md:gap-x-8 md:gap-y-4 max-md:[&_[data-slot=tabs-list]]:w-full max-md:[&_[data-slot=tabs-trigger]]:min-h-11 max-md:[&_[data-slot=tabs-trigger]]:min-w-0 max-md:[&_[data-slot=tabs-trigger]]:px-1 max-md:[&_[data-slot=tabs-trigger]]:text-xs">
        <div className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] items-center gap-2 md:grid-cols-1"><span className="text-xs text-muted-foreground">{intl("components_pages_MasteryPlanner.currentMastery")}</span><Tabs value={String(current)} onValueChange={(value) => { const next = Number(value) as 0|1|2; setCurrent(next); if (target <= next) setTarget((next+1) as 1|2|3); }}><TabsList aria-label={intl("components_pages_MasteryPlanner.currentMastery")}>
          {[0,1,2].map((level) => <TabsTrigger key={level} value={String(level)}>{level === 0 ? (intl("components_pages_MasteryPlanner.untrained")) : (intl("components_pages_MasteryPlanner.m", { level: level }))}</TabsTrigger>)}
        </TabsList></Tabs></div>
        <div className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] items-center gap-2 md:grid-cols-1"><span className="text-xs text-muted-foreground">{intl("components_pages_MasteryPlanner.targetMastery")}</span><Tabs value={String(target)} onValueChange={(value) => setTarget(Number(value) as 1|2|3)}><TabsList aria-label={intl("components_pages_MasteryPlanner.targetMastery")}>
          {[1,2,3].map((level) => <TabsTrigger key={level} value={String(level)} disabled={level <= current}>{intl("components_pages_MasteryPlanner.m", { level: level })}</TabsTrigger>)}
        </TabsList></Tabs></div>
        <SetupActionButton className="max-md:hidden" variant={controlBonus ? "default" : "outline"} aria-pressed={controlBonus} onClick={() => setControlBonus((value) => !value)}>{intl("components_pages_MasteryPlanner.controlCenter5")}</SetupActionButton>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{intl("components_pages_MasteryPlanner.enterTheCurrentMasteryOfTheSkillYouPlan")}</p>
      <details className="min-w-0 border-t border-border pt-1 md:pt-4">
        <summary className="min-h-11 cursor-pointer content-center text-sm font-medium md:min-h-0">{intl("components_pages_MasteryPlanner.advancedSettings")}</summary>
        <SetupActionButton className="mt-2 md:hidden" variant={controlBonus ? "default" : "outline"} aria-pressed={controlBonus} onClick={() => setControlBonus((value) => !value)}>{intl("components_pages_MasteryPlanner.controlCenterBonus", { bonus: controlBonus ? 5 : 0 })}</SetupActionButton>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="grid gap-2 text-xs">{intl("components_pages_MasteryPlanner.handoffBufferMinutes")}<Input type="number" min={0} step={0.5} value={Number.isFinite(bufferMinutes) ? bufferMinutes : ""} onChange={(e) => setBufferMinutes(e.target.valueAsNumber)} /></label>
          {environmentKeys.map((key) => <label key={key} className="grid gap-2 text-xs">{en ? MASTERY_ENVIRONMENTS[key]!.english : MASTERY_ENVIRONMENTS[key]!.label}<Input type="number" min={0} max={MASTERY_ENVIRONMENTS[key]!.max ?? 10000} step={1} value={Number.isFinite(environment[key] ?? 0) ? environment[key] ?? 0 : ""} onChange={(e) => setEnvironment((previous) => ({...previous,[key]:e.target.valueAsNumber}))} /></label>)}
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">{intl("components_pages_MasteryPlanner.environmentCountsReferToOperatorsActuallyStationedInThe")}</p>
      </details>
      <p className="text-xs leading-5 text-muted-foreground">{intl("components_pages_MasteryPlanner.computedLocallyNoBaseScheduleRequired")}</p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>

    <p className="text-xs leading-5 text-muted-foreground">{conditions}</p>
    {plan && calculation.result ? <div ref={resultsRef} className="grid min-w-0 scroll-mt-[calc(5rem+env(safe-area-inset-top))] gap-4 md:scroll-mt-6" data-mastery-results>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={mode} onValueChange={(value) => { setMode(value as "simple"|"fast"); setCopyFeedback(null); }}><TabsList aria-label={intl("components_pages_MasteryPlanner.planStyle")}><TabsTrigger value="simple">{intl("components_pages_MasteryPlanner.simple")}</TabsTrigger><TabsTrigger value="fast">{intl("components_pages_MasteryPlanner.fast")}</TabsTrigger></TabsList></Tabs>
        <SetupActionButton variant="outline" onClick={() => void copyPlan()}>{copied ? (intl("components_pages_MasteryPlanner.copied")) : (intl("components_pages_MasteryPlanner.copyInstructions"))}</SetupActionButton>
      </div>
      <InfraTechnicalCard group="training" className="p-5 sm:p-6">
        <InfraTechnicalHeading icon={<Timer className="size-4" />}>{intl("components_pages_MasteryPlanner.estimatedCompletionTime")}</InfraTechnicalHeading>
        <strong className="font-number mt-3 block text-3xl leading-tight">{formatMasteryTime(plan.totalSeconds)}</strong>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
          <span className="inline-flex h-6 shrink-0 items-center whitespace-nowrap text-white/60">{intl("components_pages_MasteryPlanner.trainerChanges", { switches: plan.switches })}</span>
          {mode === "fast" ? <span className="inline-flex min-h-6 items-center gap-1 border border-l-2 border-amber-200/15 border-l-amber-300/70 bg-amber-200/5 px-2 text-amber-100/80"><span>{intl("components_pages_MasteryPlanner.timeSaved")}</span><span className="font-number whitespace-nowrap font-semibold tabular-nums text-amber-200">{formatMasteryTime(Math.max(0,calculation.result.simple.totalSeconds-plan.totalSeconds))}</span></span> : null}
        </div>
        <p className="mt-3 border-t border-white/10 pt-3 text-xs leading-5 text-white/50">{settingsSummary}</p>
      </InfraTechnicalCard>
      <p className="text-xs text-muted-foreground">{intl("components_pages_MasteryPlanner.timesAreRelativeToTheStartFinishAndStart")}</p>
      <div className="grid gap-4">
        {masteryInstructions(plan,en,displayName).map((steps,index) => <InfraTechnicalCard key={plan.stages[index]!.level} group="training" showEmblem={false} dataSlot="mastery-stage-card">
          <header className="grid min-w-0 gap-2.5">
            <h2 className="text-base font-semibold leading-6 text-white/95">{intl("components_pages_MasteryPlanner.mastery", { value1: plan.stages[index]!.level })}</h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
              <span className="font-number inline-flex h-6 shrink-0 items-center whitespace-nowrap border border-white/15 bg-white/8 px-2 font-medium tabular-nums text-white/85">{formatMasteryTime(plan.stages[index]!.seconds)}</span>
              {plan.stages[index]!.activateWith ? <span className="inline-flex h-6 shrink-0 items-center whitespace-nowrap border border-l-2 border-amber-200/15 border-l-amber-300/70 bg-amber-200/5 px-2 text-amber-100/80">{intl("components_pages_MasteryPlanner.50Reduction")}</span> : null}
            </div>
          </header>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-white/10 pt-3">{plan.stages[index]!.segments.filter((s) => s.trainerId).map((segment,i) => {
            const operator = normalizedBox.find((o) => o.id === segment.trainerId);
            const portrait = catalog.find((o) => o.id === segment.trainerId)?.portrait;
            return <MasteryTrainerTooltip key={`${segment.trainerId}:${i}`} name={segment.trainerName} currentElite={operator?.elite} currentLevel={operator?.level} highlightedSkillIds={segment.skillIds}
              trigger={<button type="button" className="flex min-h-11 min-w-0 max-w-full items-center gap-2.5 border border-white/10 bg-white/10 p-2 text-left outline-none transition-colors hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-[#FFD800] motion-reduce:transition-none" aria-label={intl("components_pages_MasteryPlanner.showInfrastructureSkills", { value1: (en) ? (displayName(segment.trainerName)) : "", trainerName: (en) ? "" : (segment.trainerName) })}>
                <span className="size-12 shrink-0 overflow-hidden border border-white/10 bg-[#272A2B]">{portrait ? <img src={portrait} alt="" className="size-full object-cover" loading="lazy" decoding="async" /> : null}</span>
                <span className="min-w-0 truncate text-sm text-white/85">{displayName(segment.trainerName)}</span>
                <span className="shrink-0 border border-white/10 bg-white/5 px-1.5 py-0.5 text-xs text-white/65">{intl("components_pages_MasteryPlanner.trainer")}</span>
              </button>} />;
          })}</div>
          <ol className="mt-4 grid gap-3 border-t border-white/10 pt-3">{steps.map((step,i) => <li key={i} className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-start gap-3 text-sm"><span className="font-number pt-0.5 text-xs text-white/50">+{formatMasteryTime(step.elapsed)}</span><span className={step.kind === "notice" ? "text-white/60" : "font-medium text-white/85"}>{step.text}</span></li>)}</ol>
        </InfraTechnicalCard>)}
      </div>
    </div> : null}
    {(pickerOpen || pickerRequested) && !pending && !requiresAccount && operbox ? <Suspense fallback={<TargetPickerLoading onClose={() => { setPickerOpen(false); onPickerRequestConsumed(); }} />}><TargetPicker operbox={operbox} selectedId={selectedId} onClose={() => { setPickerOpen(false); onPickerRequestConsumed(); }} onSelect={(id) => { setSelectedId(id); setPickerOpen(false); onPickerRequestConsumed(); setCopyFeedback(null); setScrollRequested(true); }} /></Suspense> : null}
  </section>;
}
