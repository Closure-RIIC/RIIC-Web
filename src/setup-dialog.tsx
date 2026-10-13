"use client";
import { localize as localize_setup_dialog } from "./i18n/helpers/setup_dialog.ts";
import { useTranslations, useLocale } from "next-intl";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Check, Database, ExternalLink, FileJson, ListChecks, Play, ScanLine, Trash2, Upload } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { SetupActionButton } from "@/components/setup/SetupActionButton";
import { ManualShiftStartStepper, ManualShiftTimeline } from "@/components/setup/ManualShiftTimeline";
import { SetupStepper } from "@/components/setup/SetupStepper";
import { RotationSettings } from "@/components/RotationSettings";
import { FiammettaSettings } from "@/components/FiammettaSettings";
import { WizardSteps } from "@/components/interior/wizard-steps";
import { useWebsiteSession } from "@/website-session";

import {
  resizeManualShiftDurations,
  snapManualShiftDurationsToHours,
  type ManualScheduleMode,
} from "@/manual-schedule";
import { DEFAULT_MANUAL_SHIFT_START_TIME, MAX_MANUAL_SETUP_SHIFT_COUNT } from "@/manual-schedule-config";

import type { FactoryRecipe, PowerBudget, TradeOrder } from "./blueprint";
import { FileUploadDialog } from "@/components/FileUploadDialog";
import { messageRecord } from "@/i18n/translate";
import { LayoutEditor, PresetSelector } from "./components";
import { countOwned } from "./operbox";
import type { SetupStep } from "./onboarding";
import type { BaseBlueprint, BoxSource, DisplayError, OperBoxEntry, PresetDef, RotationProfile, SklandScheduleSnapshot } from "./types";

import type { MaaIssue } from "./maa-review";

const CLIENT_SKLAND_ENABLED = process.env.APP_CLIENT_SKLAND_ENABLED === "1";
const ManualOperboxPicker = lazy(() => import("@/components/setup/ManualOperboxPicker").then((module) => ({ default: module.ManualOperboxPicker })));

const SETUP_STEP_ORDER: SetupStep[] = ["box", "layout", "facilities"];
const PANEL_TRANSITION = { type: "spring", stiffness: 420, damping: 38, mass: 0.55 } as const;
type OperatorInputMode = "skland" | "maa" | "manual";

type SetupDialogProps = {
  mode?: "calculator" | "manual";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operbox: OperBoxEntry[] | null;
  boxSource: BoxSource;
  fileName: string | null;
  inputMode: OperatorInputMode;
  onInputModeChange: (mode: OperatorInputMode) => void;
  maaPaste: string;
  onMaaPasteChange: (value: string) => void;
  inputError: string | null;
  resultClearWarningDismissed: boolean;
  sklandSnapshot?: SklandScheduleSnapshot | null;
  sklandBindingCount?: number;
  sklandConfigured?: boolean;
  sklandDisabledReason?: string | null;
  onOpenSkland?: () => void;
  onUseSklandSnapshot?: () => void;
  onMaaFile: (file: File, signal?: AbortSignal) => Promise<void>;
  onMaaPaste: () => Promise<boolean>;
  onManualBox: (entries: OperBoxEntry[]) => void;
  onRequireWebsiteAccount: () => void;
  presets: PresetDef[];
  preset: PresetDef;
  layout: BaseBlueprint;
  configurationKey: string;
  rotationProfile: RotationProfile;
  onRotationProfileChange: (value: RotationProfile) => void;
  manualShiftDurations?: number[];
  onManualShiftDurationsChange?: (durations: number[]) => void;
  manualShiftStartTime?: string;
  onManualShiftStartTimeChange?: (startTime: string) => void;
  manualScheduleMode?: ManualScheduleMode;
  onManualScheduleModeChange?: (mode: ManualScheduleMode) => void;
  fiammettaEnabled: boolean;
  onFiammettaEnabledChange: (enabled: boolean) => void;
  onPresetSelect: (preset: PresetDef) => void;
  onLayoutFile: (file: File, signal?: AbortSignal) => Promise<void>;
  onDownloadLayout: () => void;
  onRestoreResultClearWarning: () => void;
  storageNotice: DisplayError | null;
  onClearLocalData: () => void;
  onFactoryRecipeChange: (roomId: string, recipe: FactoryRecipe) => void;
  onTradeOrderChange: (roomId: string, order: TradeOrder) => void;
  onRoomLevelChange: (roomId: string, level: number) => void;
  powerBudget: PowerBudget;
  onFinish: () => void;
  onSkip: () => void;
};

function sourceLabel(source: BoxSource, en: boolean): string {
  if (CLIENT_SKLAND_ENABLED && source === "skland") return localize_setup_dialog.text(en, "skland");
  if (source === "maa") return localize_setup_dialog.text(en, "maaImport");
  return localize_setup_dialog.text(en, "243FullE2Sample");
}

