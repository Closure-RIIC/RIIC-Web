"use client";
import { useTranslations, useLocale } from "next-intl";

import type { CSSProperties } from "react";
import { motion, useReducedMotion } from "motion/react";
import { MOTION_DURATION, MOTION_EASE_OUT } from "@/motion";
import { ArrowLeftRight, FileWarning, Trash2 } from "lucide-react";
import { DroneIcon } from "@/components/DroneIcon";
import { RecyclingRoomNotice } from "@/components/RecyclingRoomNotice";

import {
  factoryRecipeFor,
  maxRoomLevel,
  tradeOrderFor,
} from "@/blueprint";
import { AnimatedNumber, AnimatedText } from "@/components/AnimatedText";
import { LevelDiamonds, OperatorSlot, roomVisualFor } from "@/components";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { presentRoomEfficiency } from "@/efficiency";
import {
  COMPACT_CARD_CLASS,
  COMPACT_COLUMN_CLASS,
  COMPACT_DORM_OPERATOR_AREA_CLASS,
  COMPACT_DORM_WRAPPER_CLASS,
  COMPACT_GRID_CLASS,
  COMPACT_HEADER_CLASS,
  COMPACT_OPERATOR_ROW_CLASS,
  COMPACT_POWER_CARD_CLASS,
  COMPACT_POWER_OPERATOR_ROW_CLASS,
  COMPACT_ROOM_BACKGROUND_CLASS,
  COMPACT_ROOM_BACKGROUND_STYLE,
  COMPACT_ROOM_TITLE_CLASS,
  compactFactoryAccent,
  compactTradeAccent,
  roomGridTone,
} from "@/schedule-view-presentation";
import type { RoomRow } from "@/schedule";
import type { BaseBlueprint, MaaPlan } from "@/types";
import type { ShiftDirection } from "@/motion";
import { localizedRoomTitle } from "@/i18n/game-data";
import { useGameCatalog } from "@/i18n/game-data-client";

export interface CompactScheduleViewProps {
  simulation?: { moods: Readonly<Record<string, number>>; selected: string; onSelect: (name: string) => void };
  noLayoutSkillOperators?: ReadonlySet<string>;
  rows: RoomRow[];
  layout: BaseBlueprint;
  eliteByOperator?: ReadonlyMap<string, number>;
  levelByOperator?: ReadonlyMap<string, number>;
  activeShift: number;
  activePlan?: MaaPlan;
  shiftDirection: ShiftDirection;
  onIssue?: (row: RoomRow) => void;
  feedbackDisabled?: boolean;
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
  onManualSkillEfficiencyChange?: (row: RoomRow, value: number | null) => void;
}

/** 布局宽度百分比，自己改数值 */
const GRID_LEFT_PCT = 55;   // 左大列宽度%
const GRID_RIGHT_PCT = 45;  // 右大列宽度%
const COMPACT_AUXILIARY_GROUPS = new Set(["meeting", "training", "hire", "processing", "recycling"]);

function roomSlotCountFor(group: string) {
  if (group === "trading" || group === "manufacture") return 3;
  if (group === "meeting" || group === "training" || group === "recycling") return 2;
  if (group === "power" || group === "hire" || group === "processing") return 1;
  return 5;
}

