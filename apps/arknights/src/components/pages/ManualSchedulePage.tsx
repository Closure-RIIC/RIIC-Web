"use client";
import { useTranslations, useLocale } from "use-intl";

import { ArrowLeft, Download, Ellipsis, Search, Settings2, Sparkles, Trash2, Upload, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

import type { FactoryRecipe, TradeOrder } from "@/blueprint";
import { filterOperators, ROOM_SKILL_TAGS, type BuildingRoomPrefix } from "@/building-rooms";
import { OperatorSlot, ScheduleBoard, ShiftTabs } from "@/components";
import { FiammettaTargetChip } from "@/components/FiammettaTargetChip";
import { DroneTargetPicker } from "@/components/DroneTargetPicker";
import { FileUploadDialog } from "@/components/FileUploadDialog";
import { ManualProductionSummary } from "@/components/ManualProductionSummary";
import { PlanSupportSummary } from "@/components/PlanSupportSummary";
import { ManualScheduleRoomActions } from "@/components/ManualScheduleRoomActions";
import type { MoodBoardState } from "@/components/manual-mood/MoodSimulationPanel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonSuspense } from "@/components/ui/skeleton-swap";
import { TooltipProvider } from "@/components/ui/tooltip";
import { downloadJson } from "@/download";
import type { SchedulePosterDocument } from "@/schedule-poster-document";
import type { PosterTarget } from "@/components/schedule-poster/SchedulePoster";
import { droneStoragePlanIndex } from "@/drone-plan-mapping";
import type { ManualPlanResult } from "@/manual-plan-result";
import { buildManualScheduleContext, type AgentPageContext } from "@/agent-page-context";
import { loadManualEvaluationCache } from "@/manual-evaluation-cache";
import { localizedOperatorName, localizedRoomTitle } from "@/i18n/game-data";
import { useGameCatalog } from "@/i18n/game-data-client";
import { prepareMaaForExport } from "@/maa-safety";
import { maaToMowerPlan, mowerPlanToMaa } from "@/mower-plan";
import {
  assignManualOperator,
  clearManualRoom,
  clearManualShift,
  createManualScheduleDraft,
  createManualScheduleDraftFromCalculator,
  formatManualShiftDuration,
  layoutFromMaaSchedule,
  loadManualScheduleDraft,
  manualShiftTimeRanges,
  manualScheduleToMaa,
  manualRoomCapacity,
  normalizeMaaScheduleForManualImport,
  parseMaaScheduleText,
  persistManualScheduleDraft,
  reconcileManualScheduleDraft,
  resizeManualScheduleDraft,
  restPreviousShiftOperators,
  setManualDormAutofill,
  setManualDroneTarget,
  setManualRoomSkillEfficiency,
  setManualRoomProduct,
  swapManualOperators,
  type ManualOperatorConflict,
  type ManualScheduleDraft,
  type ManualScheduleMode,
} from "@/manual-schedule";
import { BUILDING_SKILL_CATALOG, OPERATOR_CATALOG, operatorPortraitFor, operatorPresentationFor } from "@/operatorPortraits";
import { addOperatorPresentations } from "@/schedule-presentation";
import { planToRows, type RoomRow } from "@/schedule";
import { manualEditableRooms, withRecyclingRoom } from "@/recycling-room";
import type { BaseBlueprint, MaaJson, MaaOperatorSlot, MaaRoom, OperBoxEntry } from "@/types";
import { DEFAULT_MANUAL_SHIFT_START_TIME } from "@/manual-schedule-config";

const ScrollArea = lazy(() => import("@/components/ui/scroll-area").then((module) => ({ default: module.ScrollArea })));
const PosterWorkbench = lazy(() => import("@/components/schedule-poster/PosterWorkbench"));
const MoodSimulationPanel = lazy(() => import("@/components/manual-mood/MoodSimulationPanel"));
const OperatorRarityFilter = lazy(() => import("@/components/operators/OperatorPickerParts").then(module => ({ default: module.OperatorRarityFilter })));
const OperatorSearch = lazy(() => import("@/components/operators/OperatorPickerParts").then(module => ({ default: module.OperatorSearch })));
const Pagination = lazy(() => import("@/components/skill-query/Pagination").then(module => ({ default: module.Pagination })));
const SkillFilterRow = lazy(() => import("@/components/skill-query/SkillFilterRow").then(module => ({ default: module.SkillFilterRow })));
const SkillRoomTagBar = lazy(() => import("@/components/skill-query/SkillRoomTagBar").then(module => ({ default: module.SkillRoomTagBar })));
const SkillTagBar = lazy(() => import("@/components/skill-query/SkillTagBar").then(module => ({ default: module.SkillTagBar })));
const MaaImportDialog = lazy(() => import("@/components/MaaImportDialog").then(module => ({ default: module.MaaImportDialog })));
const MANUAL_PICKER_PAGE_SIZE = 24;
const ROOM_GROUP_TO_SKILL_PREFIX: Readonly<Partial<Record<RoomRow["group"], BuildingRoomPrefix>>> = {
  control: "control",
  power: "power",
  manufacture: "manu",
  trading: "trade",
  dormitory: "dorm",
  hire: "hire",
  meeting: "meet",
  training: "train",
  processing: "workshop",
};
const OPERATOR_CATALOG_BY_ID = new Map(OPERATOR_CATALOG.map((operator) => [operator.id, operator]));
const OPERATOR_CATALOG_BY_NAME = new Map(OPERATOR_CATALOG.map((operator) => [operator.name, operator]));

export interface ManualSchedulePageProps {
  /** Development showcases can use the real editor without touching saved drafts. */
  persistDraft?: boolean;
  initialPosterDocument?: SchedulePosterDocument | null;
  onImportPoster?: (document: SchedulePosterDocument) => void;
  onPosterWorkingBoxChange?: (operators: OperBoxEntry[]) => void;
  layout: BaseBlueprint;
  operbox: OperBoxEntry[] | null;
  sourceName: string | null;
  shiftDurations: number[];
  shiftStartTime: string;
  scheduleMode: ManualScheduleMode;
  fiammettaEnabled: boolean;
  initialDraft: ManualScheduleDraft | null;
  restorationReady: boolean;
  onInitialDraftConsumed: () => void;
  result: ManualPlanResult | null;
  onAgentContextChange?: (context: AgentPageContext | null) => void;
  evaluationPending: boolean;
  onEvaluate: (input: { draft: ManualScheduleDraft; operbox?: OperBoxEntry[] }) => Promise<void>;
  onPaperEvaluate: (input: { draft: ManualScheduleDraft; operbox?: OperBoxEntry[] }) => Promise<void>;
  onRestoreEvaluation: (result: ManualPlanResult) => void;
  onOpenCalculator: () => void;
  onShiftDurationsChange: (durations: number[]) => void;
  onShiftStartTimeChange: (startTime: string) => void;
  onScheduleModeChange: (mode: ManualScheduleMode) => void;
  onImportedLayoutChange: (layout: BaseBlueprint) => void;
  onFiammettaEnabledChange: (enabled: boolean) => void;
  onOpenSetup: () => void;
  onDraftChange?: (draft: ManualScheduleDraft) => void;
  manualProductChangeRequest?: { shiftIndex: number; roomId: string; product: import("@/types").RoomProduct; token: number } | null;
  onManualProductChangeRequestConsumed?: (token: number) => void;
  strictMaaOperatorOrder: boolean;
  allowReplacementOperatorSort: boolean;
  scheduleViewControl?: "tabs" | "select";
  shiftViewControl?: "tabs" | "select";
  showImages?: boolean;
  showMower?: boolean;
  recyclingRoomLevel?: number;
}

type PickerTarget =
  | { kind: "slot"; roomId: string; slotIndex: number }
  | { kind: "poster-hanger"; shift: number }
  | { kind: "fiammetta" };

type PendingMove = {
  operator: string;
  target: Extract<PickerTarget, { kind: "slot" }>;
  conflict: ManualOperatorConflict;
};

type PosterHelpers = {
  defaultPosterOperator: (name: string) => OperBoxEntry | undefined;
  posterOperators: (document: SchedulePosterDocument) => OperBoxEntry[];
};


type MaaImportPreview = {
  format: "maa" | "mower";
  fileName: string;
  draft: ManualScheduleDraft;
  layout: BaseBlueprint;
  sourceShiftCount: number;
  importedShiftCount: number;
  sourceAssignmentCount: number;
  importedAssignmentCount: number;
};

function countDraftAssignments(draft: ManualScheduleDraft): number {
  return draft.shifts.reduce((total, shift) => total + Object.values(shift.rooms).reduce(
    (roomTotal, room) => roomTotal + room.operators.filter(Boolean).length,
    0,
  ), 0);
}

function countMaaAssignments(maa: MaaJson): number {
  return maa.plans.reduce((total, plan) => total + Object.values(plan.rooms).reduce(
    (roomTotal, rooms) => roomTotal + ((rooms ?? []) as MaaRoom[]).reduce(
      (groupTotal: number, room: MaaRoom) => groupTotal + (room.operators ?? []).filter((operator: string | MaaOperatorSlot | null) => (
        typeof operator === "string" ? operator.trim().length > 0 : Boolean(operator?.name?.trim())
      )).length,
      0,
    ),
    0,
  ), 0);
}

function ManualOperatorChoice({
  operator,
  selected,
  selectionNumber,
  assignmentLabel,
  en,
  tooltipDisabled,
  onChoose,
}: {
  operator: OperBoxEntry;
  selected: boolean;
  selectionNumber?: number;
  assignmentLabel?: string;
  en: boolean;
  tooltipDisabled: boolean;
  onChoose: () => void;
}) {
  const intl = useTranslations();
  const gameCatalog = useGameCatalog();
  const displayName = localizedOperatorName(operator.name, en ? "en" : "zh", gameCatalog);
  const presentation = operatorPresentationFor({ name: operator.name, id: operator.id });
  return (
    <div
      className={`relative flex min-h-[calc(var(--manual-picker-portrait-size)+2.5rem)] flex-col items-center justify-start rounded-[4px] py-1 transition-colors hover:bg-muted/45 [&_.infra-operator-slot]:[--operator-slot-size:var(--manual-picker-portrait-size)] ${selected ? "bg-[#FFD800]/12 ring-2 ring-[#FFD800] ring-offset-1 ring-offset-background" : ""}`}
      data-manual-operator-choice
      data-current-selection={selected ? "" : undefined}
      onDragStart={(event) => event.preventDefault()}
    >
      <span className={`mb-1 block h-4 max-w-full truncate text-center text-[11px] font-medium leading-4 ${assignmentLabel ? "text-popover-foreground" : "invisible"}`}>
        {assignmentLabel ?? intl("components_pages_ManualSchedulePage.unassigned")}
      </span>
      <div className="relative">
        <OperatorSlot
          slot={{
            name: operator.name,
            label: displayName,
            portrait: presentation.portrait,
            profession: presentation.operator?.profession,
          }}
          elite={operator.elite}
          operatorLevel={operator.level}
          showSkillTooltip
          selectionMode
          tooltipDisabled={tooltipDisabled}
          onActivate={onChoose}
        />
        {selectionNumber ? <span data-selection-number className="pointer-events-none absolute right-0 top-0 z-10 grid size-5 place-items-center rounded-full bg-[#FFD800] text-[11px] font-bold text-[#313131] shadow-sm">{selectionNumber}</span> : null}
      </div>
    </div>
  );
}

export function ManualSchedulePage({
  persistDraft = true,
  initialPosterDocument,
  onImportPoster,
  onPosterWorkingBoxChange,
  layout,
  operbox: sourceOperbox,
  sourceName,
  shiftDurations,
  shiftStartTime,
  scheduleMode,
  fiammettaEnabled,
  initialDraft,
  restorationReady,
  onInitialDraftConsumed,
  result: suppliedResult,
  onAgentContextChange,
  evaluationPending,
  onEvaluate,
  onPaperEvaluate,
  onRestoreEvaluation,
  onOpenCalculator,
  onShiftDurationsChange,
  onShiftStartTimeChange,
  onScheduleModeChange,
  onImportedLayoutChange,
  onFiammettaEnabledChange,
  onOpenSetup,
  onDraftChange,
  manualProductChangeRequest,
  onManualProductChangeRequestConsumed,
  strictMaaOperatorOrder,
  allowReplacementOperatorSort,
  scheduleViewControl = "tabs",
  shiftViewControl = "tabs",
  showImages = true,
  showMower = false,
  recyclingRoomLevel = 3,
}: ManualSchedulePageProps) {
  const intl = useTranslations();
  const skillFilters = useTranslations("SkillFilters");
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  const en = locale === "en";
  const [draft, setDraft] = useState<ManualScheduleDraft>(() => createManualScheduleDraft(shiftDurations, shiftStartTime, scheduleMode));
  useEffect(() => { onDraftChange?.(draft); }, [draft, onDraftChange]);
  useEffect(() => {
    const request = manualProductChangeRequest;
    if (!request) return;
    setDraft((current) => setManualRoomProduct(current, layout, request.shiftIndex, request.roomId, request.product));
    onManualProductChangeRequestConsumed?.(request.token);
  }, [layout, manualProductChangeRequest, onManualProductChangeRequestConsumed]);
  const [posterSettings, setPosterSettings] = useState<SchedulePosterDocument | null>(initialPosterDocument ?? null);
  const posterInitialization = useRef<Promise<void> | null>(null);
  const [posterHelpers, setPosterHelpers] = useState<PosterHelpers | null>(null);
  const [view, setView] = useState("edit");
  const [posterVisited, setPosterVisited] = useState(Boolean(initialPosterDocument));
  const [evaluatedKey, setEvaluatedKey] = useState("");
  const [calculationError, setCalculationError] = useState("");
  const assignedNamesKey = JSON.stringify([...new Set(draft.shifts.flatMap(shift => Object.values(shift.rooms).flatMap(room => room.operators)).filter(Boolean))]);
  const posterOperatorsKey = JSON.stringify(posterSettings?.operators ?? []);
  const operbox = useMemo(() => {
    const entries = new Map((sourceOperbox ?? []).map(operator => [operator.name, operator]));
    const names = new Set<string>(JSON.parse(assignedNamesKey));
    if (draft.fiammettaEnabled) names.add("菲亚梅塔");
    for (const name of names) {
      if (!name || entries.get(name)?.own) continue;
      const operator = (JSON.parse(posterOperatorsKey) as OperBoxEntry[]).find(item => item.name === name) ?? posterHelpers?.defaultPosterOperator(name);
      if (operator) entries.set(name, { ...operator, own: true });
    }
    return [...entries.values()];
  }, [sourceOperbox, posterOperatorsKey, assignedNamesKey, draft.fiammettaEnabled, posterHelpers]);
  const evaluationKey = JSON.stringify([layout, { ...draft, activeShift: 0, startTime: "00:00" }, operbox, posterSettings?.efficiencyMode ?? "native"]);
  const result = evaluatedKey === evaluationKey ? suppliedResult : null;
  const posterDocument = useMemo(() => {
    if (!posterSettings) return null;
    const names = new Set(draft.shifts.flatMap(shift => Object.values(shift.rooms).flatMap(room => room.operators)).filter((name): name is string => Boolean(name)));
    if (draft.fiammettaEnabled) names.add("菲亚梅塔");
    const hangerNames = new Set(posterSettings.presentation.dormHangerOperators.filter((name): name is string => Boolean(name)));
    for (const name of hangerNames) names.add(name);
    const operators = [...names].flatMap(name => {
      const operator = posterSettings.operators.find(entry => entry.name === name) ?? operbox.find(entry => entry.name === name) ?? posterHelpers?.defaultPosterOperator(name);
      return operator ? [{ ...operator, own: true }] : [];
    });
    return {
      ...posterSettings,
      layout,
      draft,
      operators,
      meta: /^\d{3} [一二两三四1234]班轮换$/.test(posterSettings.meta.title) ? { ...posterSettings.meta, title: `${layout.template} ${draft.shifts.length}班轮换` } : posterSettings.meta,
    };
  }, [layout, draft, operbox, posterSettings, posterHelpers]);

  const ensurePosterReady = useCallback(async () => {
    setPosterVisited(true);
    if (posterHelpers) return;
    if (!posterInitialization.current) {
      posterInitialization.current = (async () => {
        const [{ createPosterDocument, POSTER_STORAGE_KEY, readPosterFile }, model] = await Promise.all([
          import("@/schedule-poster-document"),
          import("@/schedule-poster-model"),
        ]);
        setPosterHelpers(model);
        if (!posterSettings) {
          let saved: SchedulePosterDocument | null = null;
          try {
            const value = window.localStorage.getItem(POSTER_STORAGE_KEY);
            if (value) saved = readPosterFile(value);
          } catch { /* Poster metadata must not prevent manual draft restoration. */ }
          setPosterSettings(current => current ?? saved ?? createPosterDocument(layout, draft, sourceOperbox ?? []));
        }
      })().finally(() => { posterInitialization.current = null; });
    }
    await posterInitialization.current;
  }, [draft, layout, posterHelpers, posterSettings, sourceOperbox]);

  useEffect(() => {
    if (initialPosterDocument) {
      setPosterSettings(initialPosterDocument);
      setView("poster");
      setPosterVisited(true);
      void ensurePosterReady();
    } else if (new URLSearchParams(window.location.search).get("tab") === "poster") {
      setView("poster");
      void ensurePosterReady();
    }
  }, [ensurePosterReady, initialPosterDocument]);
  const [moodRevision, setMoodRevision] = useState(0);
  const [moodSettingsOpen, setMoodSettingsOpen] = useState(false);
  const [restored, setRestored] = useState(false);
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [dormBatchOpen, setDormBatchOpen] = useState(false);
  const isMobile = useIsMobile();
  const dormPickerPageSize = isMobile ? 12 : MANUAL_PICKER_PAGE_SIZE;
  const [dormBatchSelection, setDormBatchSelection] = useState<string[]>([]);
  const [dormRestOnly, setDormRestOnly] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [maaImportPreview, setMaaImportPreview] = useState<MaaImportPreview | null>(null);
  const [maaImportError, setMaaImportError] = useState<string | null>(null);
  const [mowerExportOpen, setMowerExportOpen] = useState(false);
  const [pickerRoomFilter, setPickerRoomFilter] = useState<BuildingRoomPrefix | null>(null);
  const [pickerSkillTag, setPickerSkillTag] = useState<string | null>(null);
  const [pickerRarity, setPickerRarity] = useState<number | null>(null);
  const [pickerPage, setPickerPage] = useState(1);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [clearShiftConfirmationOpen, setClearShiftConfirmationOpen] = useState(false);
  const mobileToolsRef = useRef<HTMLDetailsElement>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [scheduleQuery, setScheduleQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const [pickerScrolling, setPickerScrolling] = useState(false);
  const [sortRoomId, setSortRoomId] = useState<string | null>(null);
  const [sortSelection, setSortSelection] = useState<{ roomId: string; slotIndex: number } | null>(null);
  const [dronePickerOpen, setDronePickerOpen] = useState(false);
  const pickerScrollTimer = useRef<number | null>(null);
  const maaImportReturnFocus = useRef<HTMLElement | null>(null);
  const pickerScrollContainerRef = useRef<HTMLDivElement>(null);
  const pickerResultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => {
    if (pickerScrollTimer.current !== null) window.clearTimeout(pickerScrollTimer.current);
  }, []);

  const ownedOperators = useMemo(() => (
    (operbox ?? []).filter((entry) => entry.own).sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
  ), [operbox]);
  const canPersistDraft = persistDraft && ownedOperators.length > 0;
  const externalNames = ownedOperators.filter(operator => !sourceOperbox?.some(source => source.name === operator.name && source.own)).map(operator => operator.name);
  const ownedFingerprint = ownedOperators.map((operator) => operator.name).join("\0");
  const eliteByOperator = useMemo(() => new Map(
    ownedOperators.map((operator) => [operator.name, operator.elite]),
  ), [ownedOperators]);
  const levelByOperator = useMemo(() => new Map(
    ownedOperators.map((operator) => [operator.name, operator.level]),
  ), [ownedOperators]);

  useEffect(() => {
    if (restored || !restorationReady || (ownedOperators.length === 0 && !initialPosterDocument)) return;
    try {
      const saved = initialDraft ?? loadManualScheduleDraft(window.localStorage);
      if (saved) {
        const reconciled = reconcileManualScheduleDraft(saved, layout, operbox);
        setDraft(reconciled);
        onShiftDurationsChange(reconciled.shifts.map((shift) => shift.durationHours));
        onShiftStartTimeChange(reconciled.startTime || DEFAULT_MANUAL_SHIFT_START_TIME);
        onScheduleModeChange(reconciled.scheduleMode);
        onFiammettaEnabledChange(reconciled.fiammettaEnabled);
        const cachedEvaluation = persistDraft ? loadManualEvaluationCache(window.localStorage) : null;
        if (cachedEvaluation) onRestoreEvaluation(cachedEvaluation);
      }
    } catch {
      setStorageWarning(intl("components_pages_ManualSchedulePage.theManualDraftCouldNotBeRestored"));
    }
    if (initialDraft) onInitialDraftConsumed();
    setRestored(true);
  }, [intl, initialDraft, initialPosterDocument, layout, onFiammettaEnabledChange, onInitialDraftConsumed, onRestoreEvaluation, onScheduleModeChange, onShiftDurationsChange, onShiftStartTimeChange, operbox, ownedOperators, persistDraft, restored, restorationReady]);

  useEffect(() => {
    if (!restored) return;
    setDraft((current) => current.fiammettaEnabled === fiammettaEnabled
      ? current
      : { ...current, fiammettaEnabled });
  }, [fiammettaEnabled, restored]);

  useEffect(() => {
    if (!restored) return;
    setDraft((current) => current.scheduleMode === scheduleMode ? current : { ...current, scheduleMode });
  }, [restored, scheduleMode]);

  useEffect(() => {
    if (!restored) return;
    setDraft((current) => reconcileManualScheduleDraft(
      resizeManualScheduleDraft(current, shiftDurations, current.startTime === "" && shiftStartTime === DEFAULT_MANUAL_SHIFT_START_TIME ? "" : shiftStartTime),
      layout,
      operbox,
    ));
  }, [layout, operbox, ownedFingerprint, restored, shiftDurations, shiftStartTime]);

  useEffect(() => {
    if (!restored || !canPersistDraft) return;
    try {
      persistManualScheduleDraft(window.localStorage, draft);
      setStorageWarning(null);
    } catch {
      setStorageWarning(intl("components_pages_ManualSchedulePage.changesRemainAvailableForThisVisitButCouldNot"));
    }
  }, [intl, canPersistDraft, draft, en, restored]);

  useEffect(() => {
    if (!restored || !posterDocument) return;
    void import("@/schedule-poster-document").then(({ POSTER_STORAGE_KEY, posterDataOnly }) => {
      try { window.localStorage.setItem(POSTER_STORAGE_KEY, JSON.stringify(posterDataOnly(posterDocument))); }
      catch { /* The user can still download the editable document. */ }
    });
  }, [restored, posterDocument]);
  const activeShift = Math.min(draft.activeShift, Math.max(0, draft.shifts.length - 1));
  const shiftRanges = manualShiftTimeRanges(draft.startTime, draft.shifts.map((shift) => shift.durationHours));
  const maaDraft = useMemo(() => ({
    ...draft,
    startTime: draft.startTime === "" && shiftStartTime === DEFAULT_MANUAL_SHIFT_START_TIME ? "" : shiftStartTime,
  }), [draft, shiftStartTime]);
  const maa = useMemo(() => manualScheduleToMaa(maaDraft, layout, fiammettaEnabled), [maaDraft, fiammettaEnabled, layout]);
  const activePlan = maa.plans[activeShift];
  const activeRoomProducts = useMemo(() => new Map(
    layout.rooms
      .filter((room) => room.kind === "trade_post" || room.kind === "factory")
      .flatMap((room) => {
        const product = draft.shifts[activeShift]?.rooms[room.id]?.product
          ?? room.product;
        return product ? [[room.id, product] as const] : [];
      }),
  ), [activeShift, draft.shifts, layout.rooms]);
  const activeDronePlan = maa.plans[droneStoragePlanIndex(activeShift, maa.plans.length)];
  const trainingRoom = layout.rooms.find((room) => room.kind === "training_room");
  const trainingAssignment = trainingRoom ? draft.shifts[activeShift]?.rooms[trainingRoom.id] : undefined;
  const activeTrainingRoomShift = useMemo(() => trainingRoom ? {
    trainee: trainingAssignment?.operators[0] ?? null,
    trainer: trainingAssignment?.operators[1] ?? null,
  } : undefined, [trainingAssignment?.operators, trainingRoom]);
  const activeEvaluationShift = result?.rotation.shifts[activeShift];
  const dormRooms = useMemo(() => layout.rooms.filter((room) => room.kind === "dormitory"), [layout.rooms]);
  const dormBatchCapacity = useMemo(
    () => dormRooms.reduce((total, room) => total + manualRoomCapacity(room), 0),
    [dormRooms],
  );
  const rows = useMemo(
    () => addOperatorPresentations(withRecyclingRoom(planToRows(activePlan, activeEvaluationShift, layout, activeTrainingRoomShift), recyclingRoomLevel).map((row) => {
      const assignment = draft.shifts[activeShift]?.rooms[row.roomId];
      const room = manualEditableRooms(layout, recyclingRoomLevel).find((candidate) => candidate.id === row.roomId);
      const capacity = room ? manualRoomCapacity(room) : 0;
      const visibleSlots = row.group === "control" ? 5 : row.group === "trading" || row.group === "manufacture" ? 3 : capacity;
      return {
        ...row,
        ...(row.group === "recycling" ? {
          operators: (assignment?.operators ?? []).filter((name): name is string => Boolean(name)),
          operatorSlots: (assignment?.operators ?? []).flatMap((name) => name ? [{ name, label: name }] : []),
        } : {}),
        ...(row.positionSlots ? {} : {
          slotAssignments: Array.from(
            { length: visibleSlots },
            (_, index) => {
              const name = index < capacity ? assignment?.operators[index] : undefined;
              return name ? { name, label: name } : undefined;
            },
          ),
          unavailableSlotIndices: Array.from({ length: Math.max(0, visibleSlots - capacity) }, (_, index) => capacity + index),
        }),
        ...(row.group === "dormitory" ? { autofill: Boolean(assignment?.autofill) } : {}),
        ...(room?.kind === "trade_post" || room?.kind === "factory" || room?.kind === "power_plant"
          ? { manualSkillEfficiencyPct: assignment?.manualSkillEfficiencyPct }
          : {}),
      };
    })),
    [activeEvaluationShift, activePlan, activeShift, activeTrainingRoomShift, draft.shifts, layout, recyclingRoomLevel],
  );
  useEffect(() => {
    if (!restored) return;
    onAgentContextChange?.(buildManualScheduleContext({ layout, draft, activeShift, rows, result }));
  }, [activeShift, draft, layout, onAgentContextChange, result, restored, rows]);
  const selectedRoom = picker?.kind === "slot" ? rows.find((row) => row.roomId === picker.roomId) : undefined;
  const selectedAssignment = picker?.kind === "slot" ? draft.shifts[activeShift]?.rooms[picker.roomId] : undefined;
  const selectedOperator = picker?.kind === "slot"
    ? selectedAssignment?.operators[picker.slotIndex] ?? null
    : picker?.kind === "poster-hanger" ? posterSettings?.presentation.dormHangerOperators[picker.shift] ?? null : null;
  const assignedOperatorNames = useMemo(() => new Set(
    Object.values(draft.shifts[activeShift]?.rooms ?? {}).flatMap((room) => room.operators.filter(Boolean)),
  ), [activeShift, draft.shifts]);
  const filteredOperators = useMemo(() => {
    const candidates = picker?.kind === "fiammetta"
      ? ownedOperators.filter((operator) => assignedOperatorNames.has(operator.name))
      : ownedOperators;
    const filterableOwnedOperators = candidates.map((operator) => {
      const catalog = OPERATOR_CATALOG_BY_ID.get(operator.id) ?? OPERATOR_CATALOG_BY_NAME.get(operator.name);
      return {
        box: operator,
        name: operator.name,
        order: catalog?.order ?? 0,
        buildingSkills: catalog?.buildingSkills ?? [],
      };
    });
    return filterOperators(
      filterableOwnedOperators,
      pickerRoomFilter,
      pickerSkillTag,
      pickerQuery,
      (skillId) => BUILDING_SKILL_CATALOG[skillId],
    )
      .filter((operator) => pickerRarity === null || operator.box.rarity === pickerRarity)
      .map((operator) => operator.box);
  }, [assignedOperatorNames, ownedOperators, picker?.kind, pickerQuery, pickerRarity, pickerRoomFilter, pickerSkillTag]);
  const previousShiftOperatorNames = useMemo(() => new Set(
    activeShift > 0
      ? Object.entries(draft.shifts[activeShift - 1]?.rooms ?? {})
        .filter(([roomId]) => layout.rooms.find((room) => room.id === roomId)?.kind !== "dormitory")
        .flatMap(([, room]) => room.operators.filter(Boolean))
      : [],
  ), [activeShift, draft.shifts, layout.rooms]);
  const currentShiftOperatorNames = useMemo(() => new Set(
    Object.entries(draft.shifts[activeShift]?.rooms ?? {})
      .filter(([roomId]) => layout.rooms.find((room) => room.id === roomId)?.kind !== "dormitory")
      .flatMap(([, room]) => room.operators.filter(Boolean)),
  ), [activeShift, draft.shifts, layout.rooms]);
  const dormFilteredOperators = useMemo(() => {
    const candidates = dormRestOnly
      ? filteredOperators.filter((operator) => previousShiftOperatorNames.has(operator.name) && !currentShiftOperatorNames.has(operator.name))
      : filteredOperators;
    const selectionOrder = new Map(dormBatchSelection.map((name, index) => [name, index]));
    return [...candidates].sort((a, b) =>
      (selectionOrder.get(a.name) ?? Number.MAX_SAFE_INTEGER) - (selectionOrder.get(b.name) ?? Number.MAX_SAFE_INTEGER));
  }, [currentShiftOperatorNames, dormBatchSelection, dormRestOnly, filteredOperators, previousShiftOperatorNames]);
  const pickerPageCount = Math.max(1, Math.ceil(filteredOperators.length / MANUAL_PICKER_PAGE_SIZE));
  const dormPickerPageCount = Math.max(1, Math.ceil(dormFilteredOperators.length / dormPickerPageSize));
  const dormPickerPage = Math.min(pickerPage, dormPickerPageCount);
  const visibleOperators = filteredOperators.slice(
    (pickerPage - 1) * MANUAL_PICKER_PAGE_SIZE,
    pickerPage * MANUAL_PICKER_PAGE_SIZE,
  );
  const dormVisibleOperators = dormFilteredOperators.slice(
    (dormPickerPage - 1) * dormPickerPageSize,
    dormPickerPage * dormPickerPageSize,
  );
  const emptyOperatorChoiceCount = MANUAL_PICKER_PAGE_SIZE - visibleOperators.length;
  const availableSkillTags = pickerRoomFilter ? ROOM_SKILL_TAGS[pickerRoomFilter] : [];
  const activeAssignmentRoomByOperator = useMemo(() => {
    const assignments = new Map<string, string>();
    for (const row of rows) {
      const room = draft.shifts[activeShift]?.rooms[row.roomId];
      for (const name of room?.operators ?? []) {
        if (name) assignments.set(name, localizedRoomTitle(row.title, row.group, locale, gameCatalog));
      }
    }
    return assignments;
  }, [activeShift, draft.shifts, gameCatalog, locale, rows]);

  function setActiveShift(index: number) {
    setSortRoomId(null);
    setSortSelection(null);
    setDraft((current) => ({ ...current, activeShift: index }));
  }

  function openSlotPicker(row: RoomRow, slotIndex: number) {
    if (row.unavailableSlotIndices?.includes(slotIndex)) return;
    setPickerScrolling(false);
    setPickerQuery("");
    setPickerRoomFilter(ROOM_GROUP_TO_SKILL_PREFIX[row.group] ?? null);
    setPickerSkillTag(null);
    setPickerRarity(null);
    setPickerPage(1);
    setPicker({ kind: "slot", roomId: row.roomId, slotIndex });
  }

  function openDormBatchPicker() {
    const current = draft.shifts[activeShift];
    const selected = dormRooms.flatMap((room) => current?.rooms[room.id]?.operators ?? []).filter(
      (operator): operator is string => Boolean(operator),
    );
    setDormBatchSelection(selected);
    setPickerQuery("");
    setPickerRoomFilter(null);
    setPickerSkillTag(null);
    setPickerRarity(null);
    setPickerPage(1);
    setDormRestOnly(false);
    setDormBatchOpen(true);
  }

  function toggleDormBatchOperator(operator: string) {
    setDormBatchSelection((current) => current.includes(operator)
      ? current.filter((name) => name !== operator)
      : current.length >= dormBatchCapacity ? current : [...current, operator]);
  }

  function selectAllDormRestOperators() {
    if (!dormRestOnly) return;
    setDormBatchSelection(dormFilteredOperators.slice(0, dormBatchCapacity).map((operator) => operator.name));
    setPickerPage(1);
  }

  function applyDormBatch() {
    setDraft((current) => {
      const next = structuredClone(current);
      const shift = next.shifts[activeShift];
      if (!shift) return current;
      const selected = new Set(dormBatchSelection);
      for (const room of Object.values(shift.rooms)) {
        room.operators = room.operators.map((operator) => selected.has(operator ?? "") ? null : operator);
      }
      let offset = 0;
      for (const room of dormRooms) {
        const capacity = manualRoomCapacity(room);
        shift.rooms[room.id] = {
          ...shift.rooms[room.id],
          operators: Array.from({ length: capacity }, (_, index) => dormBatchSelection[offset + index] ?? null),
          autofill: false,
        };
        offset += capacity;
      }
      return next;
    });
    setDormBatchOpen(false);
  }

  function toggleSortMode(row: RoomRow) {
    setSortRoomId((current) => current === row.roomId ? null : row.roomId);
    setSortSelection(null);
  }

  function handleSortSlotClick(row: RoomRow, slotIndex: number) {
    if (row.roomId !== sortRoomId) return;
    const operator = row.operatorSlots[slotIndex]?.name;
    if (!operator) return;
    if (!sortSelection) {
      setSortSelection({ roomId: row.roomId, slotIndex });
      return;
    }
    if (sortSelection.roomId !== row.roomId) {
      setSortSelection({ roomId: row.roomId, slotIndex });
      return;
    }
    setDraft((current) => swapManualOperators(
      current,
      layout,
      activeShift,
      row.roomId,
      sortSelection.slotIndex,
      slotIndex,
    ));
    setSortSelection(null);
  }

  function handleSlotClick(row: RoomRow, slotIndex: number) {
    if (allowReplacementOperatorSort && sortRoomId === row.roomId) {
      handleSortSlotClick(row, slotIndex);
      return;
    }
    openSlotPicker(row, slotIndex);
  }

  function openFiammettaPicker() {
    setPickerScrolling(false);
    setPickerQuery("");
    setPickerRoomFilter(null);
    setPickerSkillTag(null);
    setPickerRarity(null);
    setPickerPage(1);
    setPicker({ kind: "fiammetta" });
  }

  function changePickerRoomFilter(next: BuildingRoomPrefix | null) {
    setPickerRoomFilter(next);
    setPickerSkillTag(null);
    setPickerPage(1);
  }

  function changePickerSkillTag(next: string | null) {
    setPickerSkillTag(next);
    setPickerPage(1);
  }

  function changePickerPage(next: number) {
    setPickerPage(next);
    window.requestAnimationFrame(() => {
      const container = pickerScrollContainerRef.current;
      const results = pickerResultsRef.current;
      if (!container || !results) return;
      const top = container.scrollTop + results.getBoundingClientRect().top - container.getBoundingClientRect().top;
      container.scrollTo({
        top,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    });
  }

  function handlePickerScroll() {
    setPickerScrolling(true);
    if (pickerScrollTimer.current !== null) window.clearTimeout(pickerScrollTimer.current);
    pickerScrollTimer.current = window.setTimeout(() => {
      pickerScrollTimer.current = null;
      setPickerScrolling(false);
    }, 150);
  }

  function chooseOperator(operator: string | null) {
    if (!picker) return;
    if (picker.kind === "poster-hanger") {
      const shift = picker.shift;
      const selected = operator ? ownedOperators.find(entry => entry.name === operator) : undefined;
      setPosterSettings(current => {
        if (!current) return current;
        const dormHangerOperators = Array.from({ length: current.draft.shifts.length }, (_, index) => current.presentation.dormHangerOperators[index] ?? null);
        dormHangerOperators[shift] = operator;
        const operators = selected
          ? [...current.operators.filter(entry => entry.name !== selected.name), selected]
          : current.operators;
        return { ...current, operators, presentation: { ...current.presentation, dormHangerOperators } };
      });
      setPicker(null);
      return;
    }
    if (picker.kind === "fiammetta") {
      if (operator && !assignedOperatorNames.has(operator)) return;
      setDraft((current) => {
        const next = structuredClone(current);
        if (next.shifts[activeShift]) next.shifts[activeShift]!.fiammettaTarget = operator;
        return next;
      });
      setPicker(null);
      return;
    }
    const result = assignManualOperator({
      draft,
      layout,
      shiftIndex: activeShift,
      roomId: picker.roomId,
      slotIndex: picker.slotIndex,
      operator,
    });
    if (result.conflict && operator) {
      setPendingMove({ operator, target: picker, conflict: result.conflict });
      setPicker(null);
      return;
    }
    setDraft(result.draft);
    setPicker(null);
  }

  function confirmMove() {
    if (!pendingMove) return;
    setDraft((current) => assignManualOperator({
      draft: current,
      layout,
      shiftIndex: activeShift,
      roomId: pendingMove.target.roomId,
      slotIndex: pendingMove.target.slotIndex,
      operator: pendingMove.operator,
      moveExisting: true,
    }).draft);
    setPendingMove(null);
  }

  function clearRoom(row: RoomRow) {
    setDraft((current) => clearManualRoom(current, layout, activeShift, row.roomId));
    if (picker?.kind === "slot" && picker.roomId === row.roomId) setPicker(null);
  }

  function clearCurrentShift() {
    setDraft((current) => clearManualShift(current, layout, activeShift));
    setPicker(null);
    setClearShiftConfirmationOpen(false);
  }

  function restPreviousShift() {
    if (activeShift <= 0) return;
    setDraft((current) => restPreviousShiftOperators(current, layout, activeShift));
    setPicker(null);
  }

  function setDormAutofill(row: RoomRow, enabled: boolean) {
    setDraft((current) => setManualDormAutofill(
      current,
      layout,
      activeShift,
      row.roomId,
      enabled,
    ));
  }

  function setRoomSkillEfficiency(row: RoomRow, value: number | null) {
    setDraft((current) => setManualRoomSkillEfficiency(current, layout, activeShift, row.roomId, value));
  }

  function setRoomProduct(roomId: string, product: import("@/types").RoomProduct) {
    setDraft((current) => setManualRoomProduct(current, layout, activeShift, roomId, product));
  }

  function handleFactoryRecipeChange(roomId: string, recipe: FactoryRecipe) {
    setRoomProduct(roomId, { factory: { recipe } });
  }

  function handleTradeOrderChange(roomId: string, order: TradeOrder) {
    setRoomProduct(roomId, { trade: { order } });
  }

  function toggleDroneTarget(row: RoomRow) {
    setDraft((current) => setManualDroneTarget(
      current,
      layout,
      activeShift,
      current.shifts[activeShift]?.droneTargetRoomId === row.roomId ? null : row.roomId,
    ));
  }

  function exportMaa() {
    downloadJson("arknights-infra-schedule-maa.json", prepareMaaForExport(
      maa,
      strictMaaOperatorOrder,
      allowReplacementOperatorSort,
    ));
  }

  function updatePoster(next: SchedulePosterDocument) {
    const scheduledNames = new Set(next.draft.shifts.flatMap(shift => Object.values(shift.rooms).flatMap(room => room.operators)).filter((name): name is string => Boolean(name)));
    if (next.draft.fiammettaEnabled) scheduledNames.add("菲亚梅塔");
    const posterOperators = posterHelpers?.posterOperators(next) ?? next.operators;
    const additions = posterOperators.filter(operator => scheduledNames.has(operator.name) && !operbox.some(current => current.name === operator.name && current.own));
    if (additions.length) onPosterWorkingBoxChange?.([...operbox, ...additions]);
    setPosterSettings(next);
    setDraft(next.draft);
    if (JSON.stringify(next.draft.shifts.map(shift => shift.durationHours)) !== JSON.stringify(shiftDurations)) onShiftDurationsChange(next.draft.shifts.map(shift => shift.durationHours));
    const nextStartTime = next.draft.startTime || DEFAULT_MANUAL_SHIFT_START_TIME;
    if (nextStartTime !== shiftStartTime) onShiftStartTimeChange(nextStartTime);
    if (next.draft.scheduleMode !== scheduleMode) onScheduleModeChange(next.draft.scheduleMode);
    if (next.draft.fiammettaEnabled !== fiammettaEnabled) onFiammettaEnabledChange(next.draft.fiammettaEnabled);
  }
  function importPoster(next: SchedulePosterDocument) {
    if (onImportPoster) { onImportPoster(next); return; }
    onImportedLayoutChange(next.layout); updatePoster({ ...next, operators: posterHelpers?.posterOperators(next) ?? next.operators });
  }
  function selectPosterSlot(target: PosterTarget) {
    setPickerQuery(""); setPickerRoomFilter(null); setPickerSkillTag(null); setPickerRarity(null); setPickerPage(1);
    if (target.presentationOnly === "dorm-hanger") {
      setPicker({ kind: "poster-hanger", shift: target.shift });
      return;
    }
    setActiveShift(target.shift);
    setPicker({ kind: "slot", roomId: target.roomId, slotIndex: target.slot ?? 0 });
  }
  async function calculateSchedule(mode: "native" | "manual") {
    if (evaluationPending) return;
    setCalculationError("");
    setPosterSettings(current => current ? { ...current, efficiencyMode: mode } : current);
    try {
      await (mode === "native" ? onEvaluate : onPaperEvaluate)({ draft, operbox });
      setEvaluatedKey(JSON.stringify([layout, { ...draft, activeShift: 0, startTime: "00:00" }, operbox, mode]));
    } catch (error) { setCalculationError(error instanceof Error ? error.message : "计算失败。"); }
  }

  async function prepareMaaImport(file: File, signal: AbortSignal) {
    if (file.size > 5 * 1024 * 1024) {
      throw new Error(intl("components_pages_ManualSchedulePage.scheduleFileTooLarge"));
    }
    try {
      const text = await file.text();
      signal.throwIfAborted();
      const importedMower = showMower ? mowerPlanToMaa(JSON.parse(text)) : null;
      const sourceMaa = importedMower ?? parseMaaScheduleText(text);
      const importedMaa = normalizeMaaScheduleForManualImport(sourceMaa);
      const importedLayout = layoutFromMaaSchedule(importedMaa, layout);
      const fiammettaImported = importedMaa.plans.some((plan) => plan.Fiammetta?.enable === true);
      const converted = createManualScheduleDraftFromCalculator({
        layout: importedLayout,
        maa: importedMaa,
        fallbackDurations: [],
        fiammettaEnabled: fiammettaImported,
        preferMaaTiming: true,
        preserveExternalOperators: true,
      });
      const reconciled = reconcileManualScheduleDraft(converted, importedLayout, operbox);
      setMaaImportPreview({
        format: importedMower ? "mower" : "maa",
        fileName: file.name,
        draft: reconciled,
        layout: importedLayout,
        sourceShiftCount: sourceMaa.plans.length,
        importedShiftCount: reconciled.shifts.length,
        sourceAssignmentCount: Math.max(countMaaAssignments(sourceMaa), countDraftAssignments(reconciled)),
        importedAssignmentCount: countDraftAssignments(reconciled),
      });
    } catch (error) {
      signal.throwIfAborted();
      throw new Error(showMower ? intl("components_pages_ManualSchedulePage.invalidMowerOrMaaSchedule") : en
        ? intl("components_pages_ManualSchedulePage.invalidMaaSchedule")
        : error instanceof Error ? error.message : intl("components_pages_ManualSchedulePage.invalidMaaSchedule"), { cause: error });
    }
  }

  function confirmMaaImport() {
    if (!maaImportPreview) return;
    setMoodRevision(value => value + 1);
    const imported = maaImportPreview.draft;
    onImportedLayoutChange(maaImportPreview.layout);
    setDraft(imported);
    onShiftDurationsChange(imported.shifts.map((shift) => shift.durationHours));
    onShiftStartTimeChange(imported.startTime);
    onScheduleModeChange(imported.scheduleMode);
    onFiammettaEnabledChange(imported.fiammettaEnabled);
    setMaaImportPreview(null);
  }

  if (!operbox?.some((operator) => operator.own) && !initialPosterDocument) {
    return (
      <section className="flex min-h-[calc(100svh-9rem)] items-center justify-center py-8" aria-labelledby="manual-schedule-empty-title" data-manual-schedule-empty>
        <div className="w-full max-w-2xl border border-[#313131]/15 bg-[#F3F1EA] px-6 py-12 text-center shadow-[0_18px_45px_rgb(49_49_49/0.08)] sm:px-10">
          <span className="mx-auto grid size-12 place-items-center bg-[#313131] text-[#FFD800]" aria-hidden="true"><Sparkles /></span>
          <h1 id="manual-schedule-empty-title" className="mt-5 text-2xl font-semibold tracking-tight">{intl("components_pages_ManualSchedulePage.buildAManualSchedule")}</h1>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-muted-foreground">{intl("components_pages_ManualSchedulePage.chooseAnOperatorBoxBaseLayoutShiftCountAnd")}</p>
          <Button type="button" size="lg" className="mt-7 min-h-11" onClick={onOpenSetup}><Settings2 />{intl("components_pages_ManualSchedulePage.configureBoxLayout")}</Button>
        </div>
      </section>
    );
  }

  const fiammettaTarget = draft.shifts[activeShift]?.fiammettaTarget;
  const fiammettaPortrait = fiammettaTarget ? operatorPortraitFor(fiammettaTarget) : null;
  const hasFiammetta = ownedOperators.some((operator) => operator.name === "菲亚梅塔");
  const sourceVariantLabel = draft.source?.variant === "progression-adjusted"
    ? (intl("components_pages_ManualSchedulePage.progressionAdjustedPlan"))
    : (intl("components_pages_ManualSchedulePage.originalPlan"));
  const previousRoomTitle = pendingMove ? rows.find((row) => row.roomId === pendingMove.conflict.roomId)?.title ?? pendingMove.conflict.roomId : "";
  const nextRoomTitle = pendingMove ? rows.find((row) => row.roomId === pendingMove.target.roomId)?.title ?? pendingMove.target.roomId : "";
  const renderBoard = (simulation: MoodBoardState | null) => (
    <div data-manual-editor-board data-board-mode={simulation ? "simulation" : "edit"}>
      <ScheduleBoard
        rows={simulation?.rows ?? rows}
        layout={layout}
        planRevision={simulation ? `mood-${simulation.shift}` : `manual-${activeShift}`}
        simulation={simulation ? {moods:simulation.moods,selected:simulation.selected,onSelect:simulation.onSelect} : undefined}
        eliteByOperator={eliteByOperator}
        levelByOperator={levelByOperator}
        activeShift={simulation?.shift ?? activeShift}
        activePlan={simulation ? undefined : activePlan}
        searchQuery={scheduleQuery}
        viewModeActionSlot={!simulation && (
          <div className="flex flex-wrap items-center gap-2">
            {dormRooms.length > 0 ? (
              <Button type="button" variant="outline" size="sm" onClick={openDormBatchPicker}>
                {intl("components_pages_ManualSchedulePage.dormBatchEdit", { capacity: dormBatchCapacity })}
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" disabled={activeShift <= 0} onClick={restPreviousShift}>
              {intl("components_pages_ManualSchedulePage.restPreviousShift")}
            </Button>
            <Button type="button" variant="destructive" size="sm" onClick={() => setClearShiftConfirmationOpen(true)}>
              <Trash2 />{intl("components_pages_ManualSchedulePage.clearEveryFacilityInShift")}
            </Button>
          </div>
        )}
        shiftTabsSlot={simulation ? <span className="text-sm text-muted-foreground">{intl("MoodSimulation.position",{cycle:simulation.cycle+1,shift:simulation.shift+1})}</span> : (
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2" data-manual-shift-actions>
            <ShiftTabs
              maaJson={maa}
              durations={draft.shifts.map((shift) => shift.durationHours)}
              labels={draft.scheduleMode === "period" ? shiftRanges.map((range, index) => ({
                content: <>
                  {intl("components_pages_ManualSchedulePage.shift", { shift: index + 1 })}
                  {" · "}<span className="font-number">{range.startTime}–{range.endTime}</span>
                  {intl("components_pages_ManualSchedulePage.durationParenthetical", { duration: formatManualShiftDuration(range.durationMinutes, en) })}
                </>,
                ariaLabel: intl("components_pages_ManualSchedulePage.shiftRange", {
                  shift: index + 1,
                  startTime: range.startTime,
                  endTime: range.endTime,
                  duration: formatManualShiftDuration(range.durationMinutes, en),
                }),
              })) : undefined}
              wrap
              active={activeShift}
              control={shiftViewControl}
              onChange={setActiveShift}
            />
            {hasFiammetta ? (
              <FiammettaTargetChip
                target={fiammettaEnabled ? fiammettaTarget : null}
                portrait={fiammettaEnabled ? fiammettaPortrait : null}
                onClick={() => {
                  if (!fiammettaEnabled) onFiammettaEnabledChange(true);
                  openFiammettaPicker();
                }}
              />
            ) : null}
          </div>
        )}
        onSlotClick={simulation ? undefined : handleSlotClick}
        sortRoomId={!simulation && allowReplacementOperatorSort ? sortRoomId : null}
        sortSelection={simulation ? null : sortSelection}
        onSortToggle={!simulation && allowReplacementOperatorSort ? toggleSortMode : undefined}
        onSortSlotClick={simulation ? undefined : handleSortSlotClick}
        viewModeControl={scheduleViewControl}
        hideImages={!showImages}
        renderListRoomActions={simulation ? undefined : (row, position) => (
          <ManualScheduleRoomActions
            row={row}
            position={position}
            roomTitle={localizedRoomTitle(row.title, row.group, locale, gameCatalog)}
            onClearRoom={clearRoom}
            onDormAutofillChange={setDormAutofill}
            droneTargetRoomId={draft.shifts[activeShift]?.droneTargetRoomId}
            onDroneTargetChange={toggleDroneTarget}
            sortMode={sortRoomId === row.roomId}
            onSortToggle={allowReplacementOperatorSort ? toggleSortMode : undefined}
          />
        )}
        onClearRoom={simulation ? undefined : clearRoom}
        onDormAutofillChange={simulation ? undefined : setDormAutofill}
        droneTargetRoomId={simulation ? undefined : draft.shifts[activeShift]?.droneTargetRoomId}
        onDroneTargetChange={simulation ? undefined : toggleDroneTarget}
        onManualSkillEfficiencyChange={simulation ? undefined : setRoomSkillEfficiency}
        onFactoryRecipeChange={handleFactoryRecipeChange}
        onTradeOrderChange={handleTradeOrderChange}
        roomProducts={simulation ? undefined : activeRoomProducts}
        compactProductControls={!simulation}
      />
    </div>
  );

  const closeMobileTools = () => { if (mobileToolsRef.current) mobileToolsRef.current.open = false; };
  const runNativeEvaluation = () => { closeMobileTools(); void calculateSchedule("native"); };
  const runPaperEvaluation = () => { closeMobileTools(); void calculateSchedule("manual"); };
  const scheduleTools = (mobile = false) => <>
    {draft.source ? <Button type="button" variant="ghost" size="sm" onClick={() => { closeMobileTools(); onOpenCalculator(); }}>
      <ArrowLeft />{intl("components_pages_ManualSchedulePage.backToCalculation")}
    </Button> : null}
    <Button type="button" variant={mobile ? "ghost" : "outline"} size="sm" onClick={() => { closeMobileTools(); onOpenSetup(); }}><Settings2 />{intl("components_pages_ManualSchedulePage.configureBoxLayout")}</Button>
    <Button type="button" variant={mobile ? "ghost" : "outline"} size="sm" onClick={() => { closeMobileTools(); setMoodSettingsOpen(true); }}><Settings2 />{intl("MoodSimulation.settings")}</Button>
    <Button type="button" variant={mobile ? "ghost" : "outline"} size="sm" onClick={runNativeEvaluation} disabled={evaluationPending}><Sparkles />{intl("components_pages_ManualSchedulePage.calculateBasedOnSchedule")}</Button>
    <Button type="button" variant={mobile ? "ghost" : "outline"} size="sm" onClick={runPaperEvaluation} disabled={evaluationPending}><Sparkles />{intl("components_pages_ManualSchedulePage.calculateBasedOnEfficiency")}</Button>
    <FileUploadDialog
      title={intl("components_pages_ManualSchedulePage.importScheduleFile")}
      description={intl("FileUpload.scheduleDescription")}
      extensions={[".json"]}
      successFocus={() => false}
      returnFocus={() => maaImportReturnFocus.current}
      onFiles={([file], signal) => prepareMaaImport(file, signal)}
      trigger={<Button type="button" variant={mobile ? "ghost" : "outline"} size="sm" onClick={event => {
        maaImportReturnFocus.current = mobile ? mobileToolsRef.current?.querySelector("summary") ?? null : event.currentTarget;
        closeMobileTools();
      }}><Upload />{intl("components_pages_ManualSchedulePage.importScheduleFile")}</Button>}
    />
  </>;

  return (
    <div className="min-h-[calc(100svh-9rem)] py-2" data-manual-schedule-page>
      <header className="mb-3 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 md:mb-4 md:flex md:flex-wrap md:items-center">
        <div className={`relative col-span-2 min-w-0 md:min-w-[240px] md:flex-1 ${!mobileSearchOpen && !scheduleQuery ? "max-md:hidden" : ""}`}>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input ref={searchInputRef} value={scheduleQuery} onChange={(event) => setScheduleQuery(event.target.value)} className="pl-9 max-md:h-11 max-md:pr-11" aria-label={intl("components_pages_ManualSchedulePage.searchThisManualSchedule")} placeholder={intl("components_pages_ManualSchedulePage.searchOperatorsOrRooms")} />
          <Button type="button" size="icon" variant="ghost" className="absolute right-0 top-0 size-11 md:hidden" aria-label={intl("components_pages_InfraCalculator.clearScheduleSearch")} onClick={() => { setScheduleQuery(""); setMobileSearchOpen(false); searchToggleRef.current?.focus(); }}><X /></Button>
        </div>
        <div className="hidden md:contents">{scheduleTools()}</div>
        <div className="relative flex min-w-0 items-center gap-2 md:hidden">
          <Button ref={searchToggleRef} type="button" size="icon" variant="outline" className="size-11" aria-label={intl("components_pages_ManualSchedulePage.searchThisManualSchedule")} aria-expanded={mobileSearchOpen || Boolean(scheduleQuery)} onClick={() => { setMobileSearchOpen(true); requestAnimationFrame(() => searchInputRef.current?.focus()); }}><Search /></Button>
          <details ref={mobileToolsRef} className="shrink-0" data-manual-more-tools>
            <summary aria-label={intl("components_pages_InfraCalculator.moreTools")} title={intl("components_pages_InfraCalculator.moreTools")} className="flex size-11 cursor-pointer list-none items-center justify-center rounded-lg border border-border bg-background marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD800]"><Ellipsis className="size-4" aria-hidden="true" /></summary>
            <div className="absolute left-0 top-[calc(100%+0.35rem)] z-30 grid w-[min(18rem,calc(100vw-1.5rem))] gap-2 border border-border bg-background p-2 shadow-lg [&_button]:h-auto [&_button]:min-h-11 [&_button]:min-w-0 [&_button]:w-full [&_button]:justify-start [&_button]:whitespace-normal">{scheduleTools(true)}</div>
          </details>
        </div>
        <Button type="button" size="sm" className="min-w-0 max-md:h-auto max-md:min-h-11 max-md:whitespace-normal max-md:px-3 max-md:py-2 max-md:text-xs" onClick={exportMaa}><Download />{intl("components_pages_ManualSchedulePage.exportMaa")}</Button>
        {showMower ? <Button type="button" variant="outline" size="sm" onClick={() => setMowerExportOpen(true)}><Download />{intl("components_pages_ManualSchedulePage.exportMower")}</Button> : null}
      </header>
      {maaImportError ? <p className="mb-3 text-sm text-destructive" role="alert">{maaImportError}</p> : null}

      <div className="mb-4 border-y border-border/70 bg-muted/25 px-3 py-3">
        <div className="flex min-w-0 items-baseline gap-3" data-manual-draft-info>
          <p className="shrink-0 whitespace-nowrap text-sm font-medium">{intl("components_pages_ManualSchedulePage.manualDraft")} · <span className="font-number">{layout.template}</span></p>
          <p className="min-w-0 truncate text-xs text-muted-foreground" title={`${sourceName ?? intl("components_pages_ManualSchedulePage.currentOperatorBox")} · ${ownedOperators.length} ${intl("components_pages_ManualSchedulePage.owned")}`} data-manual-draft-source={draft.source?.variant ?? "standalone"}>
            {draft.source ? (intl("components_pages_ManualSchedulePage.basedOn", { sourceVariantLabel: sourceVariantLabel })) : null}
            {draft.source ? " · " : null}
            {sourceName ?? (intl("components_pages_ManualSchedulePage.currentOperatorBox"))} · {ownedOperators.length} {intl("components_pages_ManualSchedulePage.owned")}
          </p>
        </div>
      </div>

      {externalNames.length ? <p className="mb-3 text-xs text-muted-foreground">作业示例练度（非个人持有）：{externalNames.join("、")}。可在 Box 与排班设置中调整练度。</p> : null}
      <ManualProductionSummary
        result={result}
        activeShift={activeShift}
        controlsSlot={(
          <PlanSupportSummary
            drones={activeDronePlan?.drones}
            target={fiammettaEnabled ? fiammettaTarget : null}
            portrait={fiammettaEnabled ? fiammettaPortrait : null}
            automatic={false}
            automaticDisabled
            onChooseFacility={() => setDronePickerOpen(true)}
          />
        )}
      />

      {calculationError ? <p role="alert" className="mb-3 text-sm text-destructive">{calculationError}</p> : null}
      {storageWarning ? <p className="mb-3 text-sm text-amber-700" role="status">{storageWarning}</p> : null}

      {restored && <Suspense fallback={<Skeleton className="mt-8 h-48 w-full" />}>
        <MoodSimulationPanel key={moodRevision} layout={layout} operbox={operbox ?? []} draft={draft}
          renderBoard={renderBoard}
          view={view} onViewChange={value => { setView(value); if (value === "poster") void ensurePosterReady(); }}
          posterContent={posterVisited ? posterSettings && posterDocument && posterHelpers
            ? <Suspense fallback={<Skeleton className="h-64 w-full" />}><PosterWorkbench document={posterDocument}
              onChange={updatePoster} onImport={importPoster} onSelect={selectPosterSlot}
              result={result} pending={evaluationPending} onCalculate={calculateSchedule} /></Suspense>
            : <Skeleton className="h-64 w-full" /> : null}
          settingsOpen={moodSettingsOpen} onSettingsOpenChange={setMoodSettingsOpen}
          fiammettaEnabled={fiammettaEnabled} onFiammettaEnabledChange={onFiammettaEnabledChange}
          onTargetChange={(shift, target) => setDraft(current => ({
            ...current, shifts: current.shifts.map((item, index) => index === shift ? { ...item, fiammettaTarget: target } : item),
          }))} />
      </Suspense>}

      {dronePickerOpen ? <DroneTargetPicker
        rows={rows}
        targetRoomId={draft.shifts[activeShift]?.droneTargetRoomId}
        manualSelection={false}
        onTargetChange={toggleDroneTarget}
        onOpenChange={setDronePickerOpen}
      /> : null}

      <Dialog open={clearShiftConfirmationOpen} onOpenChange={setClearShiftConfirmationOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{intl("components_pages_ManualSchedulePage.clearEveryFacilityQuestion")}</DialogTitle>
            <DialogDescription>
              {intl("components_pages_ManualSchedulePage.clearShiftDescription", { shift: activeShift + 1 })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setClearShiftConfirmationOpen(false)}>{intl("components_pages_ManualSchedulePage.cancel")}</Button>
            <Button type="button" variant="destructive" onClick={clearCurrentShift}><Trash2 />{intl("components_pages_ManualSchedulePage.clearCurrentShift")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(picker)} onOpenChange={(open) => { if (!open) setPicker(null); }}>
        <DialogContent className="grid max-h-[min(820px,calc(100svh-1rem))] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:w-[calc(100vw-2rem)] sm:max-w-[min(960px,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>{picker?.kind === "poster-hanger" ? "选择宿舍挂件干员" : picker?.kind === "fiammetta" ? (intl("components_pages_ManualSchedulePage.fiammettaMoraleTarget")) : (intl("components_pages_ManualSchedulePage.assign", { value1: (en) ? (selectedRoom?.title ?? intl("components_pages_ManualSchedulePage.room")) : "", value2: (en) ? "" : (selectedRoom?.title ?? intl("components_pages_ManualSchedulePage.facility")) }))}</DialogTitle>
            <DialogDescription>{picker?.kind === "poster-hanger" ? "仅用于作业图展示，不会加入宿舍排班或参与效率计算。" : picker?.kind === "fiammetta" ? (intl("components_pages_ManualSchedulePage.thisTargetIsStoredOnlyForTheActiveShift")) : (intl("components_pages_ManualSchedulePage.onlyOwnedOperatorsInTheCurrentBoxAreShown"))}</DialogDescription>
          </DialogHeader>
          <SkeletonSuspense className="min-h-0 [&>[data-skeleton-swap-content]]:grid [&>[data-skeleton-swap-content]]:min-h-0" fallback={<div className="grid min-h-64 content-start gap-3 px-5 pb-5 sm:px-7"><Skeleton className="h-11" /><Skeleton className="h-24" /><div className="grid grid-cols-4 gap-3">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-20" />)}</div></div>}>
          <ScrollArea className="min-h-0" viewportClassName="overflow-x-hidden" viewportProps={{ ref: pickerScrollContainerRef, onScroll: handlePickerScroll }}>
          <DialogBody className="block pt-1 pb-5 sm:pb-6" data-manual-operator-picker>
            <div className="mb-3">
              <OperatorSearch
                autoFocus
                value={pickerQuery}
                label={intl("components_pages_ManualSchedulePage.searchSelectableOperatorsAndSkills")}
                placeholder={intl("components_pages_ManualSchedulePage.searchOperatorSkillOrEffect")}
                onChange={(value) => {
                  setPickerQuery(value);
                  setPickerPage(1);
                }}
              />
            </div>

            {picker?.kind === "slot" ? (
              <div className="grid gap-1">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <SkillFilterRow label={skillFilters("room")}>
                      <SkillRoomTagBar selected={pickerRoomFilter} onChange={changePickerRoomFilter} />
                    </SkillFilterRow>
                  </div>
                  <Button type="button" variant="destructive" size="sm" className="px-2 text-xs max-sm:min-h-8" onClick={() => chooseOperator(null)}><Trash2 />{intl("components_pages_ManualSchedulePage.clearSlot")}</Button>
                </div>
                <SkillFilterRow label={skillFilters("tag")}>
                  {availableSkillTags.length > 0
                    ? <SkillTagBar tags={availableSkillTags} selected={pickerSkillTag} onChange={changePickerSkillTag} />
                    : <div className="flex min-h-7 items-center text-xs text-muted-foreground max-sm:min-h-11" data-empty-skill-tags>{intl("components_pages_ManualSchedulePage.noSkillTagsAvailable")}</div>}
                </SkillFilterRow>
              </div>
            ) : null}

            {picker?.kind === "fiammetta" ? (
              <div className="flex justify-end">
                <Button type="button" variant="destructive" size="sm" className="px-2 text-xs max-sm:min-h-8" data-manual-clear-morale-target onClick={() => chooseOperator(null)}><Trash2 />{intl("components_pages_ManualSchedulePage.clearSlot")}</Button>
              </div>
            ) : null}

            {picker?.kind === "poster-hanger" ? (
              <div className="flex justify-end">
                <Button type="button" variant="destructive" size="sm" className="px-2 text-xs max-sm:min-h-8" onClick={() => chooseOperator(null)}><Trash2 />清空挂件位</Button>
              </div>
            ) : null}

            <div className="mt-1" role="group" aria-label={skillFilters("rarity")}>
              <SkillFilterRow label={skillFilters("rarity")}>
                <OperatorRarityFilter
                  value={pickerRarity === null ? "all" : String(pickerRarity)}
                  onChange={(value) => {
                    setPickerRarity(value === "all" ? null : Number(value));
                    setPickerPage(1);
                  }}
                />
              </SkillFilterRow>
            </div>

            <div className="mt-2 flex justify-end">
              <span className="font-number text-xs text-muted-foreground">{intl("components_pages_ManualSchedulePage.operatorCount", { count: filteredOperators.length })}</span>
            </div>

            <TooltipProvider delay={0} timeout={0}>
              <div ref={pickerResultsRef} className="relative mt-1 grid scroll-mt-2 grid-cols-[repeat(4,var(--manual-picker-portrait-size))] justify-between gap-x-2 gap-y-1 [--manual-picker-portrait-size:56px] min-[430px]:[--manual-picker-portrait-size:64px] sm:grid-cols-[repeat(8,var(--manual-picker-portrait-size))] min-[900px]:[--manual-picker-portrait-size:80px]">
                {visibleOperators.map((operator) => (
                  <ManualOperatorChoice
                    key={operator.id}
                    operator={operator}
                    selected={selectedOperator === operator.name || (picker?.kind === "fiammetta" && fiammettaTarget === operator.name)}
                    assignmentLabel={activeAssignmentRoomByOperator.get(operator.name)}
                    en={en}
                    tooltipDisabled={pickerScrolling}
                    onChoose={() => chooseOperator(operator.name)}
                  />
                ))}
                {Array.from({ length: emptyOperatorChoiceCount }, (_, index) => (
                  <div
                    key={`empty-${index}`}
                    className="invisible min-h-[calc(var(--manual-picker-portrait-size)+2.5rem)]"
                    aria-hidden="true"
                    data-manual-operator-placeholder
                  />
                ))}
                {visibleOperators.length === 0 ? <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-sm text-muted-foreground">{intl("components_pages_ManualSchedulePage.noMatchingOperators")}</p> : null}
              </div>
            </TooltipProvider>

            <div className="mt-4 border-t border-border/60 pt-3">
              <Pagination page={pickerPage} pageCount={pickerPageCount} onPageChange={changePickerPage} alwaysVisible />
            </div>
          </DialogBody>
          </ScrollArea>
          </SkeletonSuspense>
        </DialogContent>
      </Dialog>

      <Dialog open={dormBatchOpen} onOpenChange={setDormBatchOpen}>
        <DialogContent className="grid max-h-[min(900px,calc(100svh-1rem))] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:w-[calc(100vw-2rem)] sm:max-w-[min(960px,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>{intl("components_pages_ManualSchedulePage.dormBatchEditTitle")}</DialogTitle>
            <DialogDescription>
              {intl("components_pages_ManualSchedulePage.dormBatchDescription", { capacity: dormBatchCapacity })}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="min-h-0" viewportClassName="overflow-x-hidden">
            <DialogBody className="block pt-1 pb-5 sm:pb-6">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0 flex-1 basis-48">
                  <OperatorSearch
                    autoFocus
                    value={pickerQuery}
                    label={intl("components_pages_ManualSchedulePage.searchAvailableOperators")}
                    placeholder={intl("components_pages_ManualSchedulePage.searchOperatorSkillOrEffect")}
                    onChange={(value) => { setPickerQuery(value); setPickerPage(1); }}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2" data-dorm-selection-actions>
                  <span className="font-number text-xs text-muted-foreground">
                    {intl("components_pages_ManualSchedulePage.dormBatchSelected", { count: dormBatchSelection.length, capacity: dormBatchCapacity })}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant={dormRestOnly ? "secondary" : "outline"}
                    disabled={activeShift === 0}
                    aria-pressed={dormRestOnly}
                    title={intl("components_pages_ManualSchedulePage.restRequiredDescription")}
                    onClick={() => {
                      if (activeShift === 0) return;
                      setDormRestOnly((current) => !current);
                      setPickerPage(1);
                    }}
                  >
                    {intl("components_pages_ManualSchedulePage.restRequired")}
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={!dormRestOnly || dormFilteredOperators.length === 0} onClick={selectAllDormRestOperators}>
                    {intl("components_pages_ManualSchedulePage.selectAll")}
                  </Button>
                </div>
              </div>
              <div className="mb-2">
                <SkillFilterRow label={skillFilters("room")}>
                  <SkillRoomTagBar selected={pickerRoomFilter} onChange={changePickerRoomFilter} />
                </SkillFilterRow>
              </div>
              <div className="mb-2">
                <SkillFilterRow label={skillFilters("tag")}>
                  {availableSkillTags.length > 0
                    ? <SkillTagBar tags={availableSkillTags} selected={pickerSkillTag} onChange={changePickerSkillTag} />
                    : <div className="flex min-h-7 items-center text-xs text-muted-foreground">{intl("components_pages_ManualSchedulePage.noSkillTagsAvailable")}</div>}
                </SkillFilterRow>
              </div>
              <SkillFilterRow label={skillFilters("rarity")}>
                <OperatorRarityFilter
                  value={pickerRarity === null ? "all" : String(pickerRarity)}
                  onChange={(value) => { setPickerRarity(value === "all" ? null : Number(value)); setPickerPage(1); }}
                />
              </SkillFilterRow>
              <TooltipProvider delay={0} timeout={0}>
                <div data-dorm-operator-grid className="relative mt-3 grid grid-cols-4 grid-rows-3 gap-x-2 gap-y-2 [--manual-picker-portrait-size:56px] min-[430px]:[--manual-picker-portrait-size:64px] md:grid-cols-8 min-[900px]:[--manual-picker-portrait-size:80px]">
                  {dormVisibleOperators.map((operator) => (
                    <ManualOperatorChoice
                      key={operator.id}
                      operator={operator}
                      selected={dormBatchSelection.includes(operator.name)}
                      selectionNumber={dormBatchSelection.indexOf(operator.name) + 1 || undefined}
                      assignmentLabel={dormBatchSelection.includes(operator.name) ? intl("components_pages_ManualSchedulePage.selected") : undefined}
                      en={en}
                      tooltipDisabled={pickerScrolling}
                      onChoose={() => toggleDormBatchOperator(operator.name)}
                    />
                  ))}
                  {Array.from({ length: dormPickerPageSize - dormVisibleOperators.length }, (_, index) => (
                    <div key={`empty-dorm-${index}`} className="invisible min-h-[calc(var(--manual-picker-portrait-size)+2.5rem)]" aria-hidden="true" />
                  ))}
                  {dormVisibleOperators.length === 0 ? <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-sm text-muted-foreground">{intl("components_pages_ManualSchedulePage.noMatchingOperators")}</p> : null}
                </div>
              </TooltipProvider>
              <div className="mt-4 border-t border-border/60 pt-3">
                <Pagination page={dormPickerPage} pageCount={dormPickerPageCount} onPageChange={changePickerPage} alwaysVisible />
              </div>
            </DialogBody>
          </ScrollArea>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDormBatchOpen(false)}>{intl("components_pages_ManualSchedulePage.cancel")}</Button>
            <Button type="button" onClick={applyDormBatch}>{intl("components_pages_ManualSchedulePage.applyDormBatch")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {maaImportPreview && <Suspense fallback={null}><MaaImportDialog maaImportPreview={maaImportPreview} confirmMaaImport={confirmMaaImport} onCancel={() => setMaaImportPreview(null)} finalFocus={maaImportReturnFocus} /></Suspense>}

      <Dialog open={showMower && mowerExportOpen} onOpenChange={setMowerExportOpen}>
        <DialogContent className="max-w-[min(520px,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>{intl("components_pages_ManualSchedulePage.mowerExportQuestion")}</DialogTitle>
            <DialogDescription>{intl("components_pages_ManualSchedulePage.mowerExportDetails", { shift: activeShift + 1 })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setMowerExportOpen(false)}>{intl("components_pages_ManualSchedulePage.cancel")}</Button>
            <Button type="button" onClick={() => {
              try {
                downloadJson("plan.json", maaToMowerPlan(maa, activeShift));
                setMaaImportError(null);
              } catch {
                setMaaImportError(intl("components_pages_ManualSchedulePage.mowerExportFailed"));
              }
              setMowerExportOpen(false);
            }}><Download />{intl("components_pages_ManualSchedulePage.exportMower")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(pendingMove)} onOpenChange={(open) => { if (!open) setPendingMove(null); }}>
        <DialogContent className="max-w-[min(480px,calc(100vw-2rem))]">
          <DialogHeader><DialogTitle>{intl("components_pages_ManualSchedulePage.moveThisOperator")}</DialogTitle><DialogDescription>{intl("components_pages_ManualSchedulePage.isAlreadyAssignedToMoveThemToAndLeave", { value1: (en) ? (pendingMove?.operator ?? intl("components_pages_ManualSchedulePage.thisOperator")) : "", previousRoomTitle: previousRoomTitle, nextRoomTitle: nextRoomTitle, value4: (en) ? "" : (pendingMove?.operator ?? intl("components_pages_ManualSchedulePage.thisOperator")) })}</DialogDescription></DialogHeader>
          <DialogFooter><Button type="button" variant="ghost" onClick={() => setPendingMove(null)}>{intl("components_pages_ManualSchedulePage.cancel")}</Button><Button type="button" onClick={confirmMove}>{intl("components_pages_ManualSchedulePage.moveOperator")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