function formatSyncTime(timestamp: number | null | undefined, en: boolean): string {
  const date = timestamp && Number.isFinite(timestamp) ? new Date(timestamp * 1000) : null;
  if (!date || Number.isNaN(date.getTime())) return localize_setup_dialog.text(en, "notSynced");
  return new Intl.DateTimeFormat((en ? "en-US" : "zh-CN"), { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function SetupDialog({
  mode = "calculator",
  open,
  onOpenChange,
  operbox,
  boxSource,
  fileName,
  inputMode,
  onInputModeChange,
  maaPaste,
  onMaaPasteChange,
  inputError,
  resultClearWarningDismissed,
  sklandSnapshot,
  sklandBindingCount = 0,
  sklandConfigured,
  sklandDisabledReason,
  onOpenSkland,
  onUseSklandSnapshot,
  onMaaFile,
  onMaaPaste,
  onManualBox,
  onRequireWebsiteAccount,
  presets,
  preset,
  layout,
  configurationKey,
  rotationProfile,
  onRotationProfileChange,
  manualShiftDurations = [12, 6, 6],
  onManualShiftDurationsChange,
  manualShiftStartTime = DEFAULT_MANUAL_SHIFT_START_TIME,
  onManualShiftStartTimeChange,
  manualScheduleMode = "sequential",
  onManualScheduleModeChange,
  fiammettaEnabled,
  onFiammettaEnabledChange,
  onPresetSelect,
  onLayoutFile,
  onDownloadLayout,
  onRestoreResultClearWarning,
  storageNotice,
  onClearLocalData,
  onFactoryRecipeChange,
  onTradeOrderChange,
  onRoomLevelChange,
  powerBudget,
  onFinish,
  onSkip,
}: SetupDialogProps) {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale === "en";
  const { data: websiteSession } = useWebsiteSession();
  const [maaReview, setMaaReview] = useState<{ rows: Record<string, unknown>[]; issues: MaaIssue[]; name: string } | null>(null);
  const [maaChoices, setMaaChoices] = useState<Record<number, number>>({});
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const maaReviewRef = useRef<HTMLElement>(null);
  const importedOwnedCount = operbox?.filter((entry) => entry.own).length ?? 0;
  async function stageMaaReview(text: string, name: string, signal?: AbortSignal) {
    try {
      const { inspectMaaProgress, normalizeMaaRarities } = await import("./maa-review");
      const rows = normalizeMaaRarities(JSON.parse(text));
      if (!Array.isArray(rows)) return false;
      const issues = inspectMaaProgress(rows);
      signal?.throwIfAborted();
      setMaaReview(null);
      setMaaChoices({});
      setReviewError(null);
      if (!issues.length) return false;
      setMaaReview({ rows, issues, name });
      return true;
    } catch { return false; }
  }
  async function confirmMaaReview() {
    if (!maaReview || maaReview.issues.some(issue => maaChoices[issue.index] === undefined)) return;
    setReviewBusy(true);
    try {
      const rows = maaReview.rows.map((row, index) => {
        const issue = maaReview.issues.find(item => item.index === index);
        if (!issue) return row;
        const { own, elite, level } = issue.choices[maaChoices[index]];
        return { ...row, rarity: issue.rarity, own, elite, level };
      });
      await onMaaFile(new File([JSON.stringify(rows)], maaReview.name, { type: "application/json" }));
      setMaaReview(null);
      setNeedsFacilityReview(true);
      setShowImportOptions(false);
      goToBasics();
    } catch (error) { setReviewError(error instanceof Error ? error.message : String(error)); }
    finally { setReviewBusy(false); }
  }
  function applyRecommendedMaaChoices() {
    if (!maaReview) return;
    setMaaChoices(Object.fromEntries(maaReview.issues.map((issue) => {
      const inferred = issue.choices.findIndex((choice) => choice.label.includes("可能漏识别"));
      const fallback = issue.choices.reduce((best, choice, index) => choice.own && (!issue.choices[best].own || choice.elite > issue.choices[best].elite || (choice.elite === issue.choices[best].elite && choice.level > issue.choices[best].level)) ? index : best, 0);
      return [issue.index, inferred >= 0 ? inferred : fallback];
    })));
  }
  const [step, setStep] = useState<SetupStep>("box");
  const [stepDirection, setStepDirection] = useState(0);
  const [needsFacilityReview, setNeedsFacilityReview] = useState(false);
  const [showImportOptions, setShowImportOptions] = useState(false);
  const [showMaaPaste, setShowMaaPaste] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [openingConfigurationKey, setOpeningConfigurationKey] = useState(configurationKey);
  const wasOpenRef = useRef(false);
  const pendingExternalReviewRef = useRef(false);
  const boxPanelRef = useRef<HTMLDivElement>(null);
  const basicsPanelRef = useRef<HTMLDivElement>(null);
  const facilitiesPanelRef = useRef<HTMLDivElement>(null);
  const hasBox = Boolean(operbox?.length);
  const ownedCount = countOwned(operbox);
  const mustReviewFacilities = needsFacilityReview || !powerBudget.ok;
  const persistedDataLabel = fileName || sourceLabel(boxSource, en);
  const currentDataLabel = CLIENT_SKLAND_ENABLED && boxSource === "skland" && !sklandSnapshot
    ? (intl("setup_dialog.lastSyncedSklandData"))
    : en && persistedDataLabel === "243 全精二示例"
      ? "243 full E2 sample"
      : persistedDataLabel;
  const reducedMotion = useReducedMotion();

  function updateManualShiftCount(count: number) {
    if (!onManualShiftDurationsChange) return;
    const next = resizeManualShiftDurations(manualShiftDurations, Math.min(count, MAX_MANUAL_SETUP_SHIFT_COUNT));
    onManualShiftDurationsChange(manualScheduleMode === "period" ? snapManualShiftDurationsToHours(next) : next);
  }

  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!justOpened) return;
    setStep("box");
    setStepDirection(0);
    setNeedsFacilityReview(pendingExternalReviewRef.current);
    pendingExternalReviewRef.current = false;
    setShowImportOptions(!hasBox);
    setShowMaaPaste(false);
    setOpeningConfigurationKey(configurationKey);
  }, [configurationKey, hasBox, open]);

  const configurationChanged = open && openingConfigurationKey !== configurationKey;

  useEffect(() => {
    if (open && !hasBox) setShowImportOptions(true);
  }, [hasBox, open]);

  function focusPanel(ref: { current: HTMLDivElement | null }) {
    window.requestAnimationFrame(() => ref.current?.focus());
  }

  function moveToStep(nextStep: SetupStep) {
    setStepDirection(SETUP_STEP_ORDER.indexOf(nextStep) - SETUP_STEP_ORDER.indexOf(step));
    setStep(nextStep);
  }

  function goToBox() {
    moveToStep("box");
    focusPanel(boxPanelRef);
  }

  function goToBasics() {
    moveToStep("layout");
    focusPanel(basicsPanelRef);
  }

  function reviewFacilities() {
    moveToStep("facilities");
    setNeedsFacilityReview(false);
    focusPanel(facilitiesPanelRef);
  }

  async function importMaaFile(file: File, signal: AbortSignal) {
    if (!websiteSession) {
      onRequireWebsiteAccount();
      return;
    }
    if (!/\.xlsx?$/i.test(file.name) && await stageMaaReview(await file.text(), file.name, signal)) return;
    signal.throwIfAborted();
    await onMaaFile(file, signal);
    setMaaReview(null);
    setNeedsFacilityReview(true);
    setShowImportOptions(false);
    goToBasics();
  }

  async function importMaaPaste() {
    if (!websiteSession) {
      onRequireWebsiteAccount();
      return;
    }
    if (await stageMaaReview(maaPaste, "MAA-reviewed-box.json")) return;
    if (await onMaaPaste()) {
      setNeedsFacilityReview(true);
      setShowImportOptions(false);
      goToBasics();
    }
  }

  function applyManualBox(entries: OperBoxEntry[]) {
    if (!websiteSession) {
      onRequireWebsiteAccount();
      return;
    }
    onManualBox(entries);
    setNeedsFacilityReview(true);
    setShowImportOptions(false);
    goToBasics();
  }

  function handlePresetSelect(nextPreset: PresetDef) {
    if (nextPreset.label !== preset.label) setNeedsFacilityReview(true);
    onPresetSelect(nextPreset);
  }

  async function handleLayoutFile(file: File, signal: AbortSignal) {
    await onLayoutFile(file, signal);
    setNeedsFacilityReview(true);
  }

  function handleOpenSkland() {
    if (!websiteSession) {
      onRequireWebsiteAccount();
      return;
    }
    pendingExternalReviewRef.current = true;
    onOpenSkland?.();
  }

  function handleUseSklandSnapshot() {
    if (!sklandSnapshot) return;
    onUseSklandSnapshot?.();
    setNeedsFacilityReview(true);
    setShowImportOptions(false);
    goToBasics();
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen && configurationChanged) {
        setCloseConfirmOpen(true);
        return;
      }
      onOpenChange(nextOpen);
    }}>
      <DialogContent fromSkeleton data-setup-dialog className="h-[min(720px,calc(100dvh-1rem))] max-w-[calc(100%-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[24px] p-0 sm:max-w-[min(960px,calc(100%-2rem))] sm:rounded-[32px]">
        <Tabs
          value={step === "facilities" ? "layout" : step}
          onValueChange={(value) => {
            if (value === "box") moveToStep("box");
            if (value === "layout" && hasBox) {
              moveToStep("layout");
            }
          }}
          className="contents"
        >
          <div data-setup-top className="px-4 pb-3 pt-4 sm:px-7 sm:pb-4 sm:pt-6">
            <div className="flex min-h-9 items-center gap-3 pr-12">
              <DialogTitle>{intl("setup_dialog.scheduleSettings")}</DialogTitle>
              {configurationChanged ? <span className="border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">{intl("setup_dialog.modified")}</span> : null}
            </div>
            <WizardSteps
              steps={[
                { id: "box", label: intl("setup_dialog.operatorData") },
                { id: "layout", label: intl("setup_dialog.layout") },
                { id: "facilities", label: intl("setup_dialog.facilities") },
              ]}
              value={step}
              onValueChange={(value) => {
                if (value === "box") goToBox();
                if (value === "layout" && hasBox) goToBasics();
                if (value === "facilities" && hasBox) reviewFacilities();
              }}
              className="mt-3"
            />
          </div>

          <TabsContent value="box" className="min-h-0 overflow-hidden overscroll-contain">
            <ScrollArea className="h-full" viewportClassName="overflow-x-hidden">
              <motion.div
                key={`box-${step}`}
                ref={boxPanelRef}
                data-setup-box-content
                role="region"
                aria-label={intl("setup_dialog.operatorData")}
                tabIndex={-1}
                className="grid w-full min-w-0 grid-cols-1 gap-4 px-4 py-4 outline-none sm:px-7 sm:py-6"
                initial={reducedMotion ? false : { x: stepDirection * 28, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={reducedMotion ? { duration: 0 } : PANEL_TRANSITION}
              >
                {hasBox ? (
                  <section className="setup-data-summary flex min-w-0 items-center justify-between gap-4 px-4 py-3.5" aria-labelledby="setup-current-data-title">
                    <div className="flex min-w-0 items-center gap-3">
                      <Database className="size-4 shrink-0 text-primary" aria-hidden="true" />
                      <div className="min-w-0">
                        <h3 id="setup-current-data-title" className="font-number truncate text-sm font-semibold">{currentDataLabel}</h3>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {intl.rich("setup_dialog.rich1", { element1: (chunks) => (<span className="font-number">{chunks}</span>), value2: () => (operbox?.length ?? 0), value3: () => (ownedCount) })}
                        </p>
                      </div>
                    </div>
                    <SetupActionButton
                      type="button"
                      className="shrink-0"
                      aria-expanded={showImportOptions}
                      aria-controls="setup-import-options"
                      onClick={() => setShowImportOptions((current) => !current)}
                    >
                      {showImportOptions ? (intl("setup_dialog.collapse")) : (intl("setup_dialog.change"))}
                    </SetupActionButton>
                  </section>
                ) : null}

                {showImportOptions ? (
                  <section id="setup-import-options" className="setup-config-panel p-4 sm:p-5" aria-labelledby="setup-import-title">
                    <h3 id="setup-import-title" className="sr-only">{intl("setup_dialog.chooseOperatorDataSource")}</h3>
                    <Tabs
                      value={!CLIENT_SKLAND_ENABLED && inputMode === "skland" ? "maa" : inputMode}
                      onValueChange={(value) => onInputModeChange(value as OperatorInputMode)}
                    >
                      <TabsList
                        className={`grid h-auto w-full rounded-[4px] ${CLIENT_SKLAND_ENABLED ? "grid-cols-3" : "grid-cols-2"} sm:w-auto`}
                        aria-label={intl("setup_dialog.operatorDataSource")}
                      >
                        {CLIENT_SKLAND_ENABLED ? <TabsTrigger value="skland" className="rounded-[4px]"><Database />{intl("setup_dialog.skland")}</TabsTrigger> : null}
                        <TabsTrigger value="maa" className="rounded-[4px]"><FileJson />MAA</TabsTrigger>
                        <TabsTrigger value="manual" className="rounded-[4px]"><ListChecks />{intl("setup_dialog.manual")}</TabsTrigger>
                      </TabsList>
                      {CLIENT_SKLAND_ENABLED ? <TabsContent value="skland" className="pt-4">
                        <div className="setup-import-action flex flex-wrap items-center justify-between gap-4 px-4 py-4">
                          <div className="min-w-0">
                            <strong className="block truncate text-sm">
                              {sklandSnapshot
                                ? sklandSnapshot.roles.find((role) => role.isDefault)?.nickname
                                  ?? sklandSnapshot.roles[0]?.nickname
                                  ?? (intl("setup_dialog.sklandSync"))
                                : (intl("setup_dialog.sklandSync"))}
                            </strong>
                            {sklandSnapshot ? (
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                <span className="font-number">{sklandSnapshot.operbox.length}</span> {intl("setup_dialog.operators")} · <span className="font-number">{formatSyncTime(sklandSnapshot.infrastructure.storeTs, en)}</span>
                              </span>
                            ) : !sklandConfigured && sklandDisabledReason ? (
                              <span className="mt-0.5 block text-xs text-muted-foreground">{sklandDisabledReason}</span>
                            ) : sklandBindingCount > 0 ? (
                              <span className="mt-0.5 block text-xs text-muted-foreground">{intl("setup_dialog.theWebsiteAccountIsLinkedThisBrowserNeedsAuthorization")}</span>
                            ) : null}
                          </div>
                          {sklandSnapshot && boxSource !== "skland" ? (
                            <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
                              <Button type="button" variant="ghost" className="h-11" onClick={handleOpenSkland}>
                                {intl("setup_dialog.syncAgain")}
                              </Button>
                              <Button type="button" className="h-11" onClick={handleUseSklandSnapshot}>
                                {intl("setup_dialog.useSklandData")}
                              </Button>
                            </div>
                          ) : (
                            <Button type="button" className="h-11 w-full sm:w-auto" onClick={handleOpenSkland}>
                              <ScanLine />{intl("setup_dialog.openSklandSync")}
                            </Button>
                          )}
                        </div>
                        {sklandSnapshot?.warnings.length ? (
                          <ul className="mt-3 grid gap-1 text-xs text-amber-700" role="status">
                            {sklandSnapshot.warnings.map((warning) => <li key={warning}>· {warning}</li>)}
                          </ul>
                        ) : null}
                      </TabsContent> : null}
                      <TabsContent value="maa" className="grid gap-3 pt-4">
                        <a
                          href="/help/beginner#maa-box-video"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-11 w-fit items-center gap-2 rounded-[4px] px-2 text-sm font-medium underline underline-offset-4 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Play className="size-4 shrink-0" aria-hidden="true" />
                          {en ? "How to get box.json with MAA · Video tutorial" : "如何用 MAA 获取 box.json · 视频教程"}
                          <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                          <span className="sr-only">{en ? " (opens in a new tab)" : "（新标签页打开）"}</span>
                        </a>
                        {!websiteSession ? (
                          <Alert>
                            <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <span>{intl("setup_dialog.maaImportRequiresAVerifiedWebsiteAccountTheFull")}</span>
                              <Button type="button" size="sm" className="min-h-11 shrink-0" onClick={onRequireWebsiteAccount}>
                                {intl("setup_dialog.signInToImport")}
                              </Button>
                            </AlertDescription>
                          </Alert>
                        ) : (
                          <>
                            <FileUploadDialog
                              title={intl("FileUpload.rosterTitle")}
                              description={intl("FileUpload.rosterDescription")}
                              extensions={[".json", ".xlsx", ".xls"]}
                              layer="nested"
                              successFocus={() => maaReviewRef.current ?? basicsPanelRef.current ?? false}
                              trigger={<SetupActionButton type="button" className="w-full"><Upload />{intl("components.uploadRosterJsonXlsx")}</SetupActionButton>}
                              onFiles={([file], signal) => importMaaFile(file, signal)}
                            >
                              <div className="flex flex-wrap gap-1.5 text-xs" role="list" aria-label={intl("components.supportedMaaJsonLanguages")}>
                                {messageRecord(en, "components_labels").map(language => <span key={language} role="listitem" className="rounded-full border border-border bg-muted/70 px-2 py-0.5">{language}</span>)}
                              </div>
                              <p className="text-xs leading-relaxed text-muted-foreground">{intl("components.dropAFileOrChooseOneNamesAreConverted")}</p>
                            </FileUploadDialog>
                            <Button
                              type="button"
                              variant="ghost"
                              className="min-h-11 w-fit"
                              aria-expanded={showMaaPaste}
                              aria-controls="setup-maa-paste"
                              onClick={() => setShowMaaPaste((current) => !current)}
                            >
                              {showMaaPaste ? (intl("setup_dialog.collapseJson")) : (intl("setup_dialog.pasteJson"))}
                            </Button>
                          </>
                        )}
                        {websiteSession && showMaaPaste ? (
                          <div id="setup-maa-paste" className="grid gap-2">
                            <Label htmlFor="setup-maa-json">{intl("setup_dialog.jsonContent")}</Label>
                            <Textarea
                              id="setup-maa-json"
                              value={maaPaste}
                              onChange={(event) => onMaaPasteChange(event.target.value)}
                              placeholder={intl("setup_dialog.pasteTheContentsOfArknightsOperboxExportJson")}
                              className="min-h-28 resize-y rounded-[4px] font-mono text-base sm:text-sm"
                              aria-invalid={Boolean(inputError)}
                              aria-describedby={inputError ? "setup-box-error" : undefined}
                            />
                            <SetupActionButton type="button" className="w-full" disabled={!maaPaste.trim()} onClick={() => void importMaaPaste()}>
                              {intl("setup_dialog.importJson")}
                            </SetupActionButton>
                          </div>
                        ) : null}
                      </TabsContent>
                      <TabsContent value="manual" className="grid min-w-0 grid-cols-1 gap-3 pt-4">
                        {!websiteSession ? (
                          <Alert>
                            <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <span>{intl("setup_dialog.aManuallySelectedBoxIsPersonalDataAndRequires")}</span>
                              <Button type="button" size="sm" className="min-h-11 shrink-0" onClick={onRequireWebsiteAccount}>
                                {intl("setup_dialog.signInToContinue")}
                              </Button>
                            </AlertDescription>
                          </Alert>
                        ) : (
                          <Suspense fallback={<div className="grid min-h-40 place-items-center border border-dashed border-border text-sm text-muted-foreground">{intl("setup_dialog.loadingOperatorRoster")}</div>}>
                            <ManualOperboxPicker
                              compact
                              showProfessionFilter
                              operbox={operbox}
                              title={intl("setup_dialog.buildYourOperatorBox")}
                              description={null}
                              onApply={applyManualBox}
                            />
                          </Suspense>
                        )}
                      </TabsContent>
                    </Tabs>
                    {inputMode === "maa" && maaReview ? (
                      <section ref={maaReviewRef} tabIndex={-1} className="mt-3 grid gap-2.5 rounded-lg border border-amber-500/35 bg-amber-50/60 p-3 outline-none dark:bg-amber-950/15" aria-label="导入异常确认">
                        <div className="flex items-baseline justify-between gap-3"><h3 className="font-semibold">发现 {maaReview.issues.length} 项异常练度</h3><span className="text-xs text-muted-foreground">请选择修正方案</span></div>
                        <p className="text-sm text-muted-foreground">确认后才会导入；取消会保留原来的 Box。</p>
                        <p className="text-xs text-muted-foreground">星级会根据干员数据自动匹配，原 JSON 中填写的星级不一致时将自动修正。</p>
                        {maaReview.issues.map(issue => (
                          <fieldset key={issue.index} className="grid gap-2 rounded-md border bg-background p-2.5">
                            <legend className="px-1 text-sm font-semibold tracking-normal">{issue.name}（{issue.rarity}星）</legend>
                            <p className="text-xs font-medium text-muted-foreground">原始数据：精{String(issue.elite)} · {String(issue.level)}级，超出合法范围</p>
                            <div className="flex flex-wrap gap-1.5" role="group" aria-label={`${issue.name}的修正方案`}>
                              {issue.choices.map((choice, index) => {
                                const selected = maaChoices[issue.index] === index;
                                const color = !choice.own || (choice.elite === 0 && choice.level === 1) ? "#71717A" : choice.elite === 2 ? "#FFD800" : choice.elite === 1 ? "#B8F03A" : "#22BBFF";
                                return (
                                  <Button
                                    key={index}
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    aria-pressed={selected}
                                    disabled={reviewBusy}
                                    onClick={() => setMaaChoices(current => ({ ...current, [issue.index]: index }))}
                                    style={selected ? { backgroundColor: color, borderColor: color } : undefined}
                                    className={`relative h-auto min-h-8 min-w-16 whitespace-normal rounded-[4px] px-2 py-1.5 focus-visible:ring-[#FFD501] focus-visible:ring-offset-2 ${selected ? (!choice.own ? "text-white" : "text-[#202020]") : "border-border bg-background text-muted-foreground hover:border-foreground/45 hover:bg-muted/60 hover:text-foreground"}`}
                                  >
                                    {choice.label}
                                  </Button>
                                );
                              })}
                            </div>
                          </fieldset>
                        ))}
                        {reviewError ? <p role="alert" className="text-sm text-destructive">{reviewError}</p> : null}
                        <div className="flex flex-wrap justify-between gap-2">
                          <SetupActionButton type="button" variant="outline" disabled={reviewBusy} onClick={applyRecommendedMaaChoices}>一键采用推荐方案</SetupActionButton>
                          <div className="flex gap-2">
                          <SetupActionButton type="button" variant="outline" disabled={reviewBusy} onClick={() => setMaaReview(null)}>取消本次导入</SetupActionButton>
                          <SetupActionButton type="button" disabled={reviewBusy || maaReview.issues.some(issue => maaChoices[issue.index] === undefined)} onClick={() => void confirmMaaReview()}>{reviewBusy ? "正在导入…" : "确认选择并导入"}</SetupActionButton>
                          </div>
                        </div>
                      </section>
                    ) : null}
                    {inputError ? <p id="setup-box-error" className="mt-3 text-sm text-destructive" role="alert">{inputError}</p> : null}
                    {inputMode === "maa" && boxSource === "maa" && hasBox && !maaReview && !inputError ? (
                      <p className="mt-3 rounded-md border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300" role="status">
                        MAA Box 已导入 {operbox?.length ?? 0} 名干员，其中已拥有 {importedOwnedCount} 名。
                      </p>
                    ) : null}
                  </section>
                ) : null}

                {storageNotice ? (
                  <Alert className="rounded-lg border-amber-200 bg-amber-50 text-amber-700" role="status">
                    <AlertDescription className="text-amber-700">
                      {storageNotice.message}（{storageNotice.code}）
                    </AlertDescription>
                  </Alert>
                ) : null}

                <details className="setup-quiet-details">
                  <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">{intl("setup_dialog.dataManagement")}</summary>
                  <div className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <span className="text-xs text-muted-foreground">{intl.rich("setup_dialog.rich2", { element1: (chunks) => (<span className="font-number">{chunks}</span>) })}</span>
                    <SetupActionButton type="button" variant="destructive" onClick={() => setClearConfirmOpen(true)}>
                      <Trash2 />{intl("setup_dialog.clearLocalData")}
                    </SetupActionButton>
                  </div>
                </details>
              </motion.div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="layout" className="min-h-0 overflow-hidden overscroll-contain">
            <Tabs
              value={step === "facilities" ? "facilities" : "basics"}
              className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)] gap-0"
            >
              <TabsContent value="basics" className="min-h-0 overflow-hidden">
                <ScrollArea className="h-full" viewportClassName="overflow-x-hidden">
                  <motion.div
                    key={`layout-${step}`}
                    ref={basicsPanelRef}
                    data-setup-layout-basics
                    role="region"
                    aria-label={mode === "manual" ? (intl("setup_dialog.layoutAndShifts")) : (intl("setup_dialog.layoutAndRotations"))}
                    tabIndex={-1}
                    className="grid gap-6 px-4 py-5 outline-none sm:px-7 sm:py-6"
                    initial={reducedMotion ? false : { x: stepDirection * 28, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={reducedMotion ? { duration: 0 } : PANEL_TRANSITION}
                  >
                    <section className="grid gap-3" aria-labelledby="setup-preset-title">
                      <h3 id="setup-preset-title" className="text-sm font-semibold">{intl("setup_dialog.basePresets")}</h3>
                      <PresetSelector presets={presets} selected={preset} onSelect={handlePresetSelect} />
                    </section>

                    <div className="pt-1">
                      {mode === "manual" ? (
                        <section className="grid gap-4" aria-labelledby="manual-shift-settings-title" data-manual-shift-settings>
                          <div>
                            <h3 id="manual-shift-settings-title" className="text-sm font-semibold">{intl("setup_dialog.scheduleMode")}</h3>
                            <Tabs className="mt-2" value={manualScheduleMode} onValueChange={(value) => {
                              if (value === "sequential" || value === "period") onManualScheduleModeChange?.(value);
                            }}>
                              <TabsContent value="sequential" className="text-xs text-muted-foreground">{intl("setup_dialog.sequentialRotationDescription")} {intl("setup_dialog.shiftOrderOnly")}</TabsContent>
                              <TabsContent value="period" className="text-xs text-muted-foreground">{intl("setup_dialog.timeRangesDescription")} {intl("setup_dialog.consecutiveShiftTimes")} {intl("setup_dialog.timelineHint")}</TabsContent>
                              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3" data-manual-mode-toolbar>
                                <TabsList aria-label={intl("setup_dialog.scheduleMode")} className="max-w-full shrink-0 max-sm:w-full">
                                  <TabsTrigger value="sequential" className="max-sm:px-2">{intl("setup_dialog.sequentialRotation")}</TabsTrigger>
                                  <TabsTrigger value="period" className="max-sm:px-2">{intl("setup_dialog.timeRanges")}</TabsTrigger>
                                </TabsList>
                                <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-2" data-manual-shift-controls>
                                  <SetupStepper
                                    label={intl("setup_dialog.shifts")}
                                    value={manualShiftDurations.length}
                                    decreaseLabel={intl("setup_dialog.removeOneShift")}
                                    increaseLabel={intl("setup_dialog.addOneShift")}
                                    decreaseDisabled={!onManualShiftDurationsChange || manualShiftDurations.length <= 1}
                                    increaseDisabled={!onManualShiftDurationsChange || manualShiftDurations.length >= MAX_MANUAL_SETUP_SHIFT_COUNT}
                                    onDecrease={() => updateManualShiftCount(manualShiftDurations.length - 1)}
                                    onIncrease={() => updateManualShiftCount(manualShiftDurations.length + 1)}
                                  />
                                  {manualScheduleMode === "period" ? <ManualShiftStartStepper startTime={manualShiftStartTime} onStartTimeChange={onManualShiftStartTimeChange} /> : null}
                                </div>
                              </div>
                              {manualScheduleMode === "period" ? <ManualShiftTimeline
                                durations={manualShiftDurations}
                                startTime={manualShiftStartTime}
                                onDurationsChange={onManualShiftDurationsChange}
                              /> : null}
                            </Tabs>
                          </div>
                        </section>
                      ) : <RotationSettings value={rotationProfile} onChange={onRotationProfileChange} />}
                    </div>

                    <div className="border-t border-border/70 pt-5">
                      <FiammettaSettings
                        enabled={fiammettaEnabled}
                        operbox={operbox}
                        rotation={rotationProfile}
                        onEnabledChange={onFiammettaEnabledChange}
                        mode={mode}
                      />
                    </div>

                    <details className="setup-quiet-details pt-1">
                      <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">{intl("setup_dialog.advancedTools")}</summary>
                      <div className="grid gap-2 py-3 sm:grid-cols-2">
                        <FileUploadDialog
                          title={intl("setup_dialog.importLayout")}
                          description={intl("FileUpload.layoutDescription")}
                          extensions={[".json"]}
                          layer="nested"
                          trigger={<SetupActionButton type="button" className="w-full"><Upload />{intl("setup_dialog.importLayout")}</SetupActionButton>}
                          onFiles={([file], signal) => handleLayoutFile(file, signal)}
                        />
                        <SetupActionButton type="button" className="w-full" onClick={onDownloadLayout}>
                          <FileJson />{intl("setup_dialog.exportLayout")}
                        </SetupActionButton>
                        {resultClearWarningDismissed ? (
                          <Button type="button" variant="ghost" className="min-h-11 w-fit" onClick={onRestoreResultClearWarning}>
                            {intl("setup_dialog.restoreChangeWarning")}
                          </Button>
                        ) : null}
                      </div>
                    </details>
                    {inputError ? <p id="setup-layout-error" className="text-sm text-destructive" role="alert">{inputError}</p> : null}
                  </motion.div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="facilities" className="min-h-0 overflow-hidden">
                <ScrollArea className="h-full" viewportClassName="overflow-x-hidden">
                  <motion.div
                    key={`facilities-${step}`}
                    ref={facilitiesPanelRef}
                    data-setup-facilities
                    role="region"
                    aria-label={intl("setup_dialog.facilitySettings")}
                    tabIndex={-1}
                    className="px-4 py-5 outline-none sm:px-7 sm:py-6"
                    initial={reducedMotion ? false : { x: stepDirection * 28, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={reducedMotion ? { duration: 0 } : PANEL_TRANSITION}
                  >
                    <LayoutEditor
                      layout={layout}
                      onFactoryRecipeChange={onFactoryRecipeChange}
                      onTradeOrderChange={onTradeOrderChange}
                      onRoomLevelChange={onRoomLevelChange}
                    />
                    {inputError ? <p className="mt-3 text-sm text-destructive" role="alert">{inputError}</p> : null}
                  </motion.div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>

        <footer data-setup-footer className="setup-dialog-footer flex w-full min-w-0 flex-nowrap items-center justify-end gap-1.5 px-4 pb-4 pt-2 sm:gap-2 sm:px-7 sm:pb-7 sm:pt-3">
          {step === "box" ? (
            <>
              <Button className="max-sm:min-w-16 sm:min-w-[88px]" size="dialog" type="button" variant="ghost" onClick={onSkip}>{intl("setup_dialog.later")}</Button>
              <Button
                size="dialog"
                type="button"
                disabled={!hasBox || (showImportOptions && inputMode === "manual")}
                onClick={goToBasics}
              >
                {showImportOptions && inputMode === "manual"
                  ? (intl("setup_dialog.applySelectionFirst"))
                  : (intl("setup_dialog.continue"))}
              </Button>
            </>
          ) : step === "layout" ? (
            <>
              <Button className="max-sm:min-w-16 sm:min-w-[88px]" size="dialog" type="button" variant="ghost" onClick={goToBox}>{intl("setup_dialog.back")}</Button>
              <Button size="dialog" type="button" onClick={reviewFacilities}>
                {mustReviewFacilities ? (intl("setup_dialog.reviewFacilities")) : (intl("setup_dialog.continue"))}
              </Button>
            </>
          ) : (
            <>
              <span
                className={`mr-auto min-w-0 truncate text-left text-xs tabular-nums sm:text-sm ${powerBudget.ok ? "text-emerald-700" : "text-red-600"}`}
                role="status"
              >
                <span className={`sm:hidden ${powerBudget.ok ? "text-emerald-700" : "text-red-600"}`}>
                  {powerBudget.ok ? (intl("setup_dialog.powerOk")) : (intl("setup_dialog.short", { value1: powerBudget.consumed - powerBudget.generated }))}
                </span>
                <span className={`max-sm:hidden ${powerBudget.ok ? "text-emerald-700" : "text-red-600"}`}>
                  {powerBudget.ok
                    ? (intl("setup_dialog.powerOk2", { consumed: powerBudget.consumed, generated: powerBudget.generated }))
                    : (intl("setup_dialog.powerShortfall", { value1: powerBudget.consumed - powerBudget.generated, consumed: powerBudget.consumed, generated: powerBudget.generated }))}
                </span>
              </span>
              <Button className="max-sm:min-w-16 sm:min-w-[88px]" size="dialog" type="button" variant="ghost" onClick={goToBasics}>{intl("setup_dialog.back")}</Button>
              <Button className="shrink-0" size="dialog" type="button" disabled={!powerBudget.ok} onClick={onFinish}><Check />{intl("setup_dialog.done")}</Button>
            </>
          )}
        </footer>
      </DialogContent>

      <Dialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <DialogContent layer="nested" className="max-w-[min(460px,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>{intl("setup_dialog.clearLocalData2")}</DialogTitle>
            <DialogDescription>
              {localize_setup_dialog.text(en, "additional1", { choice1: ((en)) && (CLIENT_SKLAND_ENABLED) ? "yes" : "no", choice2: (!(en)) && (CLIENT_SKLAND_ENABLED) ? "yes" : "no" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button className="max-sm:min-w-16 sm:min-w-[88px]" type="button" size="dialog" variant="ghost" onClick={() => setClearConfirmOpen(false)}>{intl("setup_dialog.keepData")}</Button>
            <Button
              type="button"
              size="dialog"
              variant="destructive"
              onClick={() => {
                onClearLocalData();
                setClearConfirmOpen(false);
              }}
            >
              {intl("setup_dialog.clearLocalData")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{intl("setup_dialog.closeScheduleSettings")}</DialogTitle>
            <DialogDescription>{intl("setup_dialog.changesAreSavedLocallyGenerateTheScheduleAgainTo")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setCloseConfirmOpen(false)}>{intl("setup_dialog.keepEditing")}</Button>
            <Button type="button" onClick={() => { setCloseConfirmOpen(false); onOpenChange(false); }}>{intl("setup_dialog.closeSettings")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