function CompactRoomCard({
  simulation,
  noLayoutSkillOperators,
  row,
  layoutRoom,
  visual,
  efficiency,
  slots,
  eliteByOperator,
  levelByOperator,
  shiftDirection,
  onIssue,
  feedbackDisabled = false,
  horizontal,
  className = "",
  style,
  onSlotClick,
  sortMode,
  sortSelection,
  onSortToggle,
  onSortSlotClick,
  onClearRoom,
  onDormAutofillChange,
  droneTargetRoomId,
  onDroneTargetChange,
  onManualSkillEfficiencyChange,
}: {
  simulation?: CompactScheduleViewProps["simulation"];
  noLayoutSkillOperators?: ReadonlySet<string>;
  row: RoomRow;
  layoutRoom: BaseBlueprint["rooms"][number] | undefined;
  visual: ReturnType<typeof roomVisualFor>;
  efficiency: ReturnType<typeof presentRoomEfficiency>;
  slots: { slot: RoomRow["operatorSlots"][number] | undefined; positionLabel?: string }[];
  eliteByOperator?: ReadonlyMap<string, number>;
  levelByOperator?: ReadonlyMap<string, number>;
  shiftDirection: ShiftDirection;
  onIssue?: (row: RoomRow) => void;
  feedbackDisabled?: boolean;
  horizontal: boolean;
  className?: string;
  style?: CSSProperties;
  onSlotClick?: (row: RoomRow, slotIndex: number) => void;
  sortMode?: boolean;
  sortSelection?: { roomId: string; slotIndex: number } | null;
  onSortToggle?: (row: RoomRow) => void;
  onSortSlotClick?: (row: RoomRow, slotIndex: number) => void;
  onClearRoom?: (row: RoomRow) => void;
  onDormAutofillChange?: (row: RoomRow, enabled: boolean) => void;
  droneTargetRoomId?: string | null;
  onDroneTargetChange?: (row: RoomRow) => void;
  onManualSkillEfficiencyChange?: (row: RoomRow, value: number | null) => void;
}) {
  const intl = useTranslations();
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  const en = locale === "en";
  const isTrade = layoutRoom?.kind === "trade_post";
  const isFactory = layoutRoom?.kind === "factory";
  const isPower = row.group === "power";
  const gridTone = roomGridTone(row.group);
  const rowStyle = {
    "--room-accent": visual.accent,
    "--room-level": visual.level,
    "--room-grid-color": gridTone.color,
    "--room-grid-opacity": gridTone.opacity,
    "--room-grid-fade-start": gridTone.fadeStart,
  } as CSSProperties;

  const header = (
    <div className={COMPACT_HEADER_CLASS} data-compact-room-heading>
      <span className="infra-room-accent h-5 w-1 shrink-0 bg-[var(--room-accent)]" aria-hidden="true" />
      <span className={`${COMPACT_ROOM_TITLE_CLASS} font-number`}>{localizedRoomTitle(row.title, row.group, locale, gameCatalog)}</span>
      <LevelDiamonds
        level={row.level}
        maxLevel={layoutRoom ? maxRoomLevel(layoutRoom.kind) : row.level}
        variant="compact"
      />
      {row.group === "dormitory" && onDormAutofillChange ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={row.autofill}
          aria-label={`${localizedRoomTitle(row.title, row.group, locale, gameCatalog)}${intl("components.label")}${intl("components.autoFill")}`}
          className={`ml-1 h-7 border px-2 text-xs text-white hover:text-white ${row.autofill ? "border-[#FFD800]/70 bg-[#FFD800]/18 hover:bg-[#FFD800]/28" : "border-white/15 bg-[#3C3C3C]/55 hover:bg-[#4B4B4B]"}`}
      onClick={() => onDormAutofillChange(row, !row.autofill)}
        >
          {intl("components.autoFill")}
        </Button>
      ) : null}
      {(row.group === "trading" || row.group === "manufacture") && onSortToggle ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-pressed={sortMode}
          aria-label={sortMode ? "退出调整顺序" : "调整干员顺序"}
          className={`ml-1 h-7 w-7 border text-white hover:text-white ${sortMode ? "border-[#FFD800]/70 bg-[#FFD800]/18" : "border-white/15 bg-[#3C3C3C]/55 hover:bg-[#4B4B4B]"}`}
          onClick={() => onSortToggle(row)}
        >
          <ArrowLeftRight className="size-3.5" />
        </Button>
      ) : null}
        {isTrade ? (() => {
          const order = tradeOrderFor(layoutRoom!);
          const accent = compactTradeAccent(order);
          const label = order === "gold" ? intl("components_CompactScheduleView.lmdOrder") : order === "originium" ? intl("components_CompactScheduleView.originiumOrder") : order;
          return (
            <div data-compact-product-badge style={{ marginRight: onDroneTargetChange ? "5.5rem" : onClearRoom ? "2.75rem" : "2.25rem" }} className={`ml-auto flex h-7 shrink-0 items-center justify-center whitespace-nowrap rounded border px-2 text-xs ${en ? "w-[118px]" : "w-[90px]"} ${accent}`}>
              {label}
            </div>
          );
        })() : isFactory ? (() => {
          const recipe = factoryRecipeFor(layoutRoom!);
          const accent = compactFactoryAccent(recipe);
          const label = recipe === "all" ? intl("components_CompactScheduleView.auto") : recipe === "gold" ? intl("components_CompactScheduleView.pureGold") : recipe === "battle_record" ? intl("components_CompactScheduleView.battleRecord") : recipe === "originium" ? intl("components_CompactScheduleView.originiumShard") : recipe;
          return (
            <div data-compact-product-badge style={{ marginRight: onDroneTargetChange ? "5.5rem" : onClearRoom ? "2.75rem" : "2.25rem" }} className={`ml-auto flex h-7 shrink-0 items-center justify-center whitespace-nowrap rounded border px-2 text-xs ${en ? "w-[118px]" : "w-[90px]"} ${accent}`}>
              {label}
            </div>
          );
      })() : null}
    </div>
  );

  const efficiencyBlock = efficiency ? (
    <div>
      {isPower ? (
        <span className="infra-room-value font-technical text-sm font-semibold leading-4 tabular-nums text-[var(--room-accent)]" data-room-primary-efficiency>
          <AnimatedNumber value={efficiency.primaryValue} trend={shiftDirection} />
        </span>
      ) : row.group === "trading" || row.group === "manufacture" ? (
        <div className="font-technical flex flex-wrap items-center gap-x-1.5 text-xs tracking-[0.01em] text-white/76">
          <span className="infra-room-value font-semibold tabular-nums text-[var(--room-accent)]" data-room-primary-efficiency>
            <AnimatedNumber value={efficiency.primaryValue} trend={shiftDirection} />
          </span>
          {efficiency.details.map((detail, index) => (
            <span key={`${detail.label ?? ""}-${index}`} className={`font-number ${detail.kind === "cross-station" ? "text-[#C8F75A]" : ""}`}>
              {efficiency.formula ? <>{detail.operator ? `${detail.operator} ` : ""}<AnimatedText value={detail.value} trend={shiftDirection} /> {detail.label}</> : <>/ {detail.label} <AnimatedText value={detail.value} trend={shiftDirection} /></>}
            </span>
          ))}
        </div>
      ) : (
        <span className="font-technical text-sm tabular-nums text-white/66" data-room-primary-efficiency>
          <AnimatedNumber value={efficiency.primaryValue} trend={shiftDirection} />
        </span>
      )}
    </div>
  ) : null;
  const productionRoom = isTrade || isFactory || isPower;
  const emptyWorkstationState = !efficiency && productionRoom ? (
    <div className="font-technical text-xs tracking-[0.01em] text-white/38">
      {intl("components_CompactScheduleView.awaitingSchedule")}
    </div>
  ) : null;
  const paperSkillInput = productionRoom && onManualSkillEfficiencyChange ? (
    <label className="mt-1 flex items-center gap-1 text-[10px] text-white/58">
      <span>{intl("components.paperSkillEfficiency")}</span>
      <input
        type="text"
        inputMode="decimal"
        pattern="[0-9]*[.,]?[0-9]*"
        value={row.manualSkillEfficiencyPct ?? ""}
        placeholder="0"
        className="h-5 w-14 rounded border border-white/20 bg-black/25 px-1 text-right font-number text-xs text-white outline-none focus:border-[#FFD800]"
        onChange={(event) => {
          const raw = event.currentTarget.value;
          onManualSkillEfficiencyChange(row, raw === "" ? null : Number(raw));
        }}
      />
      <span>%</span>
    </label>
  ) : null;
  const efficiencyContent = efficiencyBlock ?? emptyWorkstationState;

  const operators = slots.map(({ slot, positionLabel }, index) => (
    <OperatorSlot
      key={`${row.key}-${index}`}
      slot={slot}
      highlightNoLayoutSkill={Boolean(slot && noLayoutSkillOperators?.has(slot.name))}
      elite={simulation ? undefined : slot ? eliteByOperator?.get(slot.name) : undefined}
      currentMorale={slot && simulation ? Math.round((simulation.moods[slot.name] ?? 24) * 100) / 100 : undefined}
      selectionMode={Boolean(simulation)}
      operatorLevel={slot ? levelByOperator?.get(slot.name) : undefined}
      autofill={row.group === "dormitory" && row.autofill}
      compactView
      showSkillTooltip
      shiftDirection={shiftDirection}
      transitionDelay={Math.min(index, 2) * 0.02}
      positionLabel={positionLabel}
      unavailable={row.unavailableSlotIndices?.includes(index)}
      onActivate={simulation && slot ? () => simulation.onSelect(slot.name) : onSlotClick ? () => onSlotClick(row, index) : undefined}
      sortSelected={simulation ? slot?.name === simulation.selected : sortSelection?.roomId === row.roomId && sortSelection.slotIndex === index}
      onSortActivate={sortMode && onSortSlotClick ? () => onSortSlotClick(row, index) : undefined}
    />
  ));

  const backgroundLayers = (
    <>
      <div
        className={COMPACT_ROOM_BACKGROUND_CLASS}
        style={{
          ...COMPACT_ROOM_BACKGROUND_STYLE,
          backgroundImage: `url(${visual.background})`,
        }}
        aria-hidden="true"
      />
    </>
  );
  const details = (
    <div className="relative z-10 min-w-0">
      {header}
      {row.group === "recycling" ? <RecyclingRoomNotice editable={Boolean(onSlotClick)} /> : null}
      {efficiencyContent ? <div className={isPower && efficiency ? "mt-1" : "mt-2"}>{efficiencyContent}</div> : null}
      {paperSkillInput}
    </div>
  );

  if (horizontal) {
    const operatorArea = (
      <div className={`relative z-10 ${COMPACT_POWER_OPERATOR_ROW_CLASS}`}>
        {operators}
      </div>
    );
    return (
      <div
        className={`${COMPACT_POWER_CARD_CLASS} ${className}`}
        data-room-group={row.group}
        data-room-title={row.title}
        data-schedule-room={row.roomId}
        style={{ ...rowStyle, ...style }}
      >
        {backgroundLayers}
        {onDroneTargetChange && (isTrade || isFactory) ? <CompactDroneButton row={row} selected={droneTargetRoomId === row.roomId} besideClear={Boolean(onClearRoom)} onChange={onDroneTargetChange} /> : null}
        {onClearRoom ? <CompactClearButton row={row} onClear={onClearRoom} /> : null}
        {onIssue ? <CompactFeedbackButton row={row} disabled={feedbackDisabled} offset={Boolean(onClearRoom)} onIssue={onIssue} /> : null}
        {details}
        {operatorArea}
      </div>
    );
  }

  return (
    <div
      className={`${COMPACT_CARD_CLASS} ${className}`}
      data-room-group={row.group}
      data-room-title={row.title}
      data-schedule-room={row.roomId}
      style={{ ...rowStyle, ...style }}
    >
      {backgroundLayers}
      {onDroneTargetChange && (isTrade || isFactory) ? <CompactDroneButton row={row} selected={droneTargetRoomId === row.roomId} besideClear={Boolean(onClearRoom)} onChange={onDroneTargetChange} /> : null}
      {onClearRoom ? <CompactClearButton row={row} onClear={onClearRoom} /> : null}
      {onIssue ? <CompactFeedbackButton row={row} disabled={feedbackDisabled} offset={Boolean(onClearRoom)} onIssue={onIssue} /> : null}
      {details}
      <div
        className={`relative z-10 ${
          row.group === "dormitory" ? COMPACT_DORM_OPERATOR_AREA_CLASS : ""
        }`}
      >
        <div className={COMPACT_OPERATOR_ROW_CLASS}>{operators}</div>
      </div>
    </div>
  );
}

