"use client";
import { localize as localize_components_UpgradeSimulationDialog } from "../i18n/helpers/components_UpgradeSimulationDialog.ts";
import { useTranslations, useLocale } from "use-intl";
import { messageRecord } from "@/i18n/translate";

import { FlaskConical, Loader2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { ManualOperboxPicker } from "@/components/setup/ManualOperboxPicker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { MaaRoom, OperBoxEntry, PublicPlanData } from "@/types";
import { hasOperboxEliteStateChange } from "@/upgrade-simulation";

type Metric = "trade" | "manufacture" | "power";

const METRICS: Array<{ key: Metric; en: string; zh: string }> = [
  { key: "trade", en: messageRecord("en", "components_UpgradeSimulationDialog_content").value, zh: messageRecord("zh", "components_UpgradeSimulationDialog_content").value },
  { key: "manufacture", en: messageRecord("en", "components_UpgradeSimulationDialog_content2").value, zh: messageRecord("zh", "components_UpgradeSimulationDialog_content2").value },
  { key: "power", en: messageRecord("en", "components_UpgradeSimulationDialog_content3").value, zh: messageRecord("zh", "components_UpgradeSimulationDialog_content3").value },
];

function metric(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(1).replace(/\.?0+$/, "")}%`
    : "—";
}

function delta(before: number | null | undefined, after: number | null | undefined, en: boolean) {
  if (typeof before !== "number" || typeof after !== "number") return "—";
  const value = Math.round((after - before) * 10) / 10;
  return value === 0 ? (localize_components_UpgradeSimulationDialog.text(en, "noChange")) : `${value > 0 ? "+" : ""}${value.toFixed(1).replace(/\.?0+$/, "")}%`;
}

export function UpgradeSimulationDialog({
  operbox,
  baseline,
  open,
  disabled = false,
  showTrigger = true,
  onOpen,
  onOpenChange,
  onSimulate,
  onTrialReady,
}: {
  operbox: OperBoxEntry[];
  baseline: PublicPlanData;
  open: boolean;
  disabled?: boolean;
  showTrigger?: boolean;
  onOpen: () => void;
  onOpenChange: (open: boolean) => void;
  onSimulate: (trialOperbox: OperBoxEntry[]) => Promise<PublicPlanData>;
  onTrialReady?: (trial: PublicPlanData) => void;
}) {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale === "en";
  const [trial, setTrial] = useState<PublicPlanData | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const scheduledOperatorShifts = useMemo(() => {
    const shiftsByName: Record<string, number[]> = {};
    baseline.maa.plans.slice(0, 3).forEach((plan, planIndex) => {
      const shift = planIndex + 1;
      (Object.values(plan.rooms) as Array<MaaRoom[] | undefined>)
        .flatMap((rooms) => rooms ?? [])
        .flatMap((room) => room.operators)
        .forEach((operator) => {
          const name = typeof operator === "string" ? operator : operator?.name;
          if (!name) return;
          const shifts = shiftsByName[name] ?? [];
          if (!shifts.includes(shift)) shiftsByName[name] = [...shifts, shift];
        });
    });
    return shiftsByName;
  }, [baseline.maa.plans]);
  const scheduledOperatorNames = useMemo(() => Object.keys(scheduledOperatorShifts), [scheduledOperatorShifts]);

  const apply = async (nextBox: OperBoxEntry[]) => {
    if (pendingRef.current) return;
    if (!hasOperboxEliteStateChange(operbox, nextBox)) {
      setError(intl("components_UpgradeSimulationDialog.changeAtLeastOneOperatorSOwnershipOrElite"));
      return;
    }

    pendingRef.current = true;
    setPending(true);
    setError(null);
    setTrial(null);
    try {
      const nextTrial = await onSimulate(nextBox);
      setTrial(nextTrial);
      onTrialReady?.(nextTrial);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error
        ? reason.message
        : intl("components_UpgradeSimulationDialog.recalculationWithTheUpdatedProgressionFailedPleaseTryAgain"));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <>
      {showTrigger ? (
        <Button type="button" variant="outline" size="sm" className="h-9 min-h-0 max-sm:h-11" disabled={disabled} onClick={onOpen}>
          <FlaskConical />{intl("components_UpgradeSimulationDialog.modifyProgressionAndRecalculate")}
        </Button>
      ) : null}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent data-upgrade-simulation-dialog className="h-[min(720px,calc(100dvh-1rem))] max-w-[calc(100%-1rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-[24px] p-0 sm:max-w-[min(1060px,calc(100%-2rem))] sm:rounded-[32px]" aria-describedby="upgrade-simulation-description">
          <DialogHeader className="border-b border-border/70 px-4 py-3 pr-14 sm:flex-row sm:items-center sm:gap-5 sm:px-6 sm:py-4 sm:pr-16">
            <DialogTitle className="shrink-0 text-lg">
              {intl("components_UpgradeSimulationDialog.modifyProgressionAndRecalculate2")}
            </DialogTitle>
            <DialogDescription id="upgrade-simulation-description" className="max-w-3xl leading-5">
              {intl("components_UpgradeSimulationDialog.updateOwnershipOrEliteStageAndRecalculateWithThe")}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="min-h-0" viewportClassName="overflow-x-hidden">
            <div className="px-4 py-3 sm:px-6 sm:py-4">
              <ManualOperboxPicker
                compact
                showProfessionFilter
                operbox={operbox}
                scheduledOperatorNames={scheduledOperatorNames}
                scheduledOperatorShifts={scheduledOperatorShifts}
                scheduledShiftCount={Math.min(3, baseline.maa.plans.length)}
                title={intl("components_UpgradeSimulationDialog.operatorsForThisRecalculation")}
                description={intl("components_UpgradeSimulationDialog.changeAtLeastOneOperatorTheseUpdatesAreSaved")}
                applyLabel={pending
                  ? (intl("components_UpgradeSimulationDialog.solvingAgain"))
                  : (intl("components_UpgradeSimulationDialog.saveProgressionAndRecalculate"))}
                applyDisabled={pending}
                onApply={(entries) => void apply(entries)}
              />
              {pending ? (
                <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {intl("components_UpgradeSimulationDialog.recalculatingWithTheUpdatedProgressionAndSameLayout")}
                </p>
              ) : null}
              {error ? <p className="mt-3 border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{error}</p> : null}
              {trial ? (
                <section className="mt-3 flex flex-wrap items-center gap-3 border border-primary/25 bg-primary/5 px-3 py-2.5" aria-label={intl("components_UpgradeSimulationDialog.progressionRecalculationResult")}>
                  <div className="min-w-48 flex-1">
                    <h3 className="font-semibold">{intl("components_UpgradeSimulationDialog.recalculationComplete")}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {intl("components_UpgradeSimulationDialog.theBoxIsUpdatedSwitchBetweenTheOriginalAnd")}
                    </p>
                  </div>
                  <dl className="grid w-full grid-cols-3 divide-x divide-primary/15 border border-primary/15 bg-background sm:w-auto">
                    {METRICS.map(({ key, en: englishLabel, zh }) => {
                      const change = delta(baseline.rotation.daily[key], trial.rotation.daily[key], en);
                      return (
                        <div key={key} className="min-w-24 px-3 py-1.5">
                          <dt className="text-[11px] text-muted-foreground">{en ? englishLabel : zh}</dt>
                          <dd className="font-number text-base font-semibold">{metric(trial.rotation.daily[key])}</dd>
                          <span className={cn("block text-[11px] font-medium", change.startsWith("+") ? "text-emerald-700" : change.startsWith("-") ? "text-red-700" : "text-muted-foreground")}>
                            {intl("components_UpgradeSimulationDialog.vsCurrent", { change: change })}
                          </span>
                        </div>
                      );
                    })}
                  </dl>
                </section>
              ) : null}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
