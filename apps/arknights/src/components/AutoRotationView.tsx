"use client";

import { useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import type { AutoRotationResult } from "@riic/arknights-domain/auto-rotation";
import type { BaseBlueprint } from "@riic/arknights-domain/types";
import type { FactoryRecipe, TradeOrder } from "@riic/arknights-domain/blueprint";
import { autoRotationToRows, type AutoRotationQueue } from "@/auto-rotation-presentation";
import { autoRotationProduction, type AutoRotationDroneOverrides } from "@/auto-rotation-production";
import { operatorPresentationFor } from "@/operatorPortraits";
import { PlanResultSummary } from "@/components/PlanResultSummary";
import { PlanSupportSummary } from "@/components/PlanSupportSummary";
import { DroneTargetPicker } from "@/components/DroneTargetPicker";
import { ScheduleImageExportAction } from "@/components/ScheduleImageExportAction";
import { ScheduleBoard } from "@/components";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { localizedOperatorName, localizedRoomTitle } from "@/i18n/game-data";
import { useGameCatalog } from "@/i18n/game-data-client";

const FALLBACK_WARNING = "可用干员太少，部分设施无法使用有技能的干员，已使用 Fallback 随机补位。";

export function AutoRotationView({ result, layout, eliteByOperator, levelByOperator, searchQuery,
  onFactoryRecipeChange, onTradeOrderChange, viewModeControl, hideImages,
  droneOverrides, onDroneOverridesChange,
}: {
  result: AutoRotationResult;
  layout: BaseBlueprint;
  eliteByOperator?: ReadonlyMap<string, number>;
  levelByOperator?: ReadonlyMap<string, number>;
  searchQuery: string;
  onFactoryRecipeChange: (roomId: string, recipe: FactoryRecipe) => void;
  onTradeOrderChange: (roomId: string, order: TradeOrder) => void;
  viewModeControl: "tabs" | "select";
  hideImages: boolean;
  droneOverrides: AutoRotationDroneOverrides;
  onDroneOverridesChange: (overrides: AutoRotationDroneOverrides) => void;
}) {
  const intl = useTranslations("components_AutoRotationView");
  const calculatorIntl = useTranslations("components_pages_InfraCalculator");
  const locale = useLocale();
  const catalog = useGameCatalog();
  const [queue, setQueue] = useState<AutoRotationQueue>("main");
  const [dronePickerOpen, setDronePickerOpen] = useState(false);
  const containerRef = useRef<HTMLElement>(null);
  const imageExportInFlight = useRef(false);
  const [imageExporting, setImageExporting] = useState(false);
  const [imageExportFailed, setImageExportFailed] = useState(false);
  async function exportQueueImage() {
    if (imageExportInFlight.current) return;
    imageExportInFlight.current = true;
    setImageExporting(true);
    setImageExportFailed(false);
    try {
      const board = containerRef.current?.querySelector<HTMLElement>("[data-plan-board]");
      if (!board) throw new Error("Schedule board is not ready");
      const { downloadScheduleImage } = await import("@/schedule-image");
      await downloadScheduleImage(board, `arknights-infra-auto-queue-${queue}.png`);
    } catch {
      setImageExportFailed(true);
    } finally {
      imageExportInFlight.current = false;
      setImageExporting(false);
    }
  }
  const imageExportAction = <ScheduleImageExportAction disabled={false} exporting={imageExporting} scope="single" onExport={exportQueueImage} />;
  const production = useMemo(() => autoRotationProduction({ result, layout, selectedDroneRooms: droneOverrides }), [result, layout, droneOverrides]);
  const activeQueue = production.queues[queue];
  const automatic = droneOverrides[queue] === undefined;
  const droneTargetRoomId = activeQueue.allocation?.target.roomId ?? null;
  const restoreAutomatic = () => {
    const next = { ...droneOverrides };
    delete next[queue];
    onDroneOverridesChange(next);
  };
  const selectDroneRoom = (roomId: string) => {
    if (activeQueue.candidates.some(candidate => candidate.target.roomId === roomId)) {
      onDroneOverridesChange({ ...droneOverrides, [queue]: droneTargetRoomId === roomId ? null : roomId });
    }
  };
  const fiammettaTarget = result.fiammetta?.enabled && result.fiammetta.available ? result.fiammetta.targets[0]?.target : undefined;
  const fiammettaPortrait = fiammettaTarget ? operatorPresentationFor({ name: fiammettaTarget }).portrait : undefined;
  const rows = useMemo(() => autoRotationToRows(result, layout, queue), [result, layout, queue]);
  const products = useMemo(() => new Map(rows.flatMap(row => row.roomProduct ? [[row.roomId, row.roomProduct] as const] : [])), [rows]);
  const percent = (value: number) => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(value);
  const number = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  const roomName = (roomId: string) => {
    const row = rows.find(row => row.roomId === roomId);
    return row ? localizedRoomTitle(row.title, row.group, locale, catalog) : roomId;
  };

  return <section ref={containerRef} className="grid gap-5" data-auto-rotation-result>
    <header className="grid gap-1">
      <h2 className="text-lg font-semibold">{intl("title", { main: number(result.hours[0]), backup: number(result.hours[1]) })}</h2>
      <p className="text-sm text-muted-foreground">{intl("description")}</p>
      <p className={result.complete ? "text-sm text-muted-foreground" : "text-sm text-amber-700 dark:text-amber-400"} role="status">{intl(result.complete ? "complete" : "incomplete")}</p>
    </header>
    {result.warnings.length ? <ul className="list-disc space-y-1 rounded-lg bg-amber-500/10 p-4 ps-8 text-sm" aria-label={intl("warnings")}>
      {result.warnings.map((warning, index) => <li key={index}>{warning === FALLBACK_WARNING ? intl("fallbackExplanation") : warning}</li>)}
    </ul> : null}
    <div>
      <PlanResultSummary
        layout={layout} activeShift={queue === "main" ? 0 : 1} comparison={null}
        durationMs={result.durationMs} planRevision={result.diagnosticId} animateEntrance={false}
        productionPresentation={production.presentation}
        presentationTitle={intl("summaryTitle", { template: layout.template })}
        presentationSubtitle={intl("summarySubtitle")}
        controlsSlot={<PlanSupportSummary
          drones={activeQueue.allocation ? { enable: true, room: activeQueue.allocation.target.room, index: activeQueue.allocation.target.index } : undefined}
          target={fiammettaTarget} portrait={fiammettaPortrait} automatic={automatic}
          onAutomaticChange={checked => checked ? restoreAutomatic() : onDroneOverridesChange({ ...droneOverrides, [queue]: droneTargetRoomId })}
          onChooseFacility={() => setDronePickerOpen(true)}
        />}
      />
      <p className="text-xs text-muted-foreground">{intl("staticEstimate")}{production.drones !== null ? ` ${intl("dailyDrones", { count: number(production.drones) })}` : ""}</p>
    </div>
    <ScheduleBoard
      rows={rows} layout={layout} planRevision={result.diagnosticId}
      eliteByOperator={eliteByOperator} levelByOperator={levelByOperator}
      activeShift={queue === "main" ? 0 : 1} searchQuery={searchQuery}
      shiftTabsSlot={<Tabs value={queue} onValueChange={value => setQueue(value as AutoRotationQueue)}>
        <TabsList aria-label={intl("queues")}>
          <TabsTrigger value="main" disabled={imageExporting}>{intl("main")}</TabsTrigger>
          <TabsTrigger value="backup" disabled={imageExporting}>{intl("backup")}</TabsTrigger>
        </TabsList>
      </Tabs>}
      roomProducts={products} onFactoryRecipeChange={onFactoryRecipeChange} onTradeOrderChange={onTradeOrderChange}
      droneTargetRoomId={droneTargetRoomId} onDroneTargetChange={automatic ? undefined : row => selectDroneRoom(row.roomId)}
      viewModeControl={viewModeControl} hideImages={hideImages}
      shiftInfoSlot={<div className="hidden md:block">{imageExportAction}</div>}
      mobileActionsSlot={imageExportAction}
      toolbarNoticeSlot={<div className="grid gap-2 text-sm">
        {imageExportFailed ? <p role="alert" className="text-red-700">{calculatorIntl("exportImageFailed")}</p> : null}
        {result.rooms.filter(room => !room[queue].complete || room[queue].missingSeats > 0).map(room => <p key={room.roomId} className="text-amber-700 dark:text-amber-400">{roomName(room.roomId)} · {intl("missing", { count: room[queue].missingSeats })}</p>)}
      </div>}
    />
    {dronePickerOpen ? <DroneTargetPicker
      rows={rows.filter(row => activeQueue.candidates.some(candidate => candidate.target.roomId === row.roomId))}
      targetRoomId={droneTargetRoomId} manualSelection={!automatic}
      onTargetChange={row => selectDroneRoom(row.roomId)} onAutoAllocation={restoreAutomatic} onOpenChange={setDronePickerOpen}
    /> : null}
    <details className="text-sm text-muted-foreground">
      <summary className="cursor-pointer">{intl("details")}</summary>
      <ul className="mt-2 grid gap-1">
        {result.rooms.map(room => {
          const state = room[queue];
          return <li key={room.roomId}>
            {roomName(room.roomId)} · {intl("evaluationHours", { hours: number(state.evaluationHours) })}
            {state.supportSpeedBonusPct !== undefined ? ` · ${intl("support", { value: number(state.supportSpeedBonusPct) })}` : ""}
            {state.recycleEfficiency !== undefined ? ` · ${intl("recycle", { value: percent(state.recycleEfficiency) })}` : ""}
            {state.firstRedFace ? ` · ${intl("firstRedFace", { name: localizedOperatorName(state.firstRedFace, locale, catalog) })}` : ""}
          </li>;
        })}
      </ul>
    </details>
    {result.fiammetta?.enabled ? <p className="text-sm text-muted-foreground">
      {intl("fiammetta")}：{!result.fiammetta.available ? intl("fiammettaUnavailable") : result.fiammetta.targets.map(target => `${localizedOperatorName(target.target, locale, catalog)} (${roomName(target.roomId)})`).join(" / ")}
    </p> : null}
  </section>;
}