function CompactDroneButton({ row, selected, besideClear, onChange }: { row: RoomRow; selected: boolean; besideClear: boolean; onChange: (row: RoomRow) => void }) {
  const intl = useTranslations();
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  const reducedMotion = useReducedMotion();

  const roomTitle = localizedRoomTitle(row.title, row.group, locale, gameCatalog);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <motion.span
            className={`absolute top-2 z-20 origin-right ${besideClear ? "right-11" : "right-10"}`}
            data-drone-control
            initial={reducedMotion ? false : { opacity: 0, scale: 0.85, x: 6 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            transition={{ duration: reducedMotion ? 0 : MOTION_DURATION.state, ease: MOTION_EASE_OUT }}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={selected}
              aria-label={intl("components_CompactScheduleView.droneAcceleration", { roomTitle })}
              className={`h-7 border px-2 text-xs text-purple-200 hover:text-purple-100 focus-visible:border-purple-400 focus-visible:ring-purple-400/40 ${selected ? "border-purple-400/70 bg-purple-400/18 hover:bg-purple-400/28" : "border-white/10 bg-[#3C3C3C]/55 hover:bg-[#4B4B4B]"}`}
              onClick={() => onChange(row)}
            >
              <DroneIcon className="size-3.5 drop-shadow-[0_0_2px_#c084fc]" />
              <span className="sm:hidden">{intl("components_CompactScheduleView.drones")}</span>
            </Button>
          </motion.span>
        }
      />
      <TooltipContent side="left">{selected ? intl("components_CompactScheduleView.disableDroneAcceleration") : intl("components_CompactScheduleView.useDronesForShift")}</TooltipContent>
    </Tooltip>
  );
}

