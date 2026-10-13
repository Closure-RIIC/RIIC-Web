"use client";
import { localize as localize_components_setup_ManualOperboxPicker } from "../../i18n/helpers/components_setup_ManualOperboxPicker.ts";
import { useTranslations, useLocale } from "next-intl";

import {
  memo,
  useCallback,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, RotateCcw } from "lucide-react";

import fullOperboxJson from "../../../fixtures/operbox_full_e2.json" with { type: "json" };
import operatorCatalogJson from "../../generated/arkntools/operator-catalog.json" with { type: "json" };
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OperatorSkillTooltip } from "@/components/OperatorSkillTooltip";
import { SetupActionButton } from "@/components/setup/SetupActionButton";
import type { AppLocale } from "@/i18n/config";
import { localizedOperatorName } from "@/i18n/game-data";
import { useGameCatalog } from "@/i18n/game-data-client";
import { cn } from "@/lib/utils";
import {
  buildManualOperbox,
  manualLevelFor,
  manualStageForEntry,
  maxEliteForRarity,
  type ManualOperboxStage,
} from "@/manual-operbox";
import { OperatorIdentity, OperatorSearch, OperatorRarityFilter, OperatorProfessionFilter, OperatorRosterGrid, OPERATOR_PAGE_SIZE } from "@/components/operators/OperatorPickerParts";
import { OwnedOperatorFilter } from "@/components/operators/OwnedOperatorFilter";
import type { OperBoxEntry } from "@/types";

const PAGE_SIZE = OPERATOR_PAGE_SIZE;

type CatalogOperator = {
  id: string;
  order: number;
  portrait: string;
  profession: number;
};

type ManualRosterOperator = OperBoxEntry & {
  order: number;
  portrait: string;
  profession: number;
};

const CATALOG_BY_ID = new Map(
  (operatorCatalogJson as CatalogOperator[]).map((operator) => [operator.id, operator]),
);

const MANUAL_ROSTER: ManualRosterOperator[] = (fullOperboxJson as OperBoxEntry[])
  .map((operator) => ({
    ...operator,
    order: CATALOG_BY_ID.get(operator.id)?.order ?? 0,
    portrait: CATALOG_BY_ID.get(operator.id)?.portrait ?? "",
    profession: CATALOG_BY_ID.get(operator.id)?.profession ?? 0,
  }))
  .sort((left, right) => right.rarity - left.rarity || right.order - left.order || left.name.localeCompare(right.name, "zh-CN"));

const STAGES: ManualOperboxStage[] = ["none", "e0-low", "e0", "e1", "e2"];

const STAGE_COLOR: Record<ManualOperboxStage, string> = {
  none: "#71717A",
  e0: "#22BBFF",
  "e0-low": "#A3A3A3",
  e1: "#B8F03A",
  e2: "#FFD800",
};

const SHIFT_BADGE_CLASS = [
  "border-[#C7A600]/40 bg-[#FFD501]/18 text-[#695700] dark:text-[#FFE36B]",
  "border-sky-500/35 bg-sky-500/10 text-sky-800 dark:text-sky-300",
  "border-emerald-500/35 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
] as const;

function shiftLabel(shift: number, en: boolean, short = false): string {
  if (en) return short ? `S${shift}` : `Shift ${shift}`;
  if (short) return `${shift}班`;
  return ["第一班", "第二班", "第三班"][shift - 1] ?? `第${shift}班`;
}

function initialStages(operbox: OperBoxEntry[] | null): Record<string, ManualOperboxStage> {
  const byId = new Map(operbox?.map((entry) => [entry.id, entry]) ?? []);
  const byName = new Map(operbox?.map((entry) => [entry.name, entry]) ?? []);
  return Object.fromEntries(
    MANUAL_ROSTER.map((operator) => [operator.id, manualStageForEntry(byId.get(operator.id) ?? byName.get(operator.name))]),
  );
}

