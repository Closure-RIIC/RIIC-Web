import { localize as localize_components } from "./i18n/helpers/components.ts";
import { useTranslations, useLocale } from "next-intl";
import {
  Check,
  ChevronDown,
  ArrowLeftRight,
  FileWarning,
  Loader2,
  LockKeyhole,
  Play,
  Smile,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CSSProperties, lazy, ReactElement, ReactNode, Suspense, startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { AnimatedNumber, AnimatedText } from "@/components/AnimatedText";
import { CachedScheduleView } from "@/components/CachedScheduleView";
import { transitionScheduleLayout } from "@/components/schedule-layout-transition";
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SetupStepper } from "@/components/setup/SetupStepper";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonSwap } from "@/components/ui/skeleton-swap";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { localizedBuildingSkill, localizedOperatorName, localizedRoomTitle } from "@/i18n/game-data";
import { useGameCatalog } from "@/i18n/game-data-client";
import {
  BUILDING_SKILL_ENHANCED_WORD,
  buildingSkillUnlockLabel,
  buildingSkillUnlockLabelEnglish,
  buildingSkillUnlockPrefix,
  operatorProfessionLabelEnglishForCode,
  operatorProfessionPresentationForCode,
} from "@/operator-presentation";
import { roomVisualFor } from "@/room-visuals";
import {
  MOTION_DURATION,
  MOTION_EASE_IN_OUT,
  MOTION_EASE_OUT,
  type ShiftDirection,
} from "@/motion";

export { roomVisualFor } from "@/room-visuals";

import {
  FACTORY_RECIPE_OPTIONS,
  FactoryRecipe,
  TRADE_ORDER_OPTIONS,
  TradeOrder,
  factoryRecipeFor,
  hasUnlockedFactoryRecipes,
  maxRoomLevel,
  productLabel,
  roomKindLabel,
  tradeOrderFor,
} from "./blueprint";
import { presentRoomEfficiency, RoomEfficiencyPresentation } from "./efficiency";
import {
  shiftTabLabel,
  shiftTeamSummary,
} from "./rotation-presentation";
import { DEFAULT_ROTATION_PROFILE } from "./rotation-settings";
import { RoomRow } from "./schedule";
import { withRecyclingRoom } from "./recycling-room";
import { RecyclingRoomNotice } from "./components/RecyclingRoomNotice";
import {
  COMPACT_OPERATOR_SIZE_CLASS,
  LevelDiamondVariant,
  OPERATOR_NAME_SIZE_CLASS,
  levelDiamondCount,
  roomGridTone,
} from "./schedule-view-presentation";
import {
  buildListScheduleGroups,
  buildMobileListScheduleGroups,
  isListFunctionalFacilityRoom,
  listFunctionalFacilityGridClass,
  listFunctionalOperatorPosition,
  listFunctionalOperatorPlacementClass,
  listFunctionalRoomSpanClass,
  listMobileOperatorGridClass,
  listRoomHeightClass,
  listRoomTitleSizeClass,
  listRoomUsesAlignedOperatorOrigin,
} from "./schedule-list-layout";
import {
  BaseBlueprint,
  MaaJson,
  MaaPlan,
  PresetDef,
  RotationJson,
} from "./types";

const OperatorSkillTooltip = lazy(() => import("@/components/OperatorSkillTooltip").then((module) => ({
  default: module.OperatorSkillTooltip,
})));