function CompactClearButton({ row, onClear }: { row: RoomRow; onClear: (row: RoomRow) => void }) {
  const intl = useTranslations();
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  const roomTitle = localizedRoomTitle(row.title, row.group, locale, gameCatalog);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="absolute right-2 top-2 z-20">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-7 border border-red-400/30 bg-red-950/70 px-2 text-xs text-red-200 hover:bg-red-900/80 hover:text-red-100"
              aria-label={intl("components_CompactScheduleView.clearRoom", { roomTitle })}
              onClick={() => onClear(row)}
            >
              <Trash2 className="size-3.5" /><span className="sm:hidden">{intl("components_CompactScheduleView.clear")}</span>
            </Button>
          </span>
        }
      />
      <TooltipContent side="left">{intl("components_CompactScheduleView.clearThisFacility")}</TooltipContent>
    </Tooltip>
  );
}

function CompactFeedbackButton({ row, disabled, offset, onIssue }: { row: RoomRow; disabled: boolean; offset: boolean; onIssue: (row: RoomRow) => void }) {
  const intl = useTranslations();
  const locale = useLocale();
  const gameCatalog = useGameCatalog();

  const roomTitle = localizedRoomTitle(row.title, row.group, locale, gameCatalog);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className={`absolute top-2 z-20 ${offset ? "right-24" : "right-2"}`}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="border border-white/10 bg-[#3C3C3C]/55 text-white/70 hover:bg-[#4B4B4B] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
              aria-label={intl("components_CompactScheduleView.reportScheduleIssue", { roomTitle: roomTitle })}
              disabled={disabled}
              onClick={() => onIssue(row)}
            >
              <FileWarning />
            </Button>
          </span>
        }
      />
      <TooltipContent side="left">{disabled ? (intl("components_CompactScheduleView.sampleBoxDataCannotSubmitFeedback")) : (intl("components_CompactScheduleView.reportScheduleIssue2"))}</TooltipContent>
    </Tooltip>
  );
}