function stageLabel(stage: ManualOperboxStage, locale: AppLocale, rarity?: number): string {
  const en = locale === "en";
  if (stage === "none") return localize_components_setup_ManualOperboxPicker.text(en, "unowned");
  if (stage === "e0") return rarity !== undefined && rarity <= 2 ? (locale === "en" ? "E0 level 30" : "精0 30级") : localize_components_setup_ManualOperboxPicker.text(en, "e0");
  if (stage === "e0-low") return locale === "en" ? "E0 below max" : "精0非30";
  if (stage === "e1") return localize_components_setup_ManualOperboxPicker.text(en, "e1");
  return localize_components_setup_ManualOperboxPicker.text(en, "e2");
}

function maximumStageForRarity(rarity: number): ManualOperboxStage {
  const maximum = maxEliteForRarity(rarity);
  if (maximum === 2) return "e2";
  if (maximum === 1) return "e1";
  return "e0";
}

const ManualOperatorCard = memo(function ManualOperatorCard({
  operator,
  stage,
  locale,
  compact = false,
  scheduledShifts,
  onStageChange,
}: {
  operator: ManualRosterOperator;
  stage: ManualOperboxStage;
  locale: AppLocale;
  compact?: boolean;
  scheduledShifts?: readonly number[];
  onStageChange: (id: string, stage: ManualOperboxStage) => void;
}) {
  const en = locale === "en";
  const gameCatalog = useGameCatalog();
  const displayName = localizedOperatorName(operator.name, locale, gameCatalog);
  const maxElite = maxEliteForRarity(operator.rarity);
  const selectedElite = stage === "none" ? null : stage === "e2" ? 2 : stage === "e1" ? 1 : 0;
  const selectedLevel = selectedElite === null ? undefined : manualLevelFor(operator.rarity, selectedElite);
  const identity = (
    <button
      type="button"
      className={cn(
        "min-w-0 rounded-[4px] text-left outline-none hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-[#FFD800] focus-visible:ring-offset-2",
        compact
          ? "col-span-2 grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2 sm:col-span-2"
          : "flex items-center gap-3",
      )}
      aria-label={localize_components_setup_ManualOperboxPicker.text(en, "showInfrastructureSkills", { displayName: displayName })}
    >
      <OperatorIdentity name={operator.name} portrait={operator.portrait} compact={compact}>
          <span className="font-number text-xs text-muted-foreground">
            {operator.rarity}★ · {localize_components_setup_ManualOperboxPicker.text(en, "upToE", { maxElite: maxElite })}
          </span>
          {scheduledShifts?.length ? (
            <span className="grid w-fit grid-cols-2 gap-0.5">
              {scheduledShifts.map((shift, index) => (
                <span
                  key={shift}
                  className={cn(
                    "inline-flex h-4 items-center justify-center border px-1 text-[10px] font-semibold leading-none",
                    index >= 2 && "col-span-2 justify-self-center",
                    SHIFT_BADGE_CLASS[(shift - 1) % SHIFT_BADGE_CLASS.length],
                  )}
                  title={shiftLabel(shift, en)}
                >
                  {shiftLabel(shift, en, true)}
                </span>
              ))}
            </span>
          ) : null}
      </OperatorIdentity>
    </button>
  );

  return (
    <article className={cn(
      "rounded-[4px] border border-border/80 bg-background [content-visibility:auto]",
      compact
        ? "grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-2 p-2 [contain-intrinsic-size:4.5rem] sm:grid-cols-[2.5rem_minmax(6.5rem,0.72fr)_minmax(13rem,1.28fr)]"
        : "grid gap-3 p-3 [contain-intrinsic-size:8.5rem]",
    )}>
      <OperatorSkillTooltip
        name={operator.name}
        trigger={identity}
        contextLabel={selectedElite === null
          ? (localize_components_setup_ManualOperboxPicker.text(en, "currentSelectionUnowned"))
          : (localize_components_setup_ManualOperboxPicker.text(en, "currentSelectionELv", { selectedElite: selectedElite, selectedLevel: selectedLevel ?? 1 }))}
        currentElite={selectedElite}
        currentLevel={selectedLevel}
        delay={400}
      />

      <div
        role="radiogroup"
        aria-label={localize_components_setup_ManualOperboxPicker.text(en, "ownershipAndEliteStage", { displayName: displayName })}
        className={cn("grid grid-cols-4", compact ? "col-span-2 gap-1 sm:col-span-1" : "gap-1.5")}
      >
        {STAGES.filter((option) => {
          if (operator.rarity <= 2) return option === "none" || option === "e0-low" || option === "e0";
          if (operator.rarity === 3) return option !== "e0-low" && option !== "e2";
          return option !== "e0-low";
        }).map((option) => {
          const requestedElite = option === "e2" ? 2 : option === "e1" ? 1 : 0;
          const disabled = (option === "e0-low" && operator.rarity > 2) || (option !== "none" && option !== "e0-low" && requestedElite > maxElite);
          const selected = stage === option;
          return (
            <Button
              key={option}
              type="button"
              size="sm"
              variant="outline"
              role="radio"
              aria-checked={selected}
              aria-label={disabled
                ? (localize_components_setup_ManualOperboxPicker.text(en, "isUnavailableForStarOperators", { value1: stageLabel(option, locale), rarity: operator.rarity }))
                : stageLabel(option, locale, operator.rarity)}
              title={disabled ? (localize_components_setup_ManualOperboxPicker.text(en, "unavailableForStarOperators", { rarity: operator.rarity })) : undefined}
              disabled={disabled}
              onClick={() => onStageChange(operator.id, option)}
              style={selected ? { backgroundColor: STAGE_COLOR[option], borderColor: STAGE_COLOR[option] } : undefined}
              className={cn(
                "relative w-full rounded-[4px] px-1 focus-visible:ring-[#FFD501] focus-visible:ring-offset-2",
                selected && (option === "none" ? "text-white" : "text-[#202020]"),
                !selected && !disabled && "border-border bg-background text-muted-foreground hover:border-foreground/45 hover:bg-muted/60 hover:text-foreground",
                disabled && "cursor-not-allowed border-border/50 bg-muted/30 text-muted-foreground/40",
              )}
            >
              <span className="inline-flex items-center justify-center">
                {stageLabel(option, locale, operator.rarity)}
              </span>
            </Button>
          );
        })}
      </div>
    </article>
  );
});