function CompactScheduleLoading({ rows }: { rows: RoomRow[] }) {
  const intl = useTranslations();

  const grouped = new Map<string, RoomRow[]>();
  for (const row of rows) {
    grouped.set(row.group, [...(grouped.get(row.group) ?? []), row]);
  }
  const workstations = [...(grouped.get("trading") ?? []), ...(grouped.get("manufacture") ?? [])];
  const power = grouped.get("power") ?? [];
  const dormitories = grouped.get("dormitory") ?? [];
  const skeleton = (
    row: RoomRow,
    className: string,
    style?: CSSProperties,
  ) => (
    <Skeleton
      key={row.key}
      className={cn("min-w-0 flex-1 rounded-none border border-[#313131]/10 bg-[#313131]/14", className)}
      data-compact-room-skeleton
      data-room-group={row.group}
      style={style}
    />
  );

  return (
    <div
      className="min-h-[560px]"
      data-compact-schedule-loading
      role="status"
      aria-label={intl("components.preparingOverview")}
    >
      <span className="sr-only">{intl("components.preparingOverview")}</span>
      <div className="flex items-stretch gap-3" aria-hidden="true">
        <div className="flex min-w-0 flex-col gap-3" style={{ flexBasis: "55%" }}>
          {(grouped.get("control") ?? []).map((room) => skeleton(room, "h-32"))}
          {[0, 2, 4].map((start) => (
            <div key={start} className="flex gap-3">
              {workstations.slice(start, start + 2).map((room) => skeleton(room, "h-36"))}
            </div>
          ))}
          {power.length === 3 ? (
            <div className="flex gap-3">
              {power.map((room) => skeleton(room, "h-24"))}
            </div>
          ) : (
            <div className="flex gap-3">
              <div className="flex gap-3" style={{ flexBasis: "50%" }}>
                {power.slice(0, 2).map((room) => skeleton(room, "h-24"))}
              </div>
              {workstations[6] ? skeleton(workstations[6], "h-24", { flexBasis: "50%" }) : null}
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-3" style={{ flexBasis: "45%" }}>
          <div className="compact-auxiliary-container min-w-0">
            <div className="compact-auxiliary-grid">
              {["meeting", "training", "recycling", "hire", "processing"].flatMap((group) => (
                (grouped.get(group) ?? []).map((room) => skeleton(room, "h-28"))
              ))}
            </div>
          </div>
          {dormitories.slice(0, 4).map((room) => (
            <div key={room.key} className="flex min-h-24 flex-1">
              {skeleton(room, "h-full")}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type ScheduleViewMode = "list" | "compact";
type CompactScheduleComponent = typeof import("@/components/CompactScheduleView").CompactScheduleView;

type Option<T extends string> = {
  value: T;
  label: ReactNode;
};

export function ProductToggleGroup<T extends string>({
  value,
  options,
  onChange,
  columns,
  tone = "default",
  surface = "default",
  layout = "compact",
  ariaLabel,
  disabledValue,
}: {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  columns: 2 | 3 | 4;
  tone?: "default" | "trade" | "factory";
  surface?: "default" | "room";
  layout?: "compact" | "fill";
  ariaLabel: string;
  disabledValue?: T;
}) {
  const locale = useLocale();
  const roomProductControls = surface === "room" && (tone === "trade" || tone === "factory");
  const compactRoomProductControls = roomProductControls && layout === "compact";
  const fillRoomProductControls = roomProductControls && layout === "fill";

  return (
    <ToggleGroup
      aria-label={ariaLabel}
      value={[value]}
      onValueChange={(nextValue) => {
        const next = nextValue[0] as T | undefined;
        if (next) onChange(next);
      }}
      spacing={1}
      className={cn(
        "grid",
        compactRoomProductControls
          ? tone === "factory"
            ? "w-full grid-cols-3 gap-x-2 gap-y-2.5 sm:w-fit sm:grid-cols-[repeat(2,90px)]"
            : "w-fit grid-cols-[repeat(2,70px)] gap-x-2 gap-y-2.5 sm:grid-cols-[repeat(2,90px)]"
          : cn(
              "w-full",
              fillRoomProductControls && "gap-x-2 gap-y-2.5",
              columns === 4 ? "grid-cols-4 sm:grid-cols-2" : columns === 2 ? "grid-cols-2" : "grid-cols-3"
            )
      )}
    >
      {options.map((option) => {
        const disabled = option.value === disabledValue;
        const isOriginiumTrade = tone === "trade" && option.value === "originium";
        const isOriginiumRecipe = tone === "factory" && option.value === "originium";
        const isBattleRecordRecipe = tone === "factory" && option.value === "battle_record";
        const englishProduct = option.value === "gold" ? (tone === "trade" ? "LMD Order" : "Pure Gold") : option.value === "originium" ? (tone === "trade" ? "Originium Order" : "Originium Shards") : option.value === "battle_record" ? "Battle Records" : option.value === "all" ? "Auto" : undefined;

        return (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            disabled={disabled}
            size="sm"
            variant="outline"
            className={cn(
              "min-w-0 px-2 text-xs",
              surface === "room" && "infra-room-control",
              surface === "default" && "min-h-10",
              compactRoomProductControls && "max-w-[90px] max-sm:max-w-[70px]",
              compactRoomProductControls && tone === "factory" && "w-full",
              fillRoomProductControls && "w-full",
              tone === "trade" && "product-toggle-trade",
              tone === "factory" && "product-toggle-factory",
              (isOriginiumTrade || isOriginiumRecipe) && "product-toggle-originium",
              isBattleRecordRecipe && "product-toggle-battle-record"
            )}
          >
            {locale === "en" && englishProduct ? englishProduct : option.label}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

export function Panel({
  title,
  icon,
  children,
  className = "",
  action,
  description,
}: {
  title?: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
  description?: string;
}) {
  return (
    <section className={cn("min-w-0 py-5", className)}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        {title || icon || description ? (
          <div className="flex min-w-0 items-start gap-2">
            {icon ? <div className="mt-0.5 text-primary">{icon}</div> : null}
            <div className="min-w-0">
              {title ? <h2 className="text-sm font-semibold tracking-tight">{title}</h2> : null}
              {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
            </div>
          </div>
        ) : null}
        {action ? (
          <div className={cn("ms-auto min-w-0 max-sm:w-full", !title && !icon && !description && "w-full")}>
            {action}
          </div>
        ) : null}
      </header>
      <div>{children}</div>
    </section>
  );
}

export function PresetSelector({
  presets,
  selected,
  onSelect,
}: {
  presets: PresetDef[];
  selected: PresetDef;
  onSelect: (preset: PresetDef) => void;
}) {
  const intl = useTranslations();

  return (
    <ToggleGroup
      aria-label={intl("components.layoutPresets")}
      value={[selected.label]}
      onValueChange={(nextValue) => {
        const next = presets.find((preset) => preset.label === nextValue[0]);
        if (next) onSelect(next);
      }}
      spacing={2}
      className="grid w-full grid-cols-2 gap-2 rounded-none sm:grid-cols-3 lg:grid-cols-5"
    >
      {presets.map((preset) => (
        <ToggleGroupItem
          key={preset.label}
          value={preset.label}
          variant="outline"
          className={cn(
            "infra-preset-surface group/preset relative isolate h-auto min-h-18 justify-between overflow-hidden rounded-none border border-white/10 bg-[#272A2B] px-3 py-3 text-left text-white transition-[background-color,border-color] duration-[var(--motion-duration-state)] ease-[var(--motion-ease-out)] hover:border-white/22 hover:bg-[#303435] hover:text-white",
            selected.label === preset.label && "border-[#FFD800]/72 bg-[#303027] text-white hover:border-[#FFD800]/82 hover:bg-[#343329] hover:text-white"
          )}
        >
          <span
            className={cn(
              "absolute left-3 top-0 h-0.5 w-9 bg-[#FFD800] transition-opacity duration-150",
              selected.label === preset.label ? "opacity-100" : "opacity-0"
            )}
            aria-hidden="true"
          />
          <span className="relative z-10 flex min-w-0 flex-col items-start gap-1">
            <span className="text-lg font-semibold leading-none tabular-nums">{preset.label}</span>
            <span className="text-xs font-normal text-white/58">
              <span className="font-number">{preset.trading}</span> {intl("components.trade")} / <span className="font-number">{preset.manufacture}</span> {intl("components.factory")} / <span className="font-number">{preset.power}</span> {intl("components.power")}
            </span>
          </span>
          {selected.label === preset.label ? <Check className="relative z-10 size-4 shrink-0 text-[#FFD800]" aria-hidden="true" /> : null}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function RoomLevelControl({
  roomId,
  level,
  levelMax,
  onChange,
}: {
  roomId: string;
  level: number;
  levelMax: number;
  onChange: (level: number) => void;
}) {
  const intl = useTranslations();

  return <SetupStepper
    compact
    hideLabel
    label={intl("components.level", { roomId })}
    value={level}
    decreaseLabel={intl("components.decreaseLevel", { roomId })}
    increaseLabel={intl("components.increaseLevel", { roomId })}
    decreaseDisabled={level <= 1}
    increaseDisabled={level >= levelMax}
    onDecrease={() => onChange(Math.max(1, level - 1))}
    onIncrease={() => onChange(Math.min(levelMax, level + 1))}
  />;
}

function roomVisualGroupForKind(kind: BaseBlueprint["rooms"][number]["kind"]): string {
  if (kind === "trade_post") return "trading";
  if (kind === "factory") return "manufacture";
  if (kind === "power_plant") return "power";
  if (kind === "control_center") return "control";
  if (kind === "dormitory") return "dormitory";
  if (kind === "meeting_room") return "meeting";
  if (kind === "workshop") return "processing";
  if (kind === "training_room") return "training";
  if (kind === "office") return "hire";
  return "default";
}

export function LayoutEditor({
  layout,
  onFactoryRecipeChange,
  onTradeOrderChange,
  onRoomLevelChange,
}: {
  layout: BaseBlueprint;
  onFactoryRecipeChange: (roomId: string, recipe: FactoryRecipe) => void;
  onTradeOrderChange: (roomId: string, order: TradeOrder) => void;
  onRoomLevelChange: (roomId: string, level: number) => void;
}) {
  const intl = useTranslations();
  const locale = useLocale();
  const gameCatalog = useGameCatalog();

  const factoryRecipesUnlocked = hasUnlockedFactoryRecipes(layout);
  const roomGroups = [
    { key: "trade", label: intl("components.tradingPosts"), rooms: layout.rooms.filter((room) => room.kind === "trade_post") },
    { key: "factory", label: intl("components.factories"), rooms: layout.rooms.filter((room) => room.kind === "factory") },
    { key: "power", label: intl("components.powerPlants"), rooms: layout.rooms.filter((room) => room.kind === "power_plant") },
    { key: "function", label: intl("components.controlFunctional"), rooms: layout.rooms.filter((room) => !["trade_post", "factory", "power_plant", "dormitory"].includes(room.kind)) },
    { key: "dormitory", label: intl("components.dormitories"), rooms: layout.rooms.filter((room) => room.kind === "dormitory") },
  ].filter((group) => group.rooms.length > 0);

  return (
    <Accordion multiple defaultValue={["trade", "factory"]} aria-label={intl("components.facilitySettings")} className="gap-2.5">
      {roomGroups.map((group) => (
        <AccordionItem key={group.key} value={group.key} data-facility-group={group.key}>
          <AccordionTrigger>
            <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
              <span>{group.label}</span>
              <span className="text-xs font-normal tabular-nums text-muted-foreground">{group.rooms.length}</span>
            </span>
          </AccordionTrigger>
          <AccordionPanel>
            <div className="divide-y divide-border/70">
            {group.rooms.map((room, roomIndex) => {
              const isTrade = room.kind === "trade_post";
              const isFactory = room.kind === "factory";
              const activeOrder = isTrade ? tradeOrderFor(room) : null;
              const activeRecipe = isFactory ? factoryRecipeFor(room) : null;
              const activeProduct = activeOrder ?? activeRecipe;
              const hasRestrictedProduct = isTrade ? room.level < 3 : isFactory && !factoryRecipesUnlocked;
              const showRestrictionHint = hasRestrictedProduct && (!isFactory || roomIndex === 0);
              const restrictionHint = isTrade
                ? intl("components.originiumOrdersRequireALevel3TradingPost")
                : intl("components.unlockOriginiumShardsByOwningAtLeastOneLevel");
              const availableProductOptions: Option<TradeOrder | FactoryRecipe>[] = isTrade
                ? TRADE_ORDER_OPTIONS
                : isFactory
                  ? FACTORY_RECIPE_OPTIONS
                  : [];
              const product = productLabel(room);
              const levelMax = maxRoomLevel(room.kind);
              const visualGroup = roomVisualGroupForKind(room.kind);
              const originalName = group.rooms.length > 1 ? `${roomKindLabel(room.kind)} ${roomIndex + 1}` : roomKindLabel(room.kind);
              const displayName = localizedRoomTitle(originalName, visualGroup, locale, gameCatalog);

              return (
                <div
                  key={room.id}
                  data-slot="setup-room-row"
                  data-room-group={visualGroup}
                  className={cn(
                    "grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 px-4 py-3",
                    (isTrade || isFactory) && "sm:grid-cols-[minmax(8rem,1fr)_auto_minmax(18rem,1.4fr)]"
                  )}
                >
                  <div className="min-w-0">
                    <span className="font-number block truncate text-sm font-medium text-foreground">{displayName}</span>
                    {!isTrade && !isFactory && product ? (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{product}</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span aria-hidden="true">Lv.</span>
                    <RoomLevelControl
                      roomId={room.id}
                      level={room.level}
                      levelMax={levelMax}
                      onChange={(level) => onRoomLevelChange(room.id, level)}
                    />
                  </div>

                  {activeProduct ? (
                    <div className="col-span-2 sm:col-span-1">
                      <ProductToggleGroup<TradeOrder | FactoryRecipe>
                        ariaLabel={`${displayName} ${isTrade ? (intl("components.orders")) : (intl("components.recipe"))}${hasRestrictedProduct ? `, ${restrictionHint}` : ""}`}
                        value={activeProduct}
                        options={availableProductOptions}
                        columns={isTrade ? 2 : 3}
                        tone={isTrade ? "trade" : "factory"}
                        layout="fill"
                        disabledValue={hasRestrictedProduct ? "originium" : undefined}
                        onChange={(nextProduct) => {
                          if (isTrade) onTradeOrderChange(room.id, nextProduct as TradeOrder);
                          else onFactoryRecipeChange(room.id, nextProduct as FactoryRecipe);
                        }}
                      />
                      {showRestrictionHint ? <p className="mt-1.5 text-xs text-muted-foreground">{restrictionHint}。</p> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            </div>
          </AccordionPanel>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

export function RunButton({
  canRun,
  loading,
  plannerReady,
  onRun,
}: {
  canRun: boolean;
  loading: boolean;
  plannerReady: boolean;
  onRun: () => void;
}) {
  const intl = useTranslations();

  const unavailableLabel = plannerReady ? (intl("components.importOperatorDataFirst")) : (intl("components.plannerUnavailable"));
  return (
    <Button
      size="sm"
      className="h-9 min-w-0 max-sm:h-11 max-sm:px-3 max-sm:text-xs"
      aria-label={loading ? (intl("components.calculating")) : canRun ? (intl("components.generateSchedule")) : unavailableLabel}
      title={!canRun ? (plannerReady ? (intl("components.importOperatorDataFirst2")) : (intl("components.plannerUnavailableTryAgainLater"))) : undefined}
      onClick={onRun}
      disabled={!canRun || loading}
    >
      {loading ? <Loader2 className="animate-spin" /> : <Play />}
      <span>{loading ? (intl("components.calculating")) : canRun ? (intl("components.generate")) : (intl("components.importToGenerate"))}</span>
    </Button>
  );
}

export function ShiftTabs({
  maaJson,
  rotation,
  durations,
  labels,
  wrap = false,
  active,
  closest,
  onChange,
  control = "tabs",
}: {
  maaJson?: MaaJson;
  rotation?: RotationJson;
  durations?: readonly number[];
  labels?: readonly { content: ReactNode; ariaLabel: string }[];
  wrap?: boolean;
  active: number;
  closest?: number;
  onChange: (index: number) => void;
  control?: "tabs" | "select";
}) {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale === "en";
  const plans = maaJson?.plans ?? [];

  if (plans.length === 0) {
    return (
      <Button type="button" variant="outline" disabled size="sm">
        {intl("components.awaitingResult")}
      </Button>
    );
  }

  const labelForShift = (index: number) => {
    const shift = rotation?.shifts[index];
    const durationHours = shift?.duration_hours ?? durations?.[index];
    return localize_components.text(en, "additional1", {
      value1: en ? String(index + 1) : "",
      choice2: en && durationHours !== undefined ? "yes" : "no",
      value3: en && durationHours !== undefined ? String(compactNumber(durationHours)) : "",
      choice4: !en && durationHours !== undefined ? "yes" : "no",
      value5: !en && durationHours !== undefined ? String(index + 1) : "",
      value6: !en && durationHours !== undefined ? String(compactNumber(durationHours)) : "",
      value7: !en && durationHours === undefined ? String(shiftTabLabel(shift, index)) : "",
    });
  };

  if (control === "select") {
    return (
      <label className="flex min-w-0 items-center">
        <span className="sr-only">{en ? "Shift" : "班次"}</span>
        <select
          value={String(active)}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-9 max-w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={en ? "Shift" : "班次"}
        >
          {plans.map((plan, index) => {
            const label = labelForShift(index);
            return <option key={`${plan.name}-${index}`} value={String(index)}>{label}</option>;
          })}
        </select>
      </label>
    );
  }

  return (
    <Tabs value={String(active)} onValueChange={(value) => onChange(Number(value))} className="max-w-full">
      <TabsList
        className={cn(
          "max-w-full justify-start tracking-[0.01em]",
          wrap
            ? "h-auto flex-wrap overflow-visible"
            : "overflow-x-auto overflow-y-hidden",
        )}
        data-shift-tabs
        data-ui-number-font
      >
        {plans.map((plan, index) => {
          const shift = rotation?.shifts[index];
          const label = labelForShift(index);
          const originalTeamSummary = shiftTeamSummary(shift, rotation?.profile ?? DEFAULT_ROTATION_PROFILE);
          const teamSummary = en && originalTeamSummary ? originalTeamSummary.replaceAll("主力", "Main").replaceAll("替补", "Backup").replaceAll("上班", "working").replaceAll("休息", "resting") : originalTeamSummary;
          const customLabel = labels?.[index];
          return (
            <TabsTrigger
              key={`${plan.name}-${index}`}
              value={String(index)}
              aria-label={customLabel?.ariaLabel ?? (teamSummary ? `${label}${intl("components.label")}${teamSummary}` : label)}
            >
              {customLabel?.content ?? label}
              {closest === index ? <span className="rounded-full bg-primary/10 px-1.5 text-xs text-primary max-md:hidden">{intl("components.closest")}</span> : null}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}

function compactNumber(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(digits).replace(/\.?0+$/, "");
}

const LazyPlanTelemetry = lazy(() => import("./components/PlanTelemetry").then((module) => ({ default: module.PlanTelemetry })));

export function PlanTelemetry(props: Parameters<typeof import("./components/PlanTelemetry").PlanTelemetry>[0]) {
  return <Suspense fallback={null}><LazyPlanTelemetry {...props} /></Suspense>;
}

const ROOM_SLOT_COUNT = 5;
const AUXILIARY_ROOM_GROUPS = new Set(["dormitory", "hire", "meeting", "processing", "training", "recycling"]);

export function scheduleIssueTriggerId(row: RoomRow) {
  return `schedule-issue-${row.key}`;
}


function roomSlotCountFor(group: string) {
  if (group === "trading" || group === "manufacture") return 3;
  if (group === "training" || group === "meeting" || group === "recycling") return 2;
  return ROOM_SLOT_COUNT;
}

export function LevelDiamonds({
  level,
  maxLevel,
  variant = "list",
}: {
  level?: number;
  maxLevel?: number;
  variant?: LevelDiamondVariant;
}) {
  const intl = useTranslations();

  const count = levelDiamondCount(level);
  if (!count || !level) return null;

  return (
    <span
      className="flex shrink-0 items-center gap-1.5"
      aria-label={intl("components.levelMaximum", { level: level, value2: maxLevel ?? level })}
      title={variant === "compact" ? `Lv.${level}/${maxLevel ?? level}` : undefined}
    >
      <span className="level-diamonds" data-variant={variant} aria-hidden="true">
        {Array.from({ length: count }).map((_, index) => (
          <span key={index} className="level-diamond" />
        ))}
      </span>
      {variant === "list" ? (
        <span className="shrink-0 text-xs font-semibold tracking-[0.02em] text-white/68">
          Lv<span className="font-number">.{level}/{maxLevel ?? level}</span>
        </span>
      ) : null}
    </span>
  );
}

export function RoomEfficiencyReadout({
  value,
  details = true,
  trend = 0,
}: {
  value: RoomEfficiencyPresentation;
  details?: boolean;
  trend?: ShiftDirection;
}) {
  return (
    <div className="min-w-0" title={value.details.map((detail) => detail.label ? `${detail.label} ${detail.value}` : detail.value).join(" · ")}>
      <div className="flex min-w-0 items-center gap-1.5">
        <strong
          className="infra-room-value font-technical shrink-0 text-base font-semibold tabular-nums tracking-[0.01em] text-[var(--room-accent)] max-sm:text-xs"
          data-room-primary-efficiency
        >
          <AnimatedNumber value={value.primaryValue} trend={trend} />
        </strong>
        {value.primaryLabel ? (
          <span className="truncate text-xs font-medium text-white/68">
            <AnimatedText value={value.primaryLabel} trend={trend} />
          </span>
        ) : null}
      </div>
      {details && value.details.length ? (
        <div className="font-technical mt-1 flex max-h-9 flex-wrap gap-x-2 gap-y-0.5 overflow-hidden text-xs leading-4 tracking-[0.01em] text-white/60 max-sm:max-h-none">
          {value.details.map((detail, index) => (
            <span key={`${detail.kind ?? ""}-${detail.label ?? ""}-${index}`} className={detail.kind === "cross-station" ? "font-semibold text-[#C8F75A]" : undefined}>
              {value.formula ? <>{detail.operator ? `${detail.operator} ` : ""}<span className="font-number"><AnimatedText value={detail.value} trend={trend} /></span>{detail.label ? ` ${detail.label}` : ""}</> : <>{detail.label} <span className="font-number"><AnimatedText value={detail.value} trend={trend} /></span></>}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RoomEfficiencyDetails({
  value,
  trend = 0,
}: {
  value: RoomEfficiencyPresentation | null;
  trend?: ShiftDirection;
}) {
  if (!value?.details.length) return null;

  return (
    <div
      className={cn(
        "font-technical grid min-w-[160px] max-w-[240px] gap-1 text-sm leading-tight tracking-[0.01em] text-white/68 max-sm:hidden max-[819px]:min-w-0 max-[819px]:max-w-none max-[819px]:grid-cols-3 max-[819px]:text-xs max-[819px]:leading-normal",
        value.formula && "max-w-[340px] max-[819px]:grid max-[819px]:grid-cols-3"
      )}
      title={value.details.map((detail) => detail.label ? `${detail.label} ${detail.value}` : detail.value).join(" · ")}
    >
      {value.formula ? (
        <>
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 whitespace-nowrap">
            {value.details.slice(0, 3).map((detail, index) => (
              <span
                key={`${detail.kind ?? ""}-${detail.label ?? ""}-${index}`}
                className={cn(detail.kind === "cross-station" && "font-semibold text-[#C8F75A]")}
              >
                {detail.operator ? `${detail.operator} ` : ""}<span className="font-number"><AnimatedText value={detail.value} trend={trend} /></span>{detail.label ? ` ${detail.label}` : ""}
              </span>
            ))}
          </div>
          {value.details.slice(3).map((detail, index) => (
            <span key={`${detail.kind ?? ""}-${detail.label ?? ""}-${index + 3}`} className="mt-1 block whitespace-nowrap">
              {detail.operator ? `${detail.operator} ` : ""}<span className="font-number"><AnimatedText value={detail.value} trend={trend} /></span>{detail.label ? ` ${detail.label}` : ""}
            </span>
          ))}
        </>
      ) : value.details.map((detail, index) => (
        <span
          key={`${detail.kind ?? ""}-${detail.label ?? ""}-${index}`}
          className={cn(
            "whitespace-nowrap",
            detail.kind === "cross-station" && "font-semibold text-[#C8F75A]"
          )}
        >
          {detail.label} <span className="font-number"><AnimatedText value={detail.value} trend={trend} /></span>
        </span>
      ))}
    </div>
  );
}

export function RoomProductControls({
  row,
  layoutRoom,
  onFactoryRecipeChange,
  onTradeOrderChange,
}: {
  row: RoomRow;
  layoutRoom: BaseBlueprint["rooms"][number] | undefined;
  onFactoryRecipeChange: (roomId: string, recipe: FactoryRecipe) => void;
  onTradeOrderChange: (roomId: string, order: TradeOrder) => void;
}) {
  const intl = useTranslations();
  const locale = useLocale();
  const gameCatalog = useGameCatalog();

  if (row.group === "training") {
    return null;
  }

  const isTrade = layoutRoom?.kind === "trade_post";
  const isFactory = layoutRoom?.kind === "factory";
  const activeOrder = isTrade ? tradeOrderFor(layoutRoom) : null;
  const activeRecipe = isFactory ? factoryRecipeFor(layoutRoom) : null;
  const activeProduct = activeOrder ?? activeRecipe;

  if (activeProduct) {
    return (
      <div className={cn("w-full", isTrade ? "max-sm:w-fit" : "max-w-[220px]")}>
        <ProductToggleGroup<TradeOrder | FactoryRecipe>
          ariaLabel={`${localizedRoomTitle(row.title, row.group, locale, gameCatalog)} ${isTrade ? (intl("components.orders")) : (intl("components.recipe"))}`}
          value={activeProduct}
          options={isTrade ? TRADE_ORDER_OPTIONS : FACTORY_RECIPE_OPTIONS}
          columns={isTrade ? 2 : 4}
          tone={isTrade ? "trade" : "factory"}
          surface="room"
          onChange={(nextProduct) => {
            if (isTrade) onTradeOrderChange(row.roomId, nextProduct as TradeOrder);
            else onFactoryRecipeChange(row.roomId, nextProduct as FactoryRecipe);
          }}
        />
      </div>
    );
  }

  if (!row.product) return null;

  return <div className="infra-room-value text-lg font-medium leading-none text-[var(--room-accent)]">{row.product}</div>;
}

function OperatorSlotShell({
  ariaLabel,
  centerFrameInList,
  compactFactory,
  compactView,
  editableAppearance = true,
  editableHint,
  frameClassName,
  frameContent,
  frameFocusable = false,
  frameWrapper = (frame) => frame,
  label,
  labelClassName,
  positionLabel,
  title,
  onActivate,
  unavailable = false,
}: {
  ariaLabel?: string;
  centerFrameInList: boolean;
  compactFactory: boolean;
  compactView: boolean;
  editableAppearance?: boolean;
  editableHint?: string;
  frameClassName: string;
  frameContent?: ReactNode;
  frameFocusable?: boolean;
  /** 可选：包装头像框元素（例如包上技能 tooltip 的 trigger）。默认原样返回。 */
  frameWrapper?: (frame: ReactElement) => ReactElement;
  label: ReactNode;
  labelClassName: string;
  positionLabel?: string;
  title?: string;
  onActivate?: () => void;
  unavailable?: boolean;
}) {
  const frame = (
    <div
      className={cn(
        "relative aspect-square h-[var(--operator-slot-size)] min-w-0 shrink-0 overflow-hidden border-2 max-sm:border",
        frameClassName,
        !unavailable && frameFocusable && "cursor-help outline-none transition-[border-color,box-shadow] hover:border-white/90 focus-visible:border-[#FFD501] focus-visible:ring-2 focus-visible:ring-[#FFD501]/70",
        unavailable ? "border-[#666] bg-[#292929] opacity-70" : onActivate && editableAppearance && "border-[#FFD800] shadow-[0_0_0_1px_rgba(255,216,0,0.42),0_0_12px_rgba(255,216,0,0.2)]",
        centerFrameInList && "max-sm:h-auto max-sm:w-full sm:absolute sm:left-0 sm:top-1/2 sm:-translate-y-1/2",
      )}
      aria-label={ariaLabel}
      role={!unavailable && frameFocusable ? "button" : undefined}
      tabIndex={!unavailable && frameFocusable ? 0 : undefined}
    >
      {frameContent}
      {unavailable ? (
        <span className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-1 bg-black/55 text-xs text-white/80" data-operator-slot-lock-overlay>
          <LockKeyhole className="size-4" aria-hidden="true" />
          <span>{editableHint}</span>
        </span>
      ) : editableHint ? (
        <span className="pointer-events-none absolute bottom-0.5 right-0.5 z-20 bg-black/72 px-1 py-0.5 text-[9px] font-medium leading-none tracking-wide text-[#FFD800]">
          {editableHint}
        </span>
      ) : null}
    </div>
  );

  return (
    <div
      className={cn(
        "infra-operator-slot min-w-0 shrink-0",
        compactView
          ? COMPACT_OPERATOR_SIZE_CLASS
          : "[--operator-slot-size:clamp(70px,7.3vw,80px)] max-sm:[--operator-slot-size:clamp(56px,16vw,76px)]",
        compactFactory && "min-[1800px]:[--operator-slot-size:70px]",
        centerFrameInList && "max-sm:w-full sm:relative sm:h-full sm:w-[var(--operator-slot-size)]",
        !unavailable && onActivate && "cursor-pointer rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-[#FFD800]",
        !unavailable && onActivate && editableAppearance && "focus-visible:ring-offset-2 focus-visible:ring-offset-[#313131]",
      )}
      data-position={positionLabel || undefined}
      title={title}
      aria-label={!unavailable && onActivate ? ariaLabel : undefined}
      role={!unavailable && onActivate ? "button" : undefined}
      tabIndex={!unavailable && onActivate ? 0 : undefined}
      onClick={unavailable ? undefined : onActivate}
      onKeyDown={!unavailable && onActivate ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate();
        }
      } : undefined}
    >
      {frameWrapper(frame)}
      <span
        className={cn(
          "mt-0.5 block truncate text-center leading-tight",
          OPERATOR_NAME_SIZE_CLASS,
          labelClassName,
          centerFrameInList && "sm:absolute sm:left-0 sm:top-[calc(50%+var(--operator-slot-size)/2+2px)] sm:mt-0 sm:w-full",
        )}
      >
        <span className="block truncate">{label}</span>
      </span>
    </div>
  );
}

function BuildingSkillBadge({
  skill,
  interactive = true,
}: {
  skill: NonNullable<RoomRow["operatorSlots"][number]["buildingSkill"]>;
  interactive?: boolean;
}) {
  const intl = useTranslations();
  const [open, setOpen] = useState(false);
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  const displaySkill = localizedBuildingSkill(skill.id, locale, skill, gameCatalog);
  const unlockLabel = locale === "en"
    ? buildingSkillUnlockLabelEnglish(skill.elite, skill.level, skill.enhanced)
    : buildingSkillUnlockLabel(skill.elite, skill.level, skill.enhanced);
  if (!interactive) {
    return (
      <span
        className="pointer-events-none absolute right-0 top-0 z-10 flex size-10 items-center justify-center border-b border-l border-white/22 bg-black/76 text-white max-sm:size-11"
        aria-hidden="true"
      >
        <img src={skill.icon} alt="" className="size-9 shrink-0 object-contain" />
      </span>
    );
  }
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger
        closeOnClick={false}
        render={
          <button
            type="button"
            className="absolute right-0 top-0 z-10 flex size-10 items-center justify-center border-b border-l border-white/22 bg-black/76 text-white outline-none transition-colors hover:bg-black/88 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#FFD800] max-sm:size-11"
            aria-label={intl("components.infrastructureSkillS", { index: skill.index, name: (locale === "en") ? (displaySkill.name) : "", unlockLabel: unlockLabel, nameValue: (locale === "en") ? "" : (skill.name) })}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onClick={() => setOpen(true)}
          >
            <img src={skill.icon} alt="" className="size-9 shrink-0 object-contain" aria-hidden="true" />
          </button>
        }
      />
      <TooltipContent
        side="top"
        align="end"
        className="max-w-80 flex-col items-start gap-1.5 whitespace-normal px-3 py-2 text-left leading-relaxed"
      >
        <span className="font-semibold">S<span className="font-number">{skill.index}</span> · {displaySkill.name}</span>
        <span className="text-background/72">
          {locale === "en" ? (
            unlockLabel
          ) : skill.enhanced ? (
            <>
              <span>{buildingSkillUnlockPrefix(skill.elite, skill.level)}</span>
              <span className="text-[#22BBFF]">{BUILDING_SKILL_ENHANCED_WORD}</span>
            </>
          ) : (
            unlockLabel
          )}
        </span>
        <span>{displaySkill.description}</span>
      </TooltipContent>
    </Tooltip>
  );
}

export function OperatorSlot({
  slot,
  currentMorale,
  elite,
  operatorLevel,
  autofill = false,
  compactFactory = false,
  compactView = false,
  selectionMode = false,
  centerFrameInList = false,
  shiftDirection = 0,
  transitionDelay = 0,
  portraitSize = 180,
  positionLabel,
  showSkillTooltip = false,
  emptyLabel,
  skillTooltipFocusable = false,
  tooltipDisabled = false,
  skillTooltipHighlightIds = [],
  skillTooltipContextLabel,
  searchQuery = "",
  onActivate,
  unavailable = false,
  highlightNoLayoutSkill = false,
  sortSelected = false,
  onSortActivate,
}: {
  slot: RoomRow["operatorSlots"][number] | undefined;
  currentMorale?: number;
  /** 干员精英化等级（0/1/2），传入后会在头像左下角显示对应角标。 */
  elite?: number;
  /** 干员当前等级，用于判断带等级要求的基建技能是否已解锁。 */
  operatorLevel?: number;
  autofill?: boolean;
  compactFactory?: boolean;
  compactView?: boolean;
  /** 选择器样式：保留点击与技能提示，但不显示排班卡片的“可编辑”标记和常驻黄框。 */
  selectionMode?: boolean;
  centerFrameInList?: boolean;
  shiftDirection?: ShiftDirection;
  transitionDelay?: number;
  portraitSize?: number;
  positionLabel?: string;
  /** 悬停卡片时展示干员全部基建技能 tooltip，并关闭卡片自身的原生 title hover。 */
  showSkillTooltip?: boolean;
  /** Unknown occupancy must not be presented as a confirmed empty slot. */
  emptyLabel?: string;
  /** 让头像进入键盘焦点顺序；仅用于需要主动查看技能的界面，避免排班图产生过多 Tab 停靠点。 */
  skillTooltipFocusable?: boolean;
  /** 滚动等临时交互期间关闭技能提示，避免 tooltip 跟随已移动的头像。 */
  tooltipDisabled?: boolean;
  /** 练卡建议等场景中，需要在技能 tooltip 内强调的技能。 */
  skillTooltipHighlightIds?: readonly string[];
  skillTooltipContextLabel?: string;
  searchQuery?: string;
  onActivate?: () => void;
  unavailable?: boolean;
  highlightNoLayoutSkill?: boolean;
  sortSelected?: boolean;
  onSortActivate?: () => void;
}) {
  const intl = useTranslations();
  const shouldReduceMotion = useReducedMotion();
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  const displayName = slot ? localizedOperatorName(slot.name, locale, gameCatalog) : undefined;
  const displayPositionLabel = locale === "en" ? (positionLabel === "训练位" ? "Trainee" : positionLabel === "协助位" ? "Trainer" : positionLabel) : positionLabel;
  const identity = slot?.name ?? (autofill ? "autofill" : "empty");
  const suppressNativeTitles = showSkillTooltip && slot !== undefined;
  const profession = slot ? operatorProfessionPresentationForCode(slot.profession) : undefined;
  const professionLabelEnglish = slot ? operatorProfessionLabelEnglishForCode(slot.profession) : undefined;
  const enterX = shouldReduceMotion ? 0 : shiftDirection * 6;
  const exitX = shouldReduceMotion ? 0 : shiftDirection * -4;
  const unavailableLabel = intl("components.slotLocked");
  const occupantLabel = unavailable ? unavailableLabel : displayName ?? (autofill ? (intl("components.autoFill")) : (emptyLabel ?? intl("components.empty")));
  const occupantAriaLabel = displayPositionLabel
    ? `${displayPositionLabel}${intl("components.label2")}${occupantLabel}`
    : occupantLabel;
  const ariaLabel = showSkillTooltip && skillTooltipFocusable && slot
    ? `${occupantAriaLabel}${intl("components.focusToViewInfrastructureSkills")}`
    : occupantAriaLabel;
  const searchMatched = Boolean(slot && searchQuery && slot.name.toLocaleLowerCase("zh-CN").includes(searchQuery));
  const frameClassName = sortSelected
    ? "border-[#FFD800] bg-[#3C3C3C] ring-2 ring-[#FFD800]/70"
    : highlightNoLayoutSkill
    ? "border-[#F59E0B] bg-[#3C3C3C] shadow-[0_0_0_2px_rgba(245,158,11,0.45)]"
    : slot
    ? "border-[#7F7F7F] bg-[#3C3C3C] shadow-[inset_0_0_18px_rgba(255,255,255,0.16)]"
    : autofill
      ? "border-[#666] bg-[#3C3C3C] shadow-[inset_0_0_18px_rgba(255,255,255,0.08)]"
      : "border-[#4B4B4B] bg-[#3C3C3C]";

  const shell = (
    <OperatorSlotShell
      ariaLabel={ariaLabel}
      centerFrameInList={centerFrameInList}
      compactFactory={compactFactory}
      compactView={compactView}
      editableAppearance={!selectionMode}
      unavailable={unavailable}
      editableHint={unavailable ? unavailableLabel : onActivate && !selectionMode ? (intl("components.edit")) : undefined}
      frameClassName={frameClassName}
      frameContent={
        <AnimatePresence initial={false} mode="sync">
          <motion.div
            key={identity}
            className="absolute inset-0"
            data-operator-identity={identity}
            initial={{ opacity: 0, x: enterX }}
            animate={{ opacity: 1, x: 0 }}
            exit={{
              opacity: 0,
              x: exitX,
              pointerEvents: "none",
              transition: {
                duration: MOTION_DURATION.fast,
                ease: MOTION_EASE_OUT,
              },
            }}
            transition={{
              duration: shouldReduceMotion ? MOTION_DURATION.feedback : MOTION_DURATION.state,
              delay: shouldReduceMotion ? 0 : transitionDelay,
              ease: MOTION_EASE_OUT,
            }}
          >
            {slot ? (
              <>
                {slot.portrait ? (
                  <>
                    <img
                      src={slot.portrait}
                      alt={displayName ?? slot.name}
                      width={portraitSize}
                      height={portraitSize}
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 h-full w-full object-cover outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
                    />
                    {profession ? (
                      <img
                        src={profession.icon}
                        alt=""
                        aria-hidden="true"
                        title={suppressNativeTitles ? undefined : intl("components.profession", { value1: (locale === "en") ? (professionLabelEnglish ?? "Unknown") : "", label: (locale === "en") ? "" : (profession.label) })}
                        className="absolute left-0 top-0 z-10 h-[25%] w-auto"
                      />
                    ) : null}
                  </>
                ) : (
                  <div className="flex h-full items-center justify-center bg-[#4B4B4B] px-2 text-center text-xs font-semibold text-white">
                    <AnimatedText value={displayName ?? slot.name} trend={shiftDirection} />
                  </div>
                )}
                {slot.buildingSkill ? (
                  <BuildingSkillBadge skill={slot.buildingSkill} interactive={!onActivate} />
                ) : typeof slot.skill === "number" ? (
                  <span
                    className="absolute right-0 top-0 z-10 flex size-9 items-center justify-center border-b border-l border-white/22 bg-black/76 text-xs font-semibold text-white"
                    aria-label={intl("components.infrastructureSkillSNoSkillData", { skill: slot.skill })}
                  >
                    S<span className="font-number">{slot.skill}</span>
                  </span>
                ) : null}
                {typeof elite === "number" && elite >= 0 && elite <= 2 ? (
                  <img
                    src={`/images/elite/elite_${elite}.png`}
                    alt={intl("components.elite", { elite: elite })}
                    className="pointer-events-none absolute bottom-0 left-0 z-10 h-[30%] w-auto"
                    data-elite-badge={elite}
                  />
                ) : null}
                {elite === undefined && typeof currentMorale === "number" ? (
                  <span
                    className="absolute bottom-0.5 left-0.5 flex items-center gap-0.5 whitespace-nowrap rounded-sm bg-black/72 px-1 py-0.5 text-xs font-normal leading-none text-white shadow-[0_1px_3px_rgba(0,0,0,0.5)] [&_svg]:size-2.5 max-sm:bottom-0.5 max-sm:left-0.5 max-sm:px-0.5 max-sm:[&_svg]:size-2.5"
                    aria-label={intl("components.currentMorale24", { currentMorale: currentMorale })}
                    title={suppressNativeTitles ? undefined : intl("components.currentMorale24", { currentMorale: currentMorale })}
                  >
                    <Smile className="text-[#FFD501]" />
                    <span className="max-sm:hidden">{intl("components.now")}</span>
                    <span className="font-number"><AnimatedText value={currentMorale} trend={shiftDirection} /></span>
                  </span>
                ) : null}
                {slot.portraitAlert === "missing-power-efficiency" ? (
                  <span
                    className="pointer-events-none absolute inset-0 z-30 bg-red-600/45 mix-blend-color"
                    aria-hidden="true"
                    data-operator-portrait-alert="missing-power-efficiency"
                  />
                ) : null}
              </>
            ) : autofill ? (
              <span className="flex h-full items-center justify-center text-xs font-semibold tracking-[0.14em] text-white/55">
                AUTO
              </span>
            ) : (
              <span className="absolute left-1/2 top-1/2 h-0.5 w-[78%] origin-center -translate-x-1/2 -translate-y-1/2 rotate-[-45deg] bg-[#4B4B4B]" aria-hidden="true" />
            )}
          </motion.div>
        </AnimatePresence>
      }
      frameFocusable={showSkillTooltip && skillTooltipFocusable && Boolean(slot)}
      frameWrapper={showSkillTooltip && slot ? (frame) => (
        <Suspense fallback={frame}>
          <OperatorSkillTooltip
            name={slot.name}
            trigger={frame}
            highlightedSkillIds={skillTooltipHighlightIds}
            contextLabel={skillTooltipContextLabel}
            currentElite={elite}
            currentLevel={operatorLevel}
            disabled={tooltipDisabled || undefined}
          />
        </Suspense>
      ) : undefined}
      label={slot ? <AnimatedText value={displayName ?? slot.name} trend={shiftDirection} /> : autofill ? (intl("components.autoFill")) : (emptyLabel ?? intl("components.slot"))}
      labelClassName={slot
        ? (searchMatched ? "bg-[#FFD501] px-1 text-[#202020]" : selectionMode ? "text-popover-foreground" : "text-white")
        : autofill || emptyLabel
          ? "text-white/55"
          : "text-transparent select-none"}
      positionLabel={displayPositionLabel}
      title={suppressNativeTitles ? undefined : displayName ?? slot?.label}
      onActivate={onSortActivate ?? onActivate}
    />
  );

  return shell;
}

export function ScheduleBoard({
  simulation,
  rows: sourceRows,
  layout,
  planRevision,
  eliteByOperator,
  levelByOperator,
  viewControlsSlot,
  viewModeActionSlot,
  mobileActionsSlot,
  shiftInfoSlot,
  shiftTabsSlot,
  activeShift,
  shiftDirection = 0,
  activePlan,
  searchQuery = "",
  animateInitialView = false,
  onIssue,
  feedbackDisabled = false,
  onFactoryRecipeChange,
  onTradeOrderChange,
  onViewModeChange,
  viewModeControl = "tabs",
  hideImages = false,
  onSlotClick,
  sortRoomId,
  sortSelection,
  onSortToggle,
  onSortSlotClick,
  onClearRoom,
  onDormAutofillChange,
  droneTargetRoomId,
  onDroneTargetChange,
  renderListRoomActions,
  onManualSkillEfficiencyChange,
  highlightNoLayoutSkill = false,
  noLayoutSkillOperators,
}: {
  simulation?: { moods: Readonly<Record<string, number>>; selected: string; onSelect: (name: string) => void };
  rows: RoomRow[];
  layout: BaseBlueprint;
  planRevision?: string;
  /** 按干员名查精英化等级（0/1/2），用于在排班头像左下角显示角标。 */
  eliteByOperator?: ReadonlyMap<string, number>;
  /** 按干员名查当前等级，用于技能解锁状态。 */
  levelByOperator?: ReadonlyMap<string, number>;
  viewControlsSlot?: ReactNode;
  viewModeActionSlot?: ReactNode;
  mobileActionsSlot?: ReactNode;
  shiftInfoSlot?: ReactNode;
  shiftTabsSlot?: ReactNode;
  activeShift: number;
  shiftDirection?: ShiftDirection;
  activePlan?: MaaPlan;
  searchQuery?: string;
  animateInitialView?: boolean;
  onIssue?: (row: RoomRow) => void;
  feedbackDisabled?: boolean;
  onFactoryRecipeChange: (roomId: string, recipe: FactoryRecipe) => void;
  onTradeOrderChange: (roomId: string, order: TradeOrder) => void;
  onViewModeChange?: (viewMode: "list" | "compact") => void;
  viewModeControl?: "tabs" | "select";
  hideImages?: boolean;
  onSlotClick?: (row: RoomRow, slotIndex: number) => void;
  sortRoomId?: string | null;
  sortSelection?: { roomId: string; slotIndex: number } | null;
  onSortToggle?: (row: RoomRow) => void;
  onSortSlotClick?: (row: RoomRow, slotIndex: number) => void;
  onClearRoom?: (row: RoomRow) => void;
  onDormAutofillChange?: (row: RoomRow, enabled: boolean) => void;
  droneTargetRoomId?: string | null;
  onDroneTargetChange?: (row: RoomRow) => void;
  renderListRoomActions?: (row: RoomRow, position: "header" | "secondary" | "clear") => ReactNode;
  onManualSkillEfficiencyChange?: (row: RoomRow, value: number | null) => void;
  highlightNoLayoutSkill?: boolean;
  noLayoutSkillOperators?: ReadonlySet<string>;
}) {
  const intl = useTranslations();
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  const en = locale === "en";
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const rows = useMemo(() => layout.template === "Mower" ? sourceRows : withRecyclingRoom(sourceRows), [layout.template, sourceRows]);
  const [hiddenGroups, setHiddenGroups] = useState<Record<string, boolean>>({});
  const [viewMode, setViewMode] = useState<ScheduleViewMode | null>(null);
  const [supportsCompactLayout, setSupportsCompactLayout] = useState<boolean | null>(null);
  const [CompactScheduleView, setCompactScheduleView] = useState<CompactScheduleComponent | null>(null);
  const [compactScheduleLoadFailed, setCompactScheduleLoadFailed] = useState(false);
  const [prepareInactiveView, setPrepareInactiveView] = useState(false);
  const preferredViewMode = useRef<ScheduleViewMode | null>(null);
  const scheduleBoardRef = useRef<HTMLDivElement | null>(null);
  const shouldReduceMotion = useReducedMotion();
  // Drone allocation alone must not hide the calculator's schedule view switcher.
  const editableSchedule = Boolean(onSlotClick || onClearRoom || onDormAutofillChange);

  useLayoutEffect(() => {
    const board = scheduleBoardRef.current;
    if (editableSchedule && board) {
      const syncEditableViewMode = (width: number) => {
        const canUseCompactLayout = width >= 1_040;
        setSupportsCompactLayout(canUseCompactLayout);
        const nextViewMode = canUseCompactLayout
          ? (preferredViewMode.current ?? "compact")
          : "list";
        setViewMode(nextViewMode);
        onViewModeChange?.(nextViewMode);
      };
      syncEditableViewMode(board.getBoundingClientRect().width);
      const observer = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width;
        if (typeof width === "number") syncEditableViewMode(width);
      });
      observer.observe(board);
      return () => observer.disconnect();
    }

    const mq = window.matchMedia("(min-width: 1024px)");
    const syncViewMode = (canUseCompactLayout: boolean) => {
      setSupportsCompactLayout(canUseCompactLayout);
      const nextViewMode = canUseCompactLayout
        ? (preferredViewMode.current ?? "compact")
        : "list";
      setViewMode(nextViewMode);
      onViewModeChange?.(nextViewMode);
    };

    syncViewMode(mq.matches);
    const handler = (event: MediaQueryListEvent) => syncViewMode(event.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [editableSchedule, onViewModeChange]);

  useEffect(() => {
    if (!supportsCompactLayout || !viewMode || prepareInactiveView) return;
    const prepare = () => startTransition(() => setPrepareInactiveView(true));
    if (window.requestIdleCallback) {
      const idle = window.requestIdleCallback(prepare, { timeout: 1500 });
      return () => window.cancelIdleCallback(idle);
    }
    const timer = window.setTimeout(prepare, 500);
    return () => window.clearTimeout(timer);
  }, [supportsCompactLayout, viewMode, prepareInactiveView]);

  useEffect(() => {
    if ((viewMode !== "compact" && !(supportsCompactLayout && prepareInactiveView)) || CompactScheduleView || compactScheduleLoadFailed) return;

    let cancelled = false;
    void import("@/components/CompactScheduleView").then(
      (module) => {
        if (!cancelled) setCompactScheduleView(() => module.CompactScheduleView);
      },
      () => {
        if (!cancelled) setCompactScheduleLoadFailed(true);
      },
    );
    return () => { cancelled = true; };
  }, [CompactScheduleView, compactScheduleLoadFailed, viewMode, supportsCompactLayout, prepareInactiveView]);

  async function changeViewMode(nextViewMode: ScheduleViewMode) {
    if (nextViewMode === preferredViewMode.current && nextViewMode === viewMode) return;
    preferredViewMode.current = nextViewMode;
    let compactComponent = CompactScheduleView;
    if (nextViewMode === "compact" && !compactComponent) {
      try {
        compactComponent = (await import("@/components/CompactScheduleView")).CompactScheduleView;
      } catch {
        setCompactScheduleLoadFailed(true);
      }
    }
    // A later click wins if the compact chunk was still loading.
    if (preferredViewMode.current !== nextViewMode) return;
    const update = () => {
      if (compactComponent) setCompactScheduleView(() => compactComponent);
      setViewMode(nextViewMode);
      onViewModeChange?.(nextViewMode);
    };
    const board = scheduleBoardRef.current;
    if (board) await transitionScheduleLayout(board, nextViewMode, update);
  }

  const normalizedQuery = searchQuery.trim().toLocaleLowerCase("zh-CN");
  const visibleRows = useMemo(() => normalizedQuery
    ? rows.filter((row) => row.title.toLocaleLowerCase("zh-CN").includes(normalizedQuery) || row.operators.some((name) => name.toLocaleLowerCase("zh-CN").includes(normalizedQuery)))
    : rows, [normalizedQuery, rows]);
  const rowGroups = useMemo(() => supportsCompactLayout === false
    ? buildMobileListScheduleGroups(visibleRows)
    : buildListScheduleGroups(visibleRows), [supportsCompactLayout, visibleRows]);
  const auxiliaryGroups = rowGroups.filter((group) => AUXILIARY_ROOM_GROUPS.has(group.rows[0]?.group ?? ""));
  const hiddenAuxiliaryCount = auxiliaryGroups.filter((group) => hiddenGroups[group.label]).length;
  const allAuxiliaryCollapsed =
    auxiliaryGroups.length > 0 &&
    auxiliaryGroups.every((group) => collapsedGroups[group.label] || hiddenGroups[group.label]);

  // Stable children let React reuse the mounted room trees on layout switches.
  const listContent = useMemo(() => (
          <>
          {rowGroups.map((group) => {
        const visual = roomVisualFor(group.rows[0]?.group ?? "default");
        const firstGroup = group.rows[0]?.group ?? "";
        const displayGroupLabel = en ? ({ control: "Control Center", trading: "Trading Posts", manufacture: "Factories", power: "Power Plants", dormitory: "Dormitories", meeting: "Reception Room", hire: "Office", processing: "Workshop", training: "Training Room", recycling: "Recycling Station" }[firstGroup] ?? (group.label === "功能设施" ? "Functional Facilities" : group.label)) : group.label;
        const groupStyle = {
          "--room-accent": visual.accent,
        } as CSSProperties;
        const collapsed = collapsedGroups[group.label];
        const auxiliary = AUXILIARY_ROOM_GROUPS.has(group.rows[0]?.group ?? "");
        const functionalPowerCount = group.rows.filter((row) => row.group === "power").length;
        if (hiddenGroups[group.label]) return null;

        return (
          <section
            key={group.label}
            className="min-w-0"
            aria-label={displayGroupLabel}
            style={groupStyle}
            data-list-room-group={firstGroup}
          >
            <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
              <button
                type="button"
                className="flex min-w-0 items-center gap-2.5 text-left max-sm:min-h-11"
                aria-expanded={!collapsed}
                onClick={() => setCollapsedGroups((current) => ({ ...current, [group.label]: !current[group.label] }))}
              >
                <span className="infra-room-accent h-7 w-1.5 shrink-0 bg-[var(--room-accent)]" aria-hidden="true" />
                <h3 className="truncate text-[21px] font-medium leading-none text-[#313131]">{displayGroupLabel}</h3>
                <span className="font-number text-xs text-[#313131]/56">{group.rows.length}</span>
                <motion.span
                  className="flex size-4 shrink-0 items-center justify-center text-[#313131]/45"
                  animate={{ rotate: collapsed ? -90 : 0 }}
                  transition={{ duration: MOTION_DURATION.fast, ease: MOTION_EASE_IN_OUT }}
                  aria-hidden="true"
                >
                  <ChevronDown className="size-4" />
                </motion.span>
              </button>
              {auxiliary && collapsed ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-muted-foreground"
                  onClick={() => setHiddenGroups((current) => ({ ...current, [group.label]: true }))}
                >
                  {intl("components.hide")}
                </Button>
              ) : null}
            </div>
            <div
              className={cn(
                "grid min-w-0 gap-3 pb-2 max-sm:gap-4 max-sm:pb-4",
                group.label === "功能设施" && listFunctionalFacilityGridClass(),
                group.rows[0]?.group === "manufacture" && "min-[1800px]:grid-cols-2",
                collapsed && "hidden"
              )}
            >
              {group.rows.map((row) => {
                const layoutRoom = layout.rooms.find((room) => room.id === row.roomId);
                const rowVisual = roomVisualFor(row.group);
                const efficiency = presentRoomEfficiency(row.group, row.efficiency, locale);
                const compactInlineRoom = isListFunctionalFacilityRoom(row.group);
                const narrowLeftPanel = listRoomUsesAlignedOperatorOrigin(row.group);
                const compactFactoryRoom = row.group === "manufacture";
                const functionalOperatorPosition = listFunctionalOperatorPosition(row.group);
                const functionalOperatorPlacementClass = listFunctionalOperatorPlacementClass(row.group);
                const slotCount = compactInlineRoom
                  ? (row.group === "meeting" || row.group === "training" || row.group === "recycling" ? 2 : 1)
                  : roomSlotCountFor(row.group);
                const slots: Array<{
                  slot: RoomRow["operatorSlots"][number] | undefined;
                  positionLabel?: string;
                }> = row.positionSlots
                  ? row.positionSlots.map(({ slot, positionLabel }) => ({ slot, positionLabel }))
                  : Array.from({ length: slotCount }, (_, index) => ({ slot: row.slotAssignments ? row.slotAssignments[index] : row.operatorSlots[index] }));
                const gridTone = roomGridTone(row.group);
                const rowStyle = {
                  "--room-accent": rowVisual.accent,
                  "--room-level": rowVisual.level,
                  "--room-grid-color": gridTone.color,
                  "--room-grid-opacity": gridTone.opacity,
                  "--room-grid-fade-start": gridTone.fadeStart,
                } as CSSProperties;

                return (
                  <div
                    key={row.key}
                    className={cn(
                      "infra-room-surface relative flex w-full overflow-hidden text-white max-[819px]:h-auto max-[819px]:flex-col",
                      listRoomHeightClass(row.group),
                      compactInlineRoom && "[container-type:inline-size]",
                      listFunctionalRoomSpanClass(row.group, functionalPowerCount),
                      row.suspicious && "ring-2 ring-destructive ring-offset-2",
                    )}
                    data-room-group={row.group}
                    data-room-title={row.title}
                    data-schedule-room={row.roomId}
                    style={rowStyle}
                  >
                    <div className={cn("relative w-[220px] shrink-0 overflow-hidden", compactInlineRoom && "w-[210px]", narrowLeftPanel && "w-[240px]", row.group === "meeting" && "w-[360px]", "max-[819px]:w-full")}>
                      <div
                        className="infra-room-emblem absolute inset-0 bg-left bg-no-repeat"
                        style={{
                          backgroundImage: `url(${rowVisual.background})`,
                          backgroundPosition: "-18px center",
                          backgroundSize: "auto 100%",
                        }}
                        aria-hidden="true"
                      />
                      <div className="relative z-10 flex h-full flex-col justify-center gap-2 px-3 py-3 max-sm:justify-start max-sm:gap-2 max-sm:px-3 max-sm:py-3">
                        <div className="flex flex-col gap-2 max-sm:flex-row max-sm:items-center">
                          <div>
                            <div className="flex items-center gap-2.5 max-sm:gap-1.5">
                              <div className={cn("font-number min-w-0 truncate font-medium tracking-[-0.02em] text-white [text-shadow:0_2px_3px_rgba(0,0,0,0.75)]", listRoomTitleSizeClass())}>
                                {localizedRoomTitle(row.title, row.group, locale, gameCatalog)}
                              </div>
                              <LevelDiamonds level={row.level} maxLevel={layoutRoom ? maxRoomLevel(layoutRoom.kind) : row.level} />
                              {onSortToggle && (row.group === "trading" || row.group === "manufacture") ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-pressed={sortRoomId === row.roomId}
                                  aria-label={sortRoomId === row.roomId ? "退出调整顺序" : "调整干员顺序"}
                                  className={cn(
                                    "h-7 w-7 border text-white hover:text-white",
                                    sortRoomId === row.roomId
                                      ? "border-[#FFD800]/70 bg-[#FFD800]/18"
                                      : "border-white/15 bg-[#3C3C3C]/55 hover:bg-[#4B4B4B]",
                                  )}
                                  onClick={() => onSortToggle(row)}
                                >
                                  <ArrowLeftRight className="size-3.5" />
                                </Button>
                              ) : null}
                              {renderListRoomActions?.(row, "header")}
                            </div>
                          </div>
                          {efficiency ? (
                            <div className="shrink-0">
                              <RoomEfficiencyReadout value={efficiency} details={false} trend={shiftDirection} />
                            </div>
                          ) : null}
                        </div>
                        {row.group === "recycling" ? <RecyclingRoomNotice editable={Boolean(onSlotClick)} /> : null}
                        {!simulation && <RoomProductControls
                          row={row}
                          layoutRoom={layoutRoom}
                          onFactoryRecipeChange={onFactoryRecipeChange}
                          onTradeOrderChange={onTradeOrderChange}
                        />}
                        {!simulation && !efficiency && (row.group === "trading" || row.group === "manufacture" || row.group === "power") ? (
                          <div className="font-technical text-xs tracking-[0.01em] text-white/38">
                            {intl("components_CompactScheduleView.awaitingSchedule")}
                          </div>
                        ) : null}
                        {renderListRoomActions?.(row, "secondary")}
                        {onManualSkillEfficiencyChange && row.group === "power" ? (
                          <label className="flex items-center gap-1 text-xs text-white/70">
                            <span>{intl("components.paperSkillEfficiency")}</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              pattern="[0-9]*[.,]?[0-9]*"
                              value={row.manualSkillEfficiencyPct ?? ""}
                              placeholder="0"
                              className="h-7 w-16 rounded border border-white/25 bg-black/25 px-1 text-right font-number text-xs text-white outline-none focus:border-[#FFD800]"
                              onChange={(event) => {
                                const raw = event.currentTarget.value;
                                onManualSkillEfficiencyChange(row, raw === "" ? null : Number(raw));
                              }}
                            />
                            <span>%</span>
                          </label>
                        ) : null}
                      </div>
                    </div>

                    <div
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-5 py-2 pl-2 pr-3 min-[820px]:h-full max-[819px]:flex-col max-[819px]:items-stretch max-[819px]:gap-3 max-[819px]:px-3 max-[819px]:pb-4 max-[819px]:pt-1",
                        compactInlineRoom && "justify-center pl-4 pr-8",
                      )}
                    >
                      <div
                        className={cn(
                          "infra-list-operator-grid grid min-w-0 items-center justify-start [column-gap:var(--operator-column-gap-desktop)] min-[820px]:h-full",
                          listMobileOperatorGridClass(),
                          compactInlineRoom ? "min-[820px]:flex-none" : "min-[820px]:flex-1 min-[820px]:grid-flow-col min-[820px]:auto-cols-max",
                            compactInlineRoom && (slotCount === 2 ? "grid-cols-2" : "grid-cols-1"),
                          functionalOperatorPlacementClass
                        )}
                        style={{
                          "--operator-column-gap-desktop": functionalOperatorPosition?.columnGap
                            ?? "clamp(0.75rem, 1.25vw, 1.25rem)",
                          ...(functionalOperatorPosition
                            ? { left: functionalOperatorPosition.left }
                            : {}),
                        } as CSSProperties}
                      >
                        {slots.map(({ slot, positionLabel }, index) => (
                          <OperatorSlot
                            key={`${row.key}-${index}`}
                            slot={slot}
                            elite={simulation ? undefined : slot ? eliteByOperator?.get(slot.name) : undefined}
                            currentMorale={slot && simulation ? Math.round((simulation.moods[slot.name] ?? 24) * 100) / 100 : undefined}
                            selectionMode={Boolean(simulation)}
                            operatorLevel={slot ? levelByOperator?.get(slot.name) : undefined}
                            autofill={row.group === "dormitory" && row.autofill}
                            compactFactory={compactFactoryRoom}
                            centerFrameInList
                            showSkillTooltip
                            shiftDirection={shiftDirection}
                            transitionDelay={Math.min(index, 2) * 0.02}
                            searchQuery={normalizedQuery}
                            positionLabel={positionLabel}
                            unavailable={row.unavailableSlotIndices?.includes(index)}
                            onActivate={simulation && slot ? () => simulation.onSelect(slot.name) : onSlotClick ? () => onSlotClick(row, index) : undefined}
                            sortSelected={simulation ? slot?.name === simulation.selected : sortSelection?.roomId === row.roomId && sortSelection.slotIndex === index}
                            onSortActivate={sortRoomId === row.roomId && onSortSlotClick ? () => onSortSlotClick(row, index) : undefined}
                            highlightNoLayoutSkill={highlightNoLayoutSkill && Boolean(slot) && noLayoutSkillOperators?.has(slot?.name ?? "")}
                          />
                        ))}
                      </div>
                      {compactInlineRoom ? null : (
                        <div className="w-[340px] shrink-0 max-[819px]:w-auto max-[819px]:min-w-0">
                          <RoomEfficiencyDetails value={efficiency} trend={shiftDirection} />
                          {onManualSkillEfficiencyChange && (row.group === "trading" || row.group === "manufacture") ? (
                            <label className="mt-2 flex items-center gap-1 text-xs text-white/70">
                              <span>{intl("components.paperSkillEfficiency")}</span>
                              <input
                                type="text"
                                inputMode="decimal"
                                pattern="[0-9]*[.,]?[0-9]*"
                                value={row.manualSkillEfficiencyPct ?? ""}
                                placeholder="0"
                                className="h-7 w-16 rounded border border-white/25 bg-black/25 px-1 text-right font-number text-xs text-white outline-none focus:border-[#FFD800]"
                                onChange={(event) => {
                                  const raw = event.currentTarget.value;
                                  onManualSkillEfficiencyChange(row, raw === "" ? null : Number(raw));
                                }}
                              />
                              <span>%</span>
                            </label>
                          ) : null}
                        </div>
                      )}
                    </div>

                    {renderListRoomActions?.(row, "clear")}

                    {onIssue ? <Tooltip>
                      <TooltipTrigger
                        render={
                          <span className={cn("absolute top-2 z-10", onClearRoom ? "right-24" : "right-2")}>
                          <Button
                            id={scheduleIssueTriggerId(row)}
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="border border-white/10 bg-[#3C3C3C]/55 text-white/70 hover:bg-[#4B4B4B] hover:text-white disabled:cursor-not-allowed disabled:opacity-45 max-sm:size-11"
                            aria-label={intl("components.reportScheduleIssue", { value1: (en) ? (localizedRoomTitle(row.title, row.group, locale, gameCatalog)) : "", title: (en) ? "" : (row.title) })}
                            disabled={feedbackDisabled}
                            onClick={() => onIssue(row)}
                          >
                            <FileWarning />
                          </Button>
                          </span>
                        }
                      />
                      <TooltipContent side="left">
                        {feedbackDisabled
                          ? intl("components.sampleDataCannotSubmitFeedback")
                          : intl("components.reportScheduleIssue2")}
                      </TooltipContent>
                    </Tooltip> : null}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
          </>

  ), [simulation, highlightNoLayoutSkill, noLayoutSkillOperators, rowGroups, en, layout, collapsedGroups, hiddenGroups, intl, locale, gameCatalog,
    onSortToggle, sortRoomId, renderListRoomActions, shiftDirection, onFactoryRecipeChange,
    onTradeOrderChange, eliteByOperator, levelByOperator, onSlotClick, sortSelection,
    onSortSlotClick, onIssue, feedbackDisabled, normalizedQuery, onClearRoom, onManualSkillEfficiencyChange]);

  const compactContent = useMemo(() => (
        <SkeletonSwap ready={Boolean(CompactScheduleView) || compactScheduleLoadFailed} skeleton={<CompactScheduleLoading rows={visibleRows} />}>
          {CompactScheduleView ? (
            <CompactScheduleView
              simulation={simulation}
              noLayoutSkillOperators={highlightNoLayoutSkill ? noLayoutSkillOperators : undefined}
              rows={visibleRows}
              layout={layout}
              eliteByOperator={eliteByOperator}
              levelByOperator={levelByOperator}
              activeShift={activeShift}
              activePlan={activePlan}
              shiftDirection={shiftDirection}
              onIssue={onIssue}
              feedbackDisabled={feedbackDisabled}
              hideImages={hideImages}
              onSlotClick={onSlotClick}
              sortRoomId={sortRoomId}
              sortSelection={sortSelection}
              onSortToggle={onSortToggle}
              onSortSlotClick={onSortSlotClick}
              onClearRoom={onClearRoom}
              onDormAutofillChange={onDormAutofillChange}
              droneTargetRoomId={droneTargetRoomId}
              onDroneTargetChange={onDroneTargetChange}
              onManualSkillEfficiencyChange={onManualSkillEfficiencyChange}
            />
          ) : compactScheduleLoadFailed ? (
            <div className="grid min-h-[420px] place-items-center border-y border-destructive/35 text-sm text-destructive" role="alert">
              {intl("components.overviewFailedToLoadSwitchToTheListView")}
            </div>
          ) : (
            null
          )}
        </SkeletonSwap>

  ), [simulation, highlightNoLayoutSkill, noLayoutSkillOperators, CompactScheduleView, visibleRows, layout, eliteByOperator, levelByOperator,
    activeShift, activePlan, shiftDirection, onIssue, feedbackDisabled, hideImages,
    onSlotClick, sortRoomId, sortSelection, onSortToggle, onSortSlotClick, onClearRoom,
    onDormAutofillChange, droneTargetRoomId, onDroneTargetChange, onManualSkillEfficiencyChange, compactScheduleLoadFailed, intl]);

  if (rows.length === 0) {
    return (
      <div className="flex min-h-[420px] items-center justify-center border-y border-dashed border-border/70 py-6 text-center text-sm text-muted-foreground">
        {intl("components.noRoomsToDisplay")}
      </div>
    );
  }

  function toggleAuxiliaryGroups() {
    if (allAuxiliaryCollapsed) {
      setCollapsedGroups((current) => {
        const next = { ...current };
        auxiliaryGroups.forEach((group) => {
          next[group.label] = false;
        });
        return next;
      });
      setHiddenGroups((current) => {
        const next = { ...current };
        auxiliaryGroups.forEach((group) => {
          next[group.label] = false;
        });
        return next;
      });
      return;
    }

    setCollapsedGroups((current) => {
      const next = { ...current };
      auxiliaryGroups.forEach((group) => {
        next[group.label] = true;
      });
      return next;
    });
  }

  function restoreHiddenAuxiliaryGroups() {
    setHiddenGroups((current) => {
      const next = { ...current };
      auxiliaryGroups.forEach((group) => {
        next[group.label] = false;
      });
      return next;
    });
  }

  return (
    <div ref={scheduleBoardRef} className="flex flex-col gap-7">
      <div className="flex flex-wrap items-center justify-between gap-3 max-sm:flex-col max-sm:items-stretch" data-schedule-toolbar>
        <div className="flex flex-wrap items-center gap-2 max-sm:w-full" data-schedule-view-controls>
          {supportsCompactLayout && viewMode && viewModeControl === "tabs" ? (
            <Tabs
              className="hidden lg:block"
              value={viewMode}
              onValueChange={(value) => { void changeViewMode(value as ScheduleViewMode); }}
            >
              <TabsList aria-label={intl("components.scheduleLayout")}>
                <TabsTrigger value="compact">{intl("components.overview")}</TabsTrigger>
                <TabsTrigger value="list">{intl("components.list")}</TabsTrigger>
              </TabsList>
            </Tabs>
          ) : null}
          {supportsCompactLayout && viewMode && viewModeControl === "select" ? (
            <label className="hidden items-center gap-2 lg:flex">
              <span className="sr-only">{intl("components.scheduleLayout")}</span>
              <select
                value={viewMode}
                onChange={(event) => { void changeViewMode(event.target.value as ScheduleViewMode); }}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={intl("components.scheduleLayout")}
              >
                <option value="compact">{intl("components.overview")}</option>
                <option value="list">{intl("components.list")}</option>
              </select>
            </label>
          ) : null}
          {shiftTabsSlot}
          {viewControlsSlot}
          {viewMode === "compact" ? viewModeActionSlot : null}
          {viewMode === "list" && hiddenAuxiliaryCount ? (
            <Button type="button" variant="ghost" size="sm" onClick={restoreHiddenAuxiliaryGroups}>
              {intl("components.restoreHidden")}{intl("components.label3")}<span className="font-number">{hiddenAuxiliaryCount}</span>{intl("components.label4")}
            </Button>
          ) : null}
          {viewMode === "list" && auxiliaryGroups.length ? (
            <div
              className="flex flex-wrap justify-end gap-2 max-md:grid max-md:w-full max-md:grid-cols-2 max-md:items-stretch max-md:[&>button]:h-auto max-md:[&>button]:min-h-11 max-md:[&>button]:min-w-0 max-md:[&>button]:whitespace-normal max-md:[&>button]:py-2 max-md:[&_[data-calculator-plan-actions=mobile]]:contents"
              data-schedule-auxiliary-actions
            >
              <Button type="button" variant="outline" size="sm" onClick={toggleAuxiliaryGroups}>
                <motion.span
                  className="flex size-4 items-center justify-center"
                  animate={{ rotate: allAuxiliaryCollapsed ? -90 : 0 }}
                  transition={{ duration: MOTION_DURATION.fast, ease: MOTION_EASE_IN_OUT }}
                  aria-hidden="true"
                >
                  <ChevronDown className="size-4" />
                </motion.span>
                {allAuxiliaryCollapsed ? (intl("components.expandAuxiliaryFacilities")) : (intl("components.collapseAuxiliaryFacilities"))}
              </Button>
              {viewModeActionSlot}
              {mobileActionsSlot ? <div className="min-w-0 flex-1 max-md:contents md:hidden">{mobileActionsSlot}</div> : null}
            </div>
          ) : (
            <>
              {viewMode === "list" ? viewModeActionSlot : null}
              {mobileActionsSlot ? <div className="w-full md:hidden">{mobileActionsSlot}</div> : null}
            </>
          )}
        </div>
        {shiftInfoSlot ? <div className="min-w-0 max-sm:w-full">{shiftInfoSlot}</div> : null}
      </div>
      <motion.div
        data-plan-board
        data-hide-images={hideImages ? "" : undefined}
        data-plan-revision={planRevision || undefined}
      >
            <motion.div
              initial={animateInitialView && !shouldReduceMotion ? {
                opacity: 0,
              } : false}
              animate={{ opacity: 1 }}
              transition={{
                duration: shouldReduceMotion ? 0 : MOTION_DURATION.content,
                ease: MOTION_EASE_OUT,
              }}
            >
        {viewMode && (viewMode === "list" || (supportsCompactLayout && prepareInactiveView)) ? (
          <CachedScheduleView key="list" mode="list" active={viewMode === "list"}>{listContent}</CachedScheduleView>
        ) : null}
        {supportsCompactLayout && (viewMode === "compact" || prepareInactiveView) ? (
          <CachedScheduleView key="compact" mode="compact" active={viewMode === "compact"}>{compactContent}</CachedScheduleView>
        ) : null}
        {!viewMode ? <div className="min-h-[420px]" data-schedule-view-pending aria-hidden="true" /> : null}
            </motion.div>
      </motion.div>
    </div>
  );
}

export function ShortcutGuideDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const intl = useTranslations();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 sm:max-w-2xl sm:p-6">
        <DialogHeader className="gap-1.5 px-1 sm:px-2">
          <DialogTitle className="text-xl font-semibold">{intl("components.keyboardShortcuts")}</DialogTitle>
          <DialogDescription className="max-w-lg text-sm leading-6">{intl("components.quicklyFocusSearchCloseTemporaryStatesOrToggleNavigation")}</DialogDescription>
        </DialogHeader>
        <div className="divide-y divide-border/70 border-y border-border/70 px-1 sm:px-2">
          <div className="flex min-h-14 items-center justify-between gap-8 py-3 max-sm:flex-wrap max-sm:gap-2">
            <span className="text-[15px] font-medium leading-6">{intl("components.focusScheduleSearch")}</span>
            <KbdGroup className="shrink-0" aria-label={intl("components.controlPlusK")}><Kbd>Ctrl</Kbd><span aria-hidden="true">+</span><Kbd>K</Kbd></KbdGroup>
          </div>
          <div className="flex min-h-14 items-center justify-between gap-8 py-3 max-sm:flex-wrap max-sm:gap-2">
            <span className="text-[15px] font-medium leading-6">{intl("components.clearSearchCancelAnActiveCalculation")}</span>
            <Kbd className="shrink-0">Esc</Kbd>
          </div>
          <div className="flex min-h-14 items-center justify-between gap-8 py-3 max-sm:flex-wrap max-sm:gap-2">
            <span className="text-[15px] font-medium leading-6">{intl("components.expandOrCollapseSidebar")}</span>
            <KbdGroup className="shrink-0" aria-label={intl("components.controlPlusB")}><Kbd>Ctrl</Kbd><span aria-hidden="true">+</span><Kbd>B</Kbd></KbdGroup>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