export function CompactScheduleView(props: CompactScheduleViewProps) {
  const intl = useTranslations();
  const locale = useLocale();
  const { rows, layout, eliteByOperator, levelByOperator, shiftDirection, onIssue, feedbackDisabled = false, hideImages = false, onSlotClick, sortRoomId, sortSelection, onSortToggle, onSortSlotClick, onClearRoom, onDormAutofillChange, droneTargetRoomId, onDroneTargetChange, onManualSkillEfficiencyChange } = props;

  if (rows.length === 0) {
    return (
      <div className="flex min-h-[420px] items-center justify-center border-y border-dashed border-border/70 py-6 text-center text-sm text-muted-foreground">
        {intl("components_CompactScheduleView.noLayoutRoomsToDisplay")}
      </div>
    );
  }

  const byGroup = new Map<string, RoomRow[]>();
  for (const row of rows) {
    if (!row.group) continue;
    const list = byGroup.get(row.group) ?? [];
    list.push(row);
    byGroup.set(row.group, list);
  }
  const getGroup = (group: string) => byGroup.get(group) ?? [];

  const workstations = [...getGroup("trading"), ...getGroup("manufacture")];
  const power = getGroup("power");
  const dorms = getGroup("dormitory");
  const powerCount = power.length;
  const overflowProductionRooms = [
    ...workstations.slice(powerCount === 3 ? 6 : 7),
    ...power.slice(powerCount === 3 ? 3 : 2),
  ];
  const layoutRooms = new Map(layout.rooms.map((room) => [room.id, room]));

  function makeCard(row: RoomRow, widthPercent?: number) {
    const layoutRoom = layoutRooms.get(row.roomId);
    const visual = roomVisualFor(row.group);
    const efficiency = presentRoomEfficiency(row.group, row.efficiency, locale);
    const slotCount = roomSlotCountFor(row.group);
    const slots = row.positionSlots
      ? row.positionSlots.map(({ slot, positionLabel }) => ({ slot, positionLabel }))
      : Array.from({ length: slotCount }, (_, i) => ({ slot: row.slotAssignments ? row.slotAssignments[i] : row.operatorSlots[i] }));
    return (
      <CompactRoomCard
        simulation={props.simulation}
        noLayoutSkillOperators={props.noLayoutSkillOperators}
        key={row.key}
        row={row}
        layoutRoom={layoutRoom!}
        visual={visual}
        efficiency={efficiency}
        slots={slots}
        eliteByOperator={eliteByOperator}
        levelByOperator={levelByOperator}
        shiftDirection={shiftDirection}
        onIssue={onIssue}
        feedbackDisabled={feedbackDisabled}
        onSlotClick={onSlotClick}
        sortMode={sortRoomId === row.roomId}
        sortSelection={sortSelection}
        onSortToggle={onSortToggle}
        onSortSlotClick={onSortSlotClick}
        onClearRoom={onClearRoom}
        onDormAutofillChange={onDormAutofillChange}
        droneTargetRoomId={droneTargetRoomId}
        onDroneTargetChange={onDroneTargetChange}
        onManualSkillEfficiencyChange={onManualSkillEfficiencyChange}
        horizontal={COMPACT_AUXILIARY_GROUPS.has(row.group)}
        className="min-w-0"
        style={widthPercent !== undefined ? { flexBasis: `${widthPercent}%` } : { flex: 1 }}
      />
    );
  }

  const ctrl = getGroup("control")[0];
  const meeting = getGroup("meeting")[0];
  const training = getGroup("training")[0];
  const recycling = getGroup("recycling")[0];
  const office = getGroup("hire")[0];
  const processing = getGroup("processing")[0];

  return (
    <div className={COMPACT_GRID_CLASS} data-compact-schedule-view data-hide-images={hideImages ? "" : undefined}>
      <div
        className={COMPACT_COLUMN_CLASS}
        style={{ flexBasis: `${GRID_LEFT_PCT}%` }}
      >
        <div>{ctrl && makeCard(ctrl)}</div>

        {[0, 2, 4].map((start) => (
          <div key={start} className="flex flex-1 justify-between gap-3">
            {workstations[start] && makeCard(workstations[start], 50)}
            {workstations[start + 1] && makeCard(workstations[start + 1], 50)}
          </div>
        ))}

        {powerCount === 3 ? (
          <div className="flex items-start justify-between gap-3">
            {power.slice(0, 3).map((powerRoom) => makeCard(powerRoom, 33))}
          </div>
        ) : (
          <div className="flex justify-between gap-3">
            <div className="flex justify-between gap-3" style={{ flexBasis: "50%" }}>
              {power[0] && makeCard(power[0])}
              {power[1] && makeCard(power[1])}
            </div>
            {workstations[6] && makeCard(workstations[6], 50)}
          </div>
        )}
        {overflowProductionRooms.length > 0 ? (
          <div className="grid grid-cols-2 gap-3">
            {overflowProductionRooms.map((row) => makeCard(row))}
          </div>
        ) : null}
      </div>

      <div
        className={COMPACT_COLUMN_CLASS}
        style={{ flexBasis: `${GRID_RIGHT_PCT}%` }}
      >
        <div className="compact-auxiliary-container min-w-0">
          <div className="compact-auxiliary-grid">
            {meeting && makeCard(meeting)}
            {training && makeCard(training)}
            {recycling && makeCard(recycling)}
            {office && makeCard(office)}
            {processing && makeCard(processing)}
          </div>
        </div>

        {dorms.slice(0, 4).map((dorm) => (
          <div key={dorm.key} className={COMPACT_DORM_WRAPPER_CLASS}>
            {makeCard(dorm)}
          </div>
        ))}
      </div>
    </div>
  );
}