export function ManualOperboxPicker({
  operbox,
  onApply,
  title,
  description,
  applyLabel,
  applyDisabled = false,
  scheduledOperatorNames,
  scheduledOperatorShifts,
  scheduledShiftCount = 0,
  compact = false,
  showProfessionFilter = false,
}: {
  operbox: OperBoxEntry[] | null;
  onApply: (entries: OperBoxEntry[]) => void;
  title?: string;
  description?: string | null;
  applyLabel?: string;
  applyDisabled?: boolean;
  scheduledOperatorNames?: readonly string[];
  scheduledOperatorShifts?: Readonly<Record<string, readonly number[]>>;
  scheduledShiftCount?: number;
  compact?: boolean;
  showProfessionFilter?: boolean;
}) {
  const intl = useTranslations();
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  const en = locale === "en";
  const [query, setQuery] = useState("");
  const [onlyOwned, setOnlyOwned] = useState(false);
  const [rarity, setRarity] = useState("all");
  const [profession, setProfession] = useState("all");
  const [rosterScope, setRosterScope] = useState<"scheduled" | "other">("scheduled");
  const [scheduledShift, setScheduledShift] = useState<"all" | number>("all");
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const [stages, setStages] = useState<Record<string, ManualOperboxStage>>(() => initialStages(operbox));
  const [allMaximumStages, setAllMaximumStages] = useState(false);
  const [ownedMaximumStages, setOwnedMaximumStages] = useState(false);
  const stagesBeforeAllMaximum = useRef<Record<string, ManualOperboxStage> | null>(null);
  const [maximumStagesBackup, setMaximumStagesBackup] = useState<Record<string, ManualOperboxStage> | null>(null);
  const stagesBeforeOwnedMaximum = useRef<Record<string, ManualOperboxStage> | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase((locale === "en" ? "en-US" : "zh-CN")));
  const scheduledNames = useMemo(() => new Set([
    ...(scheduledOperatorNames ?? []),
    ...Object.keys(scheduledOperatorShifts ?? {}),
  ]), [scheduledOperatorNames, scheduledOperatorShifts]);
  const hasScheduledOperators = scheduledNames.size > 0;
  const shiftCounts = useMemo(() => Array.from({ length: scheduledShiftCount }, (_, index) => {
    const shift = index + 1;
    return MANUAL_ROSTER.reduce((count, operator) => (
      scheduledOperatorShifts?.[operator.name]?.includes(shift) ? count + 1 : count
    ), 0);
  }), [scheduledOperatorShifts, scheduledShiftCount]);

  const handleStageChange = useCallback((id: string, stage: ManualOperboxStage) => {
    stagesBeforeAllMaximum.current = null;
    setMaximumStagesBackup(null);
    setAllMaximumStages(false);
    stagesBeforeOwnedMaximum.current = null;
    setOwnedMaximumStages(false);
    setStages((current) => ({ ...current, [id]: stage }));
  }, []);

  const summary = useMemo(() => {
    const result = { none: 0, e0: 0, e1: 0, e2: 0 };
    for (const operator of MANUAL_ROSTER) {
      const stage = stages[operator.id] ?? "none";
      result[stage === "e0-low" ? "e0" : stage] += 1;
    }
    return result;
  }, [stages]);
  const ownedCount = summary.e0 + summary.e1 + summary.e2;

  const filteredOperators = useMemo(() => MANUAL_ROSTER.filter((operator) => {
    const stage = stages[operator.id] ?? "none";
    const ownershipStage = allMaximumStages ? (maximumStagesBackup?.[operator.id] ?? stage) : stage;
    if (hasScheduledOperators && (rosterScope === "scheduled") !== scheduledNames.has(operator.name)) return false;
    if (rosterScope === "scheduled" && scheduledShift !== "all" && !scheduledOperatorShifts?.[operator.name]?.includes(scheduledShift)) return false;
    if (onlyOwned && ownershipStage === "none") return false;
    if (rarity !== "all" && operator.rarity !== Number(rarity)) return false;
    if (showProfessionFilter && profession !== "all" && operator.profession !== Number(profession)) return false;
    if (!deferredQuery) return true;
    const displayName = localizedOperatorName(operator.name, locale, gameCatalog).toLocaleLowerCase((locale === "en" ? "en-US" : "zh-CN"));
    return operator.name.toLocaleLowerCase("zh-CN").includes(deferredQuery)
      || displayName.includes(deferredQuery)
      || operator.id.toLocaleLowerCase("en-US").includes(deferredQuery);
  }), [allMaximumStages, deferredQuery, gameCatalog, hasScheduledOperators, locale, maximumStagesBackup, onlyOwned, profession, rarity, rosterScope, scheduledNames, scheduledOperatorShifts, scheduledShift, showProfessionFilter, stages]);

  function resetListView() {
    setVisibleLimit(PAGE_SIZE);
  }

  function applySelection() {
    if (!ownedCount || applyDisabled) return;
    onApply(buildManualOperbox(MANUAL_ROSTER, stages));
  }

  function toggleAllMaximumStages() {
    if (allMaximumStages) {
      const previousStages = stagesBeforeAllMaximum.current;
      stagesBeforeAllMaximum.current = null;
      setMaximumStagesBackup(null);
      setAllMaximumStages(false);
      if (previousStages) setStages(previousStages);
      resetListView();
      return;
    }

    const sourceStages = ownedMaximumStages
      ? stagesBeforeOwnedMaximum.current ?? stages
      : stages;
    stagesBeforeOwnedMaximum.current = null;
    setOwnedMaximumStages(false);
    stagesBeforeAllMaximum.current = sourceStages;
    setMaximumStagesBackup(sourceStages);
    setOnlyOwned(false);
    setStages(Object.fromEntries(
      MANUAL_ROSTER.map((operator) => [operator.id, maximumStageForRarity(operator.rarity)]),
    ));
    setAllMaximumStages(true);
    resetListView();
  }

  function toggleOwnedFilter() {
    if (!onlyOwned) {
      const sourceStages = allMaximumStages
        ? stagesBeforeAllMaximum.current ?? stages
        : ownedMaximumStages
          ? stagesBeforeOwnedMaximum.current ?? stages
          : stages;
      stagesBeforeAllMaximum.current = null;
      setMaximumStagesBackup(null);
      setAllMaximumStages(false);
      stagesBeforeOwnedMaximum.current = null;
      setOwnedMaximumStages(false);
      if (sourceStages !== stages) setStages(sourceStages);
    }
    setOnlyOwned((current) => !current);
    resetListView();
  }

  function toggleOwnedMaximumStages() {
    if (ownedMaximumStages) {
      const previousStages = stagesBeforeOwnedMaximum.current;
      stagesBeforeOwnedMaximum.current = null;
      setOwnedMaximumStages(false);
      if (previousStages) setStages(previousStages);
      resetListView();
      return;
    }

    const sourceStages = allMaximumStages
      ? stagesBeforeAllMaximum.current ?? stages
      : stages;
    stagesBeforeAllMaximum.current = null;
    setMaximumStagesBackup(null);
    setAllMaximumStages(false);
    setOnlyOwned(false);
    stagesBeforeOwnedMaximum.current = sourceStages;
    setStages(Object.fromEntries(
      MANUAL_ROSTER.map((operator) => {
        const currentStage = sourceStages[operator.id] ?? "none";
        return [operator.id, currentStage === "none" ? "none" : maximumStageForRarity(operator.rarity)];
      }),
    ));
    setOwnedMaximumStages(true);
    resetListView();
  }

  const rarityTabs = <OperatorRarityFilter value={rarity} disabled={applyDisabled} onChange={(value) => { setRarity(value); resetListView(); }} />;

  const rosterScopeTabs = hasScheduledOperators ? (
    <Tabs
      className="shrink-0"
      value={rosterScope}
      onValueChange={(value) => {
        const nextScope = value as "scheduled" | "other";
        setRosterScope(nextScope);
        if (nextScope === "other") setScheduledShift("all");
        resetListView();
      }}
    >
      <TabsList aria-label={intl("components_setup_ManualOperboxPicker.operatorListScope")}>
        <TabsTrigger value="scheduled">
          {intl("components_setup_ManualOperboxPicker.inSchedule")}<span className="font-number opacity-65">{scheduledNames.size}</span>
        </TabsTrigger>
        <TabsTrigger value="other">
          {intl("components_setup_ManualOperboxPicker.notScheduled")}<span className="font-number opacity-65">{MANUAL_ROSTER.length - scheduledNames.size}</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  ) : null;

  const scheduledShiftTabs = compact && rosterScope === "scheduled" && scheduledShiftCount > 0 ? (
    <Tabs
      className="shrink-0 border-l border-border/70 pl-2"
      value={String(scheduledShift)}
      onValueChange={(value) => {
        setScheduledShift(value === "all" ? "all" : Number(value));
        resetListView();
      }}
    >
      <TabsList aria-label={intl("components_setup_ManualOperboxPicker.scheduleShift")}>
        <TabsTrigger value="all">
          {intl("components_setup_ManualOperboxPicker.allShifts")}
        </TabsTrigger>
        {shiftCounts.map((count, index) => {
          const shift = index + 1;
          return (
            <TabsTrigger key={shift} value={String(shift)}>
              {shiftLabel(shift, en)}<span className="font-number opacity-65">{count}</span>
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  ) : null;

  const professionTabs = showProfessionFilter ? <OperatorProfessionFilter value={profession} disabled={applyDisabled} onChange={(value) => { setProfession(value); resetListView(); }} /> : null;

  const resolvedDescription = description === undefined
    ? (intl("components_setup_ManualOperboxPicker.chooseOwnershipAndEliteStageLevelsUseEachStage"))
    : description;

  return (
    <div className={cn("grid min-w-0 grid-cols-1", compact ? "gap-2.5" : "gap-4")} data-manual-operbox-picker data-density={compact ? "compact" : "comfortable"}>
      <div className={cn("flex flex-wrap justify-between gap-3 border-b border-border/70", compact ? "items-center pb-2.5" : "items-start pb-4")}>
        <div className={cn("min-w-0", compact && "flex flex-1 flex-wrap items-baseline gap-x-3 gap-y-1 max-sm:w-full max-sm:flex-none")}>
          <h4 className="shrink-0 text-sm font-semibold">{title ?? (intl("components_setup_ManualOperboxPicker.buildYourOperatorBox"))}</h4>
          {resolvedDescription ? (
            <p className={cn("max-w-2xl text-xs text-muted-foreground", compact ? "leading-4" : "mt-1 leading-5")}>
              {resolvedDescription}
            </p>
          ) : null}
          {compact ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" aria-live="polite">
              <strong className="font-number text-foreground">{intl("components_setup_ManualOperboxPicker.owned", { ownedCount: ownedCount })}</strong>
              <span className="font-number text-muted-foreground">{intl("components_setup_ManualOperboxPicker.e0E1E2", { e0: summary.e0, e1: summary.e1, e2: summary.e2 })}</span>
              <span className="font-number text-muted-foreground">{intl("components_setup_ManualOperboxPicker.unowned2", { none: summary.none })}</span>
            </div>
          ) : null}
        </div>
        <SetupActionButton
          type="button"
          className={cn(compact && "max-sm:w-full")}
          data-manual-operbox-apply
          disabled={!ownedCount || applyDisabled}
          onClick={applySelection}
        >
          <Check />{applyLabel ?? (intl("components_setup_ManualOperboxPicker.useThisBox"))}
        </SetupActionButton>
      </div>

      {!compact ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs" aria-live="polite">
          <strong className="font-number text-foreground">{intl("components_setup_ManualOperboxPicker.owned", { ownedCount: ownedCount })}</strong>
          <span className="font-number text-muted-foreground">{intl("components_setup_ManualOperboxPicker.e0E1E2", { e0: summary.e0, e1: summary.e1, e2: summary.e2 })}</span>
          <span className="font-number text-muted-foreground">{intl("components_setup_ManualOperboxPicker.unowned2", { none: summary.none })}</span>
        </div>
      ) : null}

      <div className={cn("grid min-w-0 grid-cols-1 gap-2", compact ? "lg:grid-cols-[minmax(14rem,1fr)_auto]" : "sm:grid-cols-[minmax(0,1fr)_auto]")}>
        <OperatorSearch value={query} compact={compact} onChange={(value) => { setQuery(value); resetListView(); }} />
        <div className={cn("flex flex-nowrap items-center max-sm:grid max-sm:grid-cols-2", compact ? "gap-1.5" : "gap-2")} data-manual-operbox-actions>
          <OwnedOperatorFilter
            value={onlyOwned}
            onChange={toggleOwnedFilter}
          />
          <SetupActionButton
            type="button"
            variant={allMaximumStages ? "default" : "outline"}
            className="min-w-[104px] px-2 text-[11px] font-normal max-sm:min-w-[104px] sm:min-w-[116px] sm:px-2 sm:text-xs"
            aria-pressed={allMaximumStages}
            onClick={toggleAllMaximumStages}
          >
            {intl("components_setup_ManualOperboxPicker.selectAllAtMaxElite")}
          </SetupActionButton>
          <SetupActionButton
            type="button"
            variant={ownedMaximumStages ? "default" : "outline"}
            className="min-w-[104px] px-2 text-[11px] font-normal max-sm:min-w-[104px] sm:min-w-[116px] sm:px-2 sm:text-xs"
            aria-pressed={ownedMaximumStages}
            disabled={!ownedCount}
            onClick={toggleOwnedMaximumStages}
          >
            {intl("components_setup_ManualOperboxPicker.ownedAtMaxElite")}
          </SetupActionButton>
          <Button
            type="button"
            variant="ghost"
            className={cn("min-w-0 overflow-hidden px-2 text-ellipsis text-xs sm:px-3", compact ? "h-9" : "min-h-11 sm:text-sm")}
            disabled={!ownedCount}
            onClick={() => {
              stagesBeforeAllMaximum.current = null;
              setMaximumStagesBackup(null);
              setAllMaximumStages(false);
              stagesBeforeOwnedMaximum.current = null;
              setOwnedMaximumStages(false);
              setStages(Object.fromEntries(MANUAL_ROSTER.map((operator) => [operator.id, "none"])));
              setOnlyOwned(false);
              resetListView();
            }}
          >
            <RotateCcw />{intl("components_setup_ManualOperboxPicker.clear")}
          </Button>
        </div>
      </div>

      {compact && hasScheduledOperators ? (
        <div
          className="grid min-w-0 gap-1.5"
          data-upgrade-operbox-filters
        >
          <div data-yeye-scroll="auto"
            className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto pb-1"
            data-upgrade-operbox-schedule-filters
          >
            {rosterScopeTabs}
            {scheduledShiftTabs}
          </div>
          <div data-yeye-scroll="auto"
            className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto pb-1"
            data-upgrade-operbox-operator-filters
          >
            <div className="flex shrink-0 items-center gap-1" data-manual-operbox-rarity-filter>
              <div className="shrink-0 text-xs font-medium text-muted-foreground">{intl("components_setup_ManualOperboxPicker.rarity")}</div>
              {rarityTabs}
            </div>
            {professionTabs ? (
              <div className="flex shrink-0 items-center gap-1 border-l border-border/70 pl-2" data-manual-operbox-profession-filter>
                <div className="shrink-0 text-xs font-medium text-muted-foreground">{intl("components_setup_ManualOperboxPicker.profession")}</div>
                {professionTabs}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div data-yeye-scroll="auto" className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto pb-1">
            <div className="flex shrink-0 items-center gap-1" data-manual-operbox-rarity-filter>
              <div className="shrink-0 text-xs font-medium text-muted-foreground">{intl("components_setup_ManualOperboxPicker.rarity")}</div>
              {rarityTabs}
            </div>
            {professionTabs ? (
              <div className="flex shrink-0 items-center gap-1 border-l border-border/70 pl-2" data-manual-operbox-profession-filter>
                <div className="shrink-0 text-xs font-medium text-muted-foreground">{intl("components_setup_ManualOperboxPicker.profession")}</div>
                {professionTabs}
              </div>
            ) : null}
          </div>
          {hasScheduledOperators ? (
            <div className="flex flex-wrap items-center gap-2">
              {rosterScopeTabs}
            </div>
          ) : null}
        </>
      )}

      {filteredOperators.length ? (
        <>
          <OperatorRosterGrid compact={compact} hasMore={visibleLimit < filteredOperators.length} onLoadMore={() => setVisibleLimit((current) => current + PAGE_SIZE)}>
            {filteredOperators.slice(0, visibleLimit).map((operator) => (
              <ManualOperatorCard
                key={operator.id}
                operator={operator}
                stage={stages[operator.id] ?? "none"}
                locale={locale}
                compact={compact}
                scheduledShifts={rosterScope === "scheduled" ? scheduledOperatorShifts?.[operator.name] : undefined}
                onStageChange={handleStageChange}
              />
            ))}
          </OperatorRosterGrid>
          {!compact ? (
            <div className="flex justify-end">
              <SetupActionButton
                type="button"
                data-manual-operbox-apply
                disabled={!ownedCount || applyDisabled}
                onClick={applySelection}
              >
                <Check />{applyLabel ?? (intl("components_setup_ManualOperboxPicker.useThisBox2", { ownedCount: ownedCount }))}
              </SetupActionButton>
            </div>
          ) : null}
        </>
      ) : (
        <div className="grid min-h-32 place-items-center border border-dashed border-border text-center text-sm text-muted-foreground">
          {onlyOwned && !ownedCount
            ? (intl("components_setup_ManualOperboxPicker.noOperatorsSelectedYet"))
            : (intl("components_setup_ManualOperboxPicker.noMatchingOperators"))}
        </div>
      )}
    </div>
  );
}
