"use client";
import { withDefaultDormAutofill } from "./automatic-dorm-defaults";
import { localize as localize_App } from "./i18n/helpers/App.ts";
import { useTranslations, useLocale } from "next-intl";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useAccountCloudWorkspace } from "account-cloud-workspace-bridge";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { FilingLinks } from "@/components/layout/FilingLinks";
import { AppTopBar, SklandAccountControl } from "@/components/layout/AppTopBar";
import { DotDistortionBackground } from "@/components/layout/DotDistortionBackground";
import { AppMotionProvider } from "@/components/MotionProvider";
import { PrimaryPageTransition } from "@/components/layout/PrimaryPageTransition";
import { SetupDialogSkeleton } from "@/components/setup/SetupDialogSkeleton";
import { WebsiteAccountDialogLoading } from "@/components/auth/WebsiteAccountDialogLoading";
import { LiveActivity, usePlanActivity } from "@/components/ui/live-activity";
import { TooltipProvider } from "@/components/ui/tooltip";
import { trackTelemetry } from "@/lib/telemetry-dispatch";
import { WorkbenchContext } from "@/workbench-context";
import { WORKBENCH_PAGE_PATHS, workbenchHref, workbenchPageFromPathname, type AppPage } from "@/workbench-routes";
import { useWebsiteSession } from "@/website-session";
import { useFeatureAccess } from "@/components/workbench/FeatureAccessProvider";
import { usePlanTask } from "@/hooks/use-plan-task";
import type { SklandTrainingSyncOptions } from "@/hooks/use-skland-training-sync";
import type { TrainingSyncSnapshot } from "@/components/workbench/SklandTrainingSyncBridge";
import { LanguageSwitch } from "@/i18n/client";

import {
  computePlan,
  deleteAllSklandAccountData,
  deleteSklandAccount,
  getHealth,
  getSampleOperbox,
  getSklandAccounts,
  refreshSklandStatus,
  submitPlanTask,
  saveFeedback,
  selectSklandRole,
  toDisplayError,
} from "./api";
import {
  buildBlueprint,
  computePowerBudget,
  FACTORY_RECIPE_OPTIONS,
  FactoryRecipe,
  PRESETS,
  TRADE_ORDER_OPTIONS,
  TradeOrder,
  updateFactoryRecipe,
  updateRoomLevel,
  updateTradeOrder,
} from "./blueprint";
import {
  ONBOARDING_COMPLETED_VALUE,
  ONBOARDING_DISMISSED_VALUE,
  ONBOARDING_STORAGE_KEY,
  resolveOnboardingPreference,
  type OnboardingPreference,
} from "./onboarding";
import { normalizeOperboxEntries } from "./operbox-normalization";
import { droneStoragePlanIndex } from "./drone-plan-mapping";
import { AGENT_BROADCAST_CHANNEL, consumeAgentArtifactHandoff, isAgentArtifactHandoff, receiveAgentArtifactMessage, type AgentArtifactHandoff } from "./agent-artifact-bridge";
import { prepareMaaForExport } from "./maa-safety";
import { upgradeSimulationBoxSource } from "./upgrade-simulation";
import {
  DEFAULT_MANUAL_SHIFT_DURATIONS,
  DEFAULT_MANUAL_SHIFT_START_TIME,
  MANUAL_SCHEDULE_STORAGE_KEY,
  MOOD_STORAGE_KEY,
} from "./manual-schedule-config";
import { type ManualScheduleDraft, type ManualScheduleMode } from "./manual-schedule";
import type { ManualPlanResult } from "./manual-plan-result";
import { clearManualEvaluationCache, persistManualEvaluationCache } from "./manual-evaluation-cache";
import { DEFAULT_USER_SETTINGS, loadUserSettings, persistUserSettings, USER_SETTINGS_CHANGED_EVENT, type UserSettings } from "./user-settings";
import { effectiveFiammettaSetting, resolvePlanPresentationLayout } from "./plan-presentation";
import {
  applyLocalLayoutPatch,
  clearLocalProductData,
  loadPersistedSession,
  persistSession,
  RESULT_CLEAR_WARNING_DISMISSED_KEY,
} from "./persistence";
import type { RoomRow } from "./schedule";
import { DEFAULT_ROTATION_PROFILE, isRotationProfile, rotationDurations } from "./rotation-settings";
import { MOTION_DURATION } from "./motion";
import { emptySklandBindingSummary } from "./skland-binding-state";
import { createSklandRestoreGuard } from "./skland-restore-guard";
import {
  BaseBlueprint,
  BoxSource,
  BlueprintRoom,
  DisplayError,
  FeedbackData,
  FeedbackKind,
  OperBoxEntry,
  MaaJson,
  PublicPlanData,
  PresetDef,
  RotationProfile,
  SavedPlanData,
  ShiftComparison,
  SklandAccountSummary,
  SklandBindingSummary,
  SklandSessionData,
  SklandScheduleSnapshot,
  SklandStatusSnapshot,
} from "./types";

const CLIENT_SKLAND_ENABLED = process.env.APP_CLIENT_SKLAND_ENABLED === "1";
const CLIENT_ACCOUNT_CLOUD_SYNC_ENABLED = process.env.APP_CLIENT_ACCOUNT_CLOUD_SYNC_ENABLED === "1";
const WEBSITE_AUTH_FOCUS_RETURN_DELAY_MS = Math.ceil(MOTION_DURATION.fast * 1_000) + 50;

function bindingSummaryFromSession(session: Pick<SklandSessionData, "accounts" | "bindingCount" | "bindingSummary">): SklandBindingSummary {
  if (session.bindingSummary) return session.bindingSummary;
  const totalCount = Number.isFinite(session.bindingCount) ? session.bindingCount : session.accounts.length;
  const activeCount = session.accounts.length > 0 ? Math.min(totalCount, session.accounts.length) : totalCount;
  const expiries = session.accounts.map((account) => account.credentialExpiresAt).filter(Number.isFinite);
  return {
    totalCount,
    activeCount,
    renewalDueCount: Math.max(0, totalCount - activeCount),
    nextExpiresAt: expiries.length ? Math.min(...expiries) : null,
    latestExpiredAt: null,
  };
}

const loadWebsiteAccountDialog = () => import("@/components/auth/WebsiteAccountDialog");
const loadSetupDialog = () => import("./setup-dialog");
const loadComponents = () => import("./components");
const SklandTrainingSyncBridge = lazy(() => import("@/components/workbench/SklandTrainingSyncBridge"));
const ReleaseAnnouncement = lazy(() => import("@/components/changelog/ReleaseAnnouncement").then((module) => ({
  default: module.ReleaseAnnouncement,
})));

const WebsiteAccountDialog = lazy(() => loadWebsiteAccountDialog().then((module) => ({
  default: module.WebsiteAccountDialog,
})));
const SetupDialog = lazy(() => loadSetupDialog().then((module) => ({ default: module.SetupDialog })));
const IssueNoteModal = lazy(() => import("@/components/ScheduleFeedbackDialogs").then((module) => ({ default: module.IssueNoteModal })));
const ProductChangeConfirmModal = lazy(() => import("@/components/ScheduleFeedbackDialogs").then((module) => ({
  default: module.ProductChangeConfirmModal,
})));
const ManualDraftReplaceDialog = lazy(() => import("@/components/ManualDraftReplaceDialog").then((module) => ({
  default: module.ManualDraftReplaceDialog,
})));
type ProductChange =
  | { type: "factory"; roomId: string; recipe: FactoryRecipe }
  | { type: "trade"; roomId: string; order: TradeOrder };
type WebsiteAuthIntent = "account" | "manual" | "manual-edit" | "run" | "setup" | "skland" | "upgrade" | "mastery";

type SklandFullRestoreResult =
  | { session: SklandSessionData; error?: never }
  | { session?: never; error: unknown };

function layoutWithProductChange(layout: BaseBlueprint, change: ProductChange): BaseBlueprint {
  return change.type === "factory"
    ? updateFactoryRecipe(layout, change.roomId, change.recipe)
    : updateTradeOrder(layout, change.roomId, change.order);
}

function displayError(code: DisplayError["code"], message: string, retryable = false): DisplayError {
  return { code, message, retryable };
}

function resolvePreset(value: PresetDef | undefined): PresetDef {
  return PRESETS.find((preset) => preset.label === value?.label) ?? PRESETS[0];
}

function parseLayoutJson(value: unknown): BaseBlueprint | null {
  if (!value || typeof value !== "object") return null;
  const layout = value as Partial<BaseBlueprint>;
  if (typeof layout.template !== "string" || !Array.isArray(layout.rooms) || !layout.scenario || typeof layout.scenario !== "object") {
    return null;
  }
  const rooms = layout.rooms.map((room) => {
    if (!room || typeof room !== "object" || typeof room.id !== "string" || typeof room.kind !== "string") return null;
    const level = Number((room as BlueprintRoom).level);
    const maxLevel = (room as BlueprintRoom).kind === "control_center" || (room as BlueprintRoom).kind === "dormitory" ? 5 : 3;
    if (!Number.isInteger(level) || level < 1 || level > maxLevel) return null;
    return { ...room, level } as BlueprintRoom;
  });
  if (rooms.some((room) => room === null) || !rooms.some((room) => room?.kind === "control_center")) return null;
  return { ...layout, drone_cap: Number(layout.drone_cap ?? 0), scenario: layout.scenario, rooms: rooms as BlueprintRoom[] } as BaseBlueprint;
}

function layoutValidationError(layout: BaseBlueprint, en = false): string | null {
  if (!layout.rooms.some((room) => room.kind === "control_center")) return localize_App.text(en, "theLayoutMustIncludeAControlCenter");
  const invalid = layout.rooms.find((room) => {
    const maxLevel = room.kind === "control_center" || room.kind === "dormitory" ? 5 : 3;
    return !Number.isInteger(room.level) || room.level < 1 || room.level > maxLevel;
  });
  if (!invalid) return null;
  const maxLevel = invalid.kind === "control_center" || invalid.kind === "dormitory" ? 5 : 3;
  return localize_App.text(en, "sFacilityLevelMustBeBetween1And", { id: invalid.id, maxLevel: maxLevel });
}

function restoreEditableProducts(baseLayout: BaseBlueprint, cachedLayout: BaseBlueprint | undefined): BaseBlueprint {
  if (!cachedLayout) return baseLayout;

  const cachedRooms = new Map(cachedLayout.rooms.map((room) => [room.id, room]));
  return {
    ...baseLayout,
    rooms: baseLayout.rooms.map((room) => {
      const cachedRoom = cachedRooms.get(room.id);
      if (room.kind === "factory" && cachedRoom?.kind === "factory" && cachedRoom.product && "factory" in cachedRoom.product) {
        return {
          ...room,
          level: Number.isFinite(cachedRoom.level) ? cachedRoom.level : room.level,
          product: { factory: { recipe: cachedRoom.product.factory.recipe } },
        };
      }
      if (
        room.kind === "trade_post" &&
        cachedRoom?.kind === "trade_post" &&
        cachedRoom.product &&
        "trade" in cachedRoom.product
      ) {
        return {
          ...room,
          level: Number.isFinite(cachedRoom.level) ? cachedRoom.level : room.level,
          product: { trade: { order: cachedRoom.product.trade.order } },
        };
      }
      return { ...room, level: typeof cachedRoom?.level === "number" ? cachedRoom.level : room.level };
    }),
  };
}

function mergeSklandLayout(current: BaseBlueprint, suggestion: BaseBlueprint): BaseBlueprint {
  return {
    ...suggestion,
    drone_cap: current.drone_cap,
    scenario: structuredClone(current.scenario),
  };
}

function WorkbenchAppContent({ children }: { children: ReactNode }) {
  const intl = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const page = workbenchPageFromPathname(pathname);
  const { data: websiteSession, isPending: websiteSessionPending, refetch: refetchWebsiteSession } = useWebsiteSession();
  const features = useFeatureAccess();
  const defaultPreset = PRESETS[0];
  const defaultLayout = buildBlueprint(defaultPreset);
  const hasRenderedCalculator = useRef(false);
  const revealedPlanRevisions = useRef(new Set<string>());
  const planClickAtRef = useRef<number | null>(null);
  const websiteAuthReturnFocusRef = useRef<HTMLElement | null>(null);
  const websiteAuthIntentRef = useRef<WebsiteAuthIntent | null>(null);
  const [masteryPickerRequested, setMasteryPickerRequested] = useState(false);
  const websiteIntentContinuationRef = useRef<(intent: WebsiteAuthIntent) => void>(() => undefined);
  const websiteAuthFocusReturnTimerRef = useRef<number | null>(null);
  const [websiteAuthReloadKey, setWebsiteAuthReloadKey] = useState(0);
  const [websiteAuthDialogOpen, setWebsiteAuthDialogOpen] = useState(false);
  const [websiteAuthDialogMounted, setWebsiteAuthDialogMounted] = useState(false);
  const [hasRestoredSession, setHasRestoredSession] = useState(false);
  const restoredLocalSession = useRef(false);
  const [onboardingPreference, setOnboardingPreference] = useState<OnboardingPreference>("active");
  const [userSettings, setUserSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS);
  const [preset, setPreset] = useState<PresetDef>(defaultPreset);
  const [layout, setLayout] = useState<BaseBlueprint>(defaultLayout);
  const powerBudget = useMemo(() => computePowerBudget(layout), [layout]);
  const [operbox, setOperboxState] = useState<OperBoxEntry[] | null>(null);
  const currentOperboxRef = useRef<OperBoxEntry[] | null>(operbox);
  const setOperbox = useCallback<Dispatch<SetStateAction<OperBoxEntry[] | null>>>((nextOperbox) => {
    const resolvedOperbox = typeof nextOperbox === "function"
      ? nextOperbox(currentOperboxRef.current)
      : nextOperbox;
    currentOperboxRef.current = resolvedOperbox;
    setOperboxState(resolvedOperbox);
  }, []);
  const [fileName, setFileName] = useState<string | null>(null);
  const [boxSource, setBoxSourceState] = useState<BoxSource>("sample");
  const currentBoxSourceRef = useRef<BoxSource>(boxSource);
  const setBoxSource = useCallback<Dispatch<SetStateAction<BoxSource>>>((nextSource) => {
    const resolvedSource = typeof nextSource === "function"
      ? nextSource(currentBoxSourceRef.current)
      : nextSource;
    currentBoxSourceRef.current = resolvedSource;
    setBoxSourceState(resolvedSource);
  }, []);
  const [layoutDirty, setLayoutDirtyState] = useState(false);
  const currentLayoutDirtyRef = useRef(layoutDirty);
  const setLayoutDirty = useCallback<Dispatch<SetStateAction<boolean>>>((nextDirty) => {
    const resolvedDirty = typeof nextDirty === "function"
      ? nextDirty(currentLayoutDirtyRef.current)
      : nextDirty;
    currentLayoutDirtyRef.current = resolvedDirty;
    setLayoutDirtyState(resolvedDirty);
  }, []);
  const [layoutSource, setLayoutSource] = useState<"local" | "skland">("local");
  const [localLayoutBackup, setLocalLayoutBackup] = useState<BaseBlueprint | null>(null);
  const [rotationProfile, setRotationProfile] = useState<RotationProfile>(DEFAULT_ROTATION_PROFILE);
  const [fiammettaEnabled, setFiammettaEnabled] = useState(false);
  const [manualFiammettaEnabled, setManualFiammettaEnabled] = useState(false);
  const [manualShiftDurations, setManualShiftDurations] = useState<number[]>([...DEFAULT_MANUAL_SHIFT_DURATIONS]);
  const [manualShiftStartTime, setManualShiftStartTime] = useState(DEFAULT_MANUAL_SHIFT_START_TIME);
  const [manualScheduleMode, setManualScheduleMode] = useState<ManualScheduleMode>("sequential");
  const [manualDraftHandoff, setManualDraftHandoff] = useState<ManualScheduleDraft | null>(null);
  const [manualPlanResult, setManualPlanResult] = useState<ManualPlanResult | null>(null);
  const [manualEvaluationPending, setManualEvaluationPending] = useState(false);
  const [pendingManualDraftReplacement, setPendingManualDraftReplacement] = useState<ManualScheduleDraft | null>(null);
  const [inputMode, setInputMode] = useState<"skland" | "maa" | "manual">(CLIENT_SKLAND_ENABLED ? "skland" : "maa");
  const [maaPaste, setMaaPaste] = useState("");
  const [sklandScheduleSnapshot, setSklandScheduleSnapshot] = useState<SklandScheduleSnapshot | null>(null);
  const [sklandStatusSnapshot, setSklandStatusSnapshot] = useState<SklandStatusSnapshot | null>(null);
  const [sklandStatusReloadKey, setSklandStatusReloadKey] = useState(0);
  const [sklandAccounts, setSklandAccounts] = useState<SklandAccountSummary[]>([]);
  const [sklandActiveAccountId, setSklandActiveAccountId] = useState<string | null>(null);
  const [sklandBindingSummary, setSklandBindingSummary] = useState<SklandBindingSummary>(emptySklandBindingSummary);
  const [sklandConfigured, setSklandConfigured] = useState(false);
  const [sklandDisabledReason, setSklandDisabledReason] = useState<string | null>(null);
  const [sklandSessionLoading, setSklandSessionLoading] = useState(false);
  const [sklandError, setSklandError] = useState<DisplayError | null>(null);
  const [sklandBusy, setSklandBusy] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [upgradeSimulationOpen, setUpgradeSimulationOpen] = useState(false);
  const [setupMode, setSetupMode] = useState<"calculator" | "manual">("calculator");
  const [setupMounted, setSetupMounted] = useState(false);
  const [issueModalMounted, setIssueModalMounted] = useState(false);
  const [productModalMounted, setProductModalMounted] = useState(false);
  const initialLayoutForRestore = useRef(defaultLayout);
  const initialBoxSource = useRef(boxSource);
  const initialOperbox = useRef(operbox);
  const initialLayoutSource = useRef<"local" | "skland">("local");
  const initialLocalLayoutBackup = useRef<BaseBlueprint | null>(null);
  const skipNextPersistence = useRef(false);
  const hadPersistedSession = useRef(false);
  const statusLoadingAccount = useRef<string | null>(null);
  const sklandRestoreGuard = useRef(createSklandRestoreGuard());
  const sklandFullRestore = useRef<{
    generation: number;
    reloadKey: number;
    result: Promise<SklandFullRestoreResult>;
  } | null>(null);
  const sklandFullRestorePending = useRef(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [inputErrorCode, setInputErrorCode] = useState<DisplayError["code"]>("AIC-BOX-1101");
  const [sampleLoading, setSampleLoading] = useState(false);
  const sampleTrialInFlightRef = useRef(false);
  const [result, setResult] = useState<PublicPlanData | null>(null);
  const [agentArtifactNotice, setAgentArtifactNotice] = useState<AgentArtifactHandoff | null>(null);
  const [agentArtifactLoading, setAgentArtifactLoading] = useState(false);
  const [agentArtifactApplied, setAgentArtifactApplied] = useState<{ preset: string } | null>(null);
  const [agentArtifactError, setAgentArtifactError] = useState(false);
  const [manualDroneShifts, setManualDroneShifts] = useState<Record<number, boolean>>({});
  const automaticMaaRef = useRef<{ diagnosticId: string; maa: MaaJson } | null>(null);
  const [upgradeComparison, setUpgradeComparison] = useState<{ baseline: PublicPlanData; trial: PublicPlanData } | null>(null);
  const [scheduleVariant, setScheduleVariant] = useState<"baseline" | "trial">("baseline");
  const [loading, setLoading] = useState(false);
  const [progressionAdjustmentActivity, setProgressionAdjustmentActivity] = useState<{
    active: boolean;
    loading: boolean;
    completed: boolean;
    error: DisplayError | null;
    maa?: MaaJson;
  }>({
    active: false,
    loading: false,
    completed: false,
    error: null,
  });
  const [cliReady, setCliReady] = useState(false);
  const [taskQueueEnabled, setTaskQueueEnabled] = useState(false);
  const [apiError, setApiError] = useState<DisplayError | null>(null);
  const [planRetryCountdown, setPlanRetryCountdown] = useState(0);
  const planRetryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [storageNotice, setStorageNotice] = useState<DisplayError | null>(null);
  const [activeShift, setActiveShift] = useState(0);
  const [issueDraftKind, setIssueDraftKind] = useState<FeedbackKind>("room_issue");
  const [issueDraftRow, setIssueDraftRow] = useState<RoomRow | null>(null);
  const [issueDraftNote, setIssueDraftNote] = useState("");
  const [issueOpen, setIssueOpen] = useState(false);
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [feedbackResult, setFeedbackResult] = useState<FeedbackData | null>(null);
  const [resultClearNotice, setResultClearNotice] = useState<string | null>(null);
  const [resultClearWarningDismissed, setResultClearWarningDismissed] = useState(false);
  const [pendingProductChange, setPendingProductChange] = useState<ProductChange | null>(null);

  function clearPlanRetryCooldown() {
    if (planRetryTimerRef.current) {
      clearInterval(planRetryTimerRef.current);
      planRetryTimerRef.current = null;
    }
    setPlanRetryCountdown(0);
  }

  function startPlanRetryCooldown(seconds: number) {
    clearPlanRetryCooldown();
    setPlanRetryCountdown(Math.max(1, Math.ceil(seconds)));
    planRetryTimerRef.current = setInterval(() => {
      setPlanRetryCountdown((current) => {
        if (current <= 1) {
          if (planRetryTimerRef.current) clearInterval(planRetryTimerRef.current);
          planRetryTimerRef.current = null;
          return 0;
        }
        return current - 1;
      });
    }, 1_000);
  }

  useEffect(() => () => {
    if (planRetryTimerRef.current) clearInterval(planRetryTimerRef.current);
  }, []);

  useEffect(() => {
    setUserSettings(loadUserSettings(window.localStorage));
  }, []);

  const planTask = usePlanTask({
    onDone: (rawResult) => {
      const finalizedResult = withDefaultDormAutofill(rawResult);
      setCliReady(true);
      setActiveShift(0);
      automaticMaaRef.current = { diagnosticId: finalizedResult.diagnosticId, maa: structuredClone(finalizedResult.maa) };
      setManualDroneShifts({});
      setResult(finalizedResult);
      setLoading(false);
      completeOnboarding();
      setLayout((current) => resolvePlanPresentationLayout(current, finalizedResult));
      trackTelemetry({ type: "interaction", name: "plan_response", page: "calculator" });
      trackTelemetry({
        type: "performance",
        name: "plan_result",
        page: "calculator",
        durationMs: typeof finalizedResult.durationMs === "number" ? finalizedResult.durationMs : undefined,
      });
    },
    onFailed: (message) => {
      setLoading(false);
      setApiError(displayError("AIC-PLAN-3004", message));
    },
  });
  const progressionAdjustmentTask = usePlanTask({
    // 调整练度依赖尚未同步的本地 BOX，刷新后缺少上下文，不能冒充普通排班恢复。
    storageKey: null,
    onDone: () => undefined,
    onFailed: () => undefined,
  });

  useEffect(() => {
    if (planTask.status === "cancelled") setLoading(false);
  }, [planTask.status]);
  // loading 完全由任务状态推导：提交、刷新恢复、取消都会同步驱动界面。
  useEffect(() => {
    setLoading(Boolean(planTask.taskId));
  }, [planTask.taskId]);

  // 调整练度试算不覆盖原求解结果；两份完整班表在此处切换展示。
  const scheduleResult = scheduleVariant === "trial" && upgradeComparison?.baseline === result
    ? upgradeComparison.trial
    : result;
  useEffect(() => {
    if (upgradeComparison && upgradeComparison.baseline !== result) {
      setUpgradeComparison(null);
      setScheduleVariant("baseline");
    }
  }, [result, upgradeComparison]);
  const activePlan = scheduleResult?.maa.plans?.[activeShift];
  const activeDronePlan = (() => {
    const plans = scheduleResult?.maa.plans ?? [];
    return plans[droneStoragePlanIndex(activeShift, plans.length)];
  })();
  const activeRotationShift = scheduleResult?.rotation.shifts?.[activeShift];
  const activeTrainingRoomShift = scheduleResult?.trainingRoom?.shifts[activeShift];
  const [baseRows, setBaseRows] = useState<RoomRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    void import("./schedule").then(({ planToRows }) => {
      if (!cancelled) setBaseRows(planToRows(activePlan, activeRotationShift, layout, activeTrainingRoomShift));
    });
    return () => { cancelled = true; };
  }, [activePlan, activeRotationShift, activeTrainingRoomShift, layout]);
  const [presentedRows, setPresentedRows] = useState<{ source: RoomRow[]; rows: RoomRow[] } | null>(null);
  useEffect(() => {
    if (!baseRows.some((row) => row.operatorSlots.length > 0)) {
      setPresentedRows(null);
      return;
    }

    let cancelled = false;
    void import("./schedule-presentation")
      .then(({ addOperatorPresentations }) => {
        if (!cancelled) setPresentedRows({ source: baseRows, rows: addOperatorPresentations(baseRows) });
      })
      .catch(() => {
        if (!cancelled) setPresentedRows(null);
      });
    return () => { cancelled = true; };
  }, [baseRows]);
  const rows = presentedRows?.source === baseRows ? presentedRows.rows : baseRows;
  const effectiveFiammettaEnabled = effectiveFiammettaSetting(operbox, rotationProfile, fiammettaEnabled);
  const effectiveManualFiammettaEnabled = Boolean(
    manualFiammettaEnabled && operbox?.some((operator) => operator.own && operator.name === "菲亚梅塔")
  );
  const setupConfigurationKey = useMemo(() => JSON.stringify({
    layout,
    rotationProfile,
    fiammettaEnabled,
  }), [fiammettaEnabled, layout, rotationProfile]);
  const [closestComparison, setClosestComparison] = useState<ShiftComparison | null>(null);
  useEffect(() => {
    const maa = scheduleResult?.maa;
    const infrastructure = sklandScheduleSnapshot?.infrastructure;
    if (!CLIENT_SKLAND_ENABLED || !maa || !infrastructure) {
      setClosestComparison(null);
      return;
    }

    let cancelled = false;
    setClosestComparison(null);
    void import("./skland").then(({ closestShift, compareShifts }) => {
      if (!cancelled) setClosestComparison(closestShift(compareShifts(maa, infrastructure)));
    });
    return () => { cancelled = true; };
  }, [scheduleResult?.maa, sklandScheduleSnapshot?.infrastructure]);
  const sklandLayoutMatches = useMemo(() => {
    if (!CLIENT_SKLAND_ENABLED) return false;
    const suggestion = sklandScheduleSnapshot?.infrastructure.layoutSuggestion;
    if (!suggestion) return false;
    const compact = (value: BaseBlueprint) => value.rooms.map((room) => [room.id, room.kind, room.level, room.product]);
    return JSON.stringify(compact(layout)) === JSON.stringify(compact(suggestion));
  }, [layout, sklandScheduleSnapshot?.infrastructure.layoutSuggestion]);
  const activeSklandAccount = useMemo(
    () => CLIENT_SKLAND_ENABLED
      ? sklandAccounts.find((account) => account.accountId === sklandActiveAccountId) ?? null
      : null,
    [sklandAccounts, sklandActiveAccountId]
  );
  const accountCanUseCurrentBox = boxSource === "sample" || Boolean(websiteSession);
  const hasBox = Boolean(operbox?.length);
  const hasPersonalBox = hasBox && boxSource !== "sample";
  const feedbackDisabledForSampleBox = boxSource === "sample";
  const canRun = Boolean(
    operbox
    && operbox.length > 0
    && cliReady
    && accountCanUseCurrentBox
    && planRetryCountdown === 0
  );
  const sklandBindingCount = sklandBindingSummary.totalCount;
  const sklandTrainingSyncOptions: SklandTrainingSyncOptions = {
    enabled: Boolean(CLIENT_SKLAND_ENABLED && websiteSession?.user.id && boxSource === "skland" && activeSklandAccount && hasRestoredSession),
    active: page === "training",
    blocked: sklandBusy || sklandSessionLoading || loading || Boolean(planTask.taskId) || progressionAdjustmentActivity.loading || setupOpen,
    identity: `${websiteSession?.user.id}:${activeSklandAccount?.accountId}:${activeSklandAccount?.selectedUid}`,
    accountId: activeSklandAccount?.accountId ?? "",
    uid: activeSklandAccount?.selectedUid ?? "",
    layout,
    operbox: operbox ?? [],
    rotation: rotationProfile,
    fiammettaEnabled,
    resultId: result?.diagnosticId ?? null,
    taskQueueEnabled,
    failureMessage: intl("components_pages_TrainingAdvice.syncFailed"),
    onSynced: (session) => {
      // Refresh progression without replacing the user's layout or existing schedule.
      if (!session.scheduleSnapshot || currentBoxSourceRef.current !== "skland" || currentOperboxRef.current !== operbox) return;
      setSklandScheduleSnapshot(session.scheduleSnapshot);
      setSklandStatusSnapshot(session.statusSnapshot ?? null);
      setOperbox(normalizeOperboxEntries(session.scheduleSnapshot.operbox));
      setFileName(session.scheduleSnapshot.sourceName);
    },
  };
  const websiteUserId = websiteSession?.user.id ?? null;
  const [trainingSyncLoaded, setTrainingSyncLoaded] = useState(page === "training");
  const [trainingSyncSnapshot, setTrainingSyncSnapshot] = useState<TrainingSyncSnapshot | null>(null);
  useEffect(() => {
    if (page === "training") setTrainingSyncLoaded(true);
  }, [page]);
  const sklandTrainingSync = sklandTrainingSyncOptions.enabled
    && trainingSyncSnapshot?.identity === sklandTrainingSyncOptions.identity
    && trainingSyncSnapshot.resultId === sklandTrainingSyncOptions.resultId
    ? trainingSyncSnapshot.value : null;
  const accountCloudWorkspace = useAccountCloudWorkspace(CLIENT_ACCOUNT_CLOUD_SYNC_ENABLED ? {
    userId: websiteUserId,
    hasRestoredSession,
    hasLocalSession: hadPersistedSession.current,
    preset,
    setPreset,
    layout,
    setLayout,
    operbox,
    setOperbox,
    fileName,
    setFileName,
    boxSource,
    setBoxSource,
    layoutDirty,
    setLayoutDirty,
    layoutSource,
    setLayoutSource,
    localLayoutBackup,
    setLocalLayoutBackup,
    rotationProfile,
    setRotationProfile,
    fiammettaEnabled,
    setFiammettaEnabled,
    result,
    setResult,
    activeShift,
    setActiveShift,
  } : null);

  function beginSklandStateChange(): number {
    sklandFullRestore.current = null;
    sklandFullRestorePending.current = false;
    return sklandRestoreGuard.current.begin();
  }

  useEffect(() => {
    if (page === "calculator") hasRenderedCalculator.current = true;
  }, [page]);

  useEffect(() => {
    if (!hasRestoredSession) return;

    const frame = window.requestAnimationFrame(() => {
      for (const target of Object.keys(WORKBENCH_PAGE_PATHS) as AppPage[]) {
        if (target === page || (target === "skland" && !CLIENT_SKLAND_ENABLED)) continue;
        if ((target === "agent" || target === "billing") && !features[target]) continue;
        router.prefetch(workbenchHref(target));
      }
    });

    const preloadDeferredComponents = () => {
      void Promise.allSettled([
        loadWebsiteAccountDialog(),
        loadSetupDialog(),
        loadComponents(),
      ]);
    };
    const idleCallback = window.requestIdleCallback?.(preloadDeferredComponents, { timeout: 1_500 });
    const fallbackTimer = idleCallback === undefined
      ? window.setTimeout(preloadDeferredComponents, 250)
      : undefined;

    return () => {
      window.cancelAnimationFrame(frame);
      if (idleCallback !== undefined) window.cancelIdleCallback?.(idleCallback);
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
    };
  }, [hasRestoredSession, page, router, features]);

  useEffect(() => {
    if (setupOpen) setSetupMounted(true);
  }, [setupOpen]);

  useEffect(() => {
    if (websiteAuthDialogOpen) setWebsiteAuthDialogMounted(true);
  }, [websiteAuthDialogOpen]);

  useEffect(() => {
    if (issueOpen) setIssueModalMounted(true);
  }, [issueOpen]);

  useEffect(() => {
    if (pendingProductChange) setProductModalMounted(true);
  }, [pendingProductChange]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && loading) {
        void planTask.cancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [loading, planTask]);

  useEffect(() => {
    if (typeof window === "undefined" || restoredLocalSession.current) return;
    restoredLocalSession.current = true;
    try {
      const restored = loadPersistedSession(window.localStorage);
      hadPersistedSession.current = Boolean(restored);
      setOnboardingPreference(resolveOnboardingPreference(
        window.localStorage.getItem(ONBOARDING_STORAGE_KEY),
        Boolean(restored?.result),
      ));
      const warningDismissed = window.localStorage.getItem(RESULT_CLEAR_WARNING_DISMISSED_KEY) === "1";
      setResultClearWarningDismissed(warningDismissed);
      if (restored) {
        const restoredPreset = resolvePreset(PRESETS.find((item) => item.label === restored.presetLabel));
        const restoredLayout = restoreEditableProducts(buildBlueprint(restoredPreset), restored.layout);
        const restoredOperbox = restored.operbox ? normalizeOperboxEntries(restored.operbox) : null;
        setPreset(restoredPreset);
        setLayout(restoredLayout);
        const restoreAsLocalImport = !CLIENT_SKLAND_ENABLED && restored.boxSource === "skland";
        const restoredBoxSource = restoreAsLocalImport ? "maa" : restored.boxSource;
        const restoredSourceName = restoreAsLocalImport ? (intl("App.savedOperatorData")) : restored.sourceName;
        const restoredLayoutSource = CLIENT_SKLAND_ENABLED ? restored.layoutSource : "local";
        setOperbox(restoredOperbox);
        setFileName(restoredSourceName);
        setBoxSource(restoredBoxSource);
        setLayoutDirty(restored.layoutDirty);
        setLayoutSource(restoredLayoutSource);
        setLocalLayoutBackup(CLIENT_SKLAND_ENABLED ? restored.localLayoutBackup : null);
        setRotationProfile(restored.rotationProfile);
        setFiammettaEnabled(Boolean(restored.fiammettaEnabled));
        setResult(restored.result);
        automaticMaaRef.current = restored.result ? { diagnosticId: restored.result.diagnosticId, maa: structuredClone(restored.result.maa) } : null;
        setActiveShift(restored.activeShift);
        initialLayoutForRestore.current = restoredLayout;
        initialBoxSource.current = restoredBoxSource;
        initialOperbox.current = restoredOperbox;
        initialLayoutSource.current = restoredLayoutSource;
        initialLocalLayoutBackup.current = CLIENT_SKLAND_ENABLED ? restored.localLayoutBackup : null;
      }
    } catch {
      setStorageNotice(displayError("AIC-LOCAL-7001", intl("App.theBrowserCouldNotReadLocalDataButSchedules")));
    } finally {
      setHasRestoredSession(true);
    }
  }, [intl, locale, setBoxSource, setLayoutDirty, setOperbox]);

  // 将 agent 生成的排班产物注入工作台：复用会话恢复路径设置全部状态，
  // 使班次切换、手动排班导入、效率视图等现有功能立即可用。
  async function applyAgentArtifact(handoff: AgentArtifactHandoff): Promise<void> {
    setAgentArtifactLoading(true);
    setAgentArtifactError(false);
    setAgentArtifactNotice(handoff);
    try {
      if (!isAgentArtifactHandoff(handoff)) throw new Error("Invalid agent session");
      const session = handoff.session;
      const restoredPreset = resolvePreset(PRESETS.find((item) => item.label === session.presetLabel));
      const restoredLayout = restoreEditableProducts(buildBlueprint(restoredPreset), session.layout as BaseBlueprint);
      const restoredOperbox = Array.isArray(session.operbox) ? normalizeOperboxEntries(session.operbox as OperBoxEntry[]) : null;
      const restoredBoxSource = (session.boxSource === "skland" || session.boxSource === "maa" ? session.boxSource : "sample") as typeof boxSource;
      setPreset(restoredPreset);
      setLayout(restoredLayout);
      setOperbox(restoredOperbox);
      setFileName(typeof session.sourceName === "string" ? session.sourceName : null);
      setBoxSource(restoredBoxSource);
      // Explicitly opening an Agent result is a local selection. A later
      // Skland/cloud restore must not replace it with the previous layout.
      setLayoutDirty(true);
      hadPersistedSession.current = true;
      setLayoutSource("local");
      setLocalLayoutBackup(null);
      setRotationProfile(isRotationProfile(session.rotationProfile) ? session.rotationProfile : DEFAULT_ROTATION_PROFILE);
      setFiammettaEnabled(Boolean(session.fiammettaEnabled));
      const artifactResult = (session.result ?? null) as PublicPlanData | null;
      setResult(artifactResult);
      automaticMaaRef.current = artifactResult ? { diagnosticId: artifactResult.diagnosticId, maa: structuredClone(artifactResult.maa) } : null;
      setActiveShift(0);
      setUpgradeComparison(null);
      setScheduleVariant("baseline");
      initialLayoutForRestore.current = restoredLayout;
      initialBoxSource.current = restoredBoxSource;
      initialOperbox.current = restoredOperbox;
      initialLayoutSource.current = "local";
      initialLocalLayoutBackup.current = null;
      if (page !== "calculator") handleAppPageChange("calculator");
      // 成功注入后显示"可露希尔完成排班"提示横幅（数秒后自动消失），并清掉"新排班待注入"横幅。
      setAgentArtifactNotice(null);
      setAgentArtifactApplied({ preset: restoredPreset.label });
    } catch {
      // 网络等异常：同样保留横幅并显示错误，用户可重试。
      setAgentArtifactError(true);
    } finally {
      setAgentArtifactLoading(false);
    }
  }

  useEffect(() => {
    if (!hasRestoredSession || typeof window === "undefined") return;
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(AGENT_BROADCAST_CHANNEL) : null;
    if (channel) channel.onmessage = (event: MessageEvent) => {
      receiveAgentArtifactMessage(event.data, (handoff) => {
        setAgentArtifactNotice(handoff);
        setAgentArtifactError(false);
      });
    };
    try {
      const handoff = consumeAgentArtifactHandoff();
      if (handoff) void applyAgentArtifact(handoff);
    } catch {
      setAgentArtifactError(true);
    }
    return () => channel?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRestoredSession]);

  // 排班成功注入工作台后的"可露希尔完成排班"提示横幅，数秒后自动消失。
  useEffect(() => {
    if (!agentArtifactApplied) return;
    const timer = window.setTimeout(() => setAgentArtifactApplied(null), 6000);
    return () => window.clearTimeout(timer);
  }, [agentArtifactApplied]);

  useEffect(() => {
    if (!hasRestoredSession || typeof window === "undefined") return;
    if (skipNextPersistence.current) {
      skipNextPersistence.current = false;
      return;
    }
    try {
      persistSession(window.localStorage, {
        presetLabel: preset.label,
        layout,
        operbox,
        sourceName: fileName,
        boxSource,
        layoutDirty,
        layoutSource,
        localLayoutBackup,
        rotationProfile,
        fiammettaEnabled,
        result,
        activeShift,
      });
      setStorageNotice(null);
    } catch {
      setStorageNotice(displayError("AIC-LOCAL-7001", intl("App.theBrowserCouldNotSaveLocalDataButSchedules")));
    }
  }, [intl, hasRestoredSession, preset, layout, operbox, fileName, boxSource, layoutDirty, layoutSource, localLayoutBackup, rotationProfile, fiammettaEnabled, result, activeShift, locale]);

  useEffect(() => {
    let cancelled = false;
    if (!hasRestoredSession) return;
    void getHealth()
      .then((health) => {
        if (cancelled) return;
        setSklandConfigured(Boolean(CLIENT_SKLAND_ENABLED && health.skland?.available));
        setSklandDisabledReason(CLIENT_SKLAND_ENABLED ? health.skland?.message ?? null : null);
        setTaskQueueEnabled(Boolean(health.taskQueue?.enabled));
        if (health.plannerReady) {
          setCliReady(true);
          setApiError(null);
        } else {
          setCliReady(false);
          setApiError(displayError("AIC-PLAN-3001", intl("App.theSchedulingServiceIsTemporarilyUnavailableTryAgainLater"), true));
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setCliReady(false);
        setApiError(toDisplayError(error, intl("App.theSchedulingServiceIsTemporarilyUnavailableTryAgainLater")));
      });
    return () => {
      cancelled = true;
    };
  }, [intl, hasRestoredSession, locale]);

  useEffect(() => {
    if (
      !CLIENT_SKLAND_ENABLED
      || !hasRestoredSession
      || websiteSessionPending
      || !websiteUserId
    ) return;
    const generation = beginSklandStateChange();
    let cancelled = false;
    void getSklandAccounts("summary")
      .then((session) => {
        if (
          cancelled
          || !sklandRestoreGuard.current.canApplySummary(generation)
        ) return;
        setSklandConfigured(session.configured);
        setSklandDisabledReason(session.disabledReason ?? null);
        setSklandAccounts(session.accounts);
        setSklandActiveAccountId(session.activeAccountId);
        setSklandBindingSummary(bindingSummaryFromSession(session));
      })
      .catch(() => {
        // 摘要失败不清除已有身份；需要实时快照的页面会独立提供可操作错误。
      });
    return () => {
      cancelled = true;
    };
  }, [hasRestoredSession, websiteAuthReloadKey, websiteSessionPending, websiteUserId]);

  useEffect(() => {
    if (websiteSessionPending || !websiteSession || !websiteAuthDialogOpen) return;
    const intent = websiteAuthIntentRef.current;
    if (!intent) return;
    websiteAuthIntentRef.current = null;
    websiteAuthReturnFocusRef.current = null;
    setWebsiteAuthDialogOpen(false);
    websiteIntentContinuationRef.current(intent);
  }, [websiteAuthDialogOpen, websiteSession, websiteSessionPending]);

  useEffect(() => {
    if (!hasRestoredSession || websiteSessionPending) return;
    if (!CLIENT_SKLAND_ENABLED) {
      setSklandSessionLoading(false);
      return;
    }

    const generation = sklandRestoreGuard.current.current();
    let cancelled = false;
    statusLoadingAccount.current = null;

    if (!websiteUserId) {
      sklandRestoreGuard.current.acceptFull(generation);
      setSklandAccounts([]);
      setSklandActiveAccountId(null);
      setSklandBindingSummary(emptySklandBindingSummary());
      setSklandScheduleSnapshot(null);
      setSklandStatusSnapshot(null);
      setSklandError(null);
      setSklandSessionLoading(false);
      return;
    }

    const shouldLoadFullSklandSession = (
      page === "skland"
      || page === "gacha"
      || initialBoxSource.current === "skland"
      || !initialOperbox.current
      || setupOpen
    );
    if (!shouldLoadFullSklandSession) {
      setSklandSessionLoading(false);
      return;
    }

    sklandFullRestorePending.current = true;
    setSklandSessionLoading(true);
    let restore = sklandFullRestore.current;
    if (!restore || restore.generation !== generation) {
      restore = {
        generation,
        reloadKey: websiteAuthReloadKey,
        result: getSklandAccounts()
          .then((session) => ({ session }))
          .catch((error: unknown) => ({ error })),
      };
      sklandFullRestore.current = restore;
    }
    void restore.result
      .then((resolved) => {
        if ("error" in resolved) throw resolved.error;
        if (cancelled || !sklandRestoreGuard.current.acceptFull(generation)) return;
        const session = resolved.session;
        const bindingSummary = bindingSummaryFromSession(session);
        setSklandError(null);
        setSklandConfigured(session.configured);
        setSklandDisabledReason(session.disabledReason ?? null);
        setSklandAccounts(session.accounts);
        setSklandActiveAccountId(session.activeAccountId);
        setSklandBindingSummary(bindingSummary);
        setSklandStatusSnapshot(session.statusSnapshot ?? null);
        if (session.authenticated && session.scheduleSnapshot) {
          setSklandScheduleSnapshot(session.scheduleSnapshot);
          if (currentBoxSourceRef.current === "skland" || !currentOperboxRef.current?.length) {
            setOperbox(normalizeOperboxEntries(session.scheduleSnapshot.operbox));
            setFileName(session.scheduleSnapshot.sourceName);
            setBoxSource("skland");
          }
          if (
            !currentLayoutDirtyRef.current
            && (initialBoxSource.current === "skland" || !initialOperbox.current)
            && session.scheduleSnapshot.infrastructure.layoutSuggestion
          ) {
            const suggestion = session.scheduleSnapshot.infrastructure.layoutSuggestion;
            setLayout(mergeSklandLayout(initialLayoutForRestore.current, suggestion));
            setLocalLayoutBackup(
              initialLayoutSource.current === "local"
                ? structuredClone(initialLayoutForRestore.current)
                : initialLocalLayoutBackup.current
            );
            setLayoutSource("skland");
            setPreset(resolvePreset(PRESETS.find((item) => item.label === session.scheduleSnapshot?.infrastructure.layoutLabel)));
          }
        } else {
          setSklandScheduleSnapshot(null);
          setSklandStatusSnapshot(null);
        }
      })
      .catch((error) => {
        if (cancelled || !sklandRestoreGuard.current.isCurrent(generation)) return;
        setSklandError(toDisplayError(error, intl("App.couldNotRestoreTheSklandSessionRefreshAndTry")));
      })
      .finally(() => {
        if (sklandFullRestore.current === restore) sklandFullRestorePending.current = false;
        if (!cancelled && sklandRestoreGuard.current.isCurrent(generation)) setSklandSessionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [intl, hasRestoredSession, locale, page, setBoxSource, setOperbox, setupOpen, websiteAuthReloadKey, websiteSessionPending, websiteUserId]);

  useEffect(() => {
    if (
      !CLIENT_SKLAND_ENABLED
      || (page !== "skland" && page !== "gacha")
      || !activeSklandAccount
      || sklandStatusSnapshot?.player.uid === activeSklandAccount.selectedUid
      || sklandFullRestorePending.current
      || sklandSessionLoading
      || sklandError
      || statusLoadingAccount.current === activeSklandAccount.accountId
    ) return;
    let cancelled = false;
    statusLoadingAccount.current = activeSklandAccount.accountId;
    setSklandBusy(true);
    void refreshSklandStatus()
      .then((status) => {
        if (cancelled) return;
        setSklandAccounts(status.accounts);
        setSklandActiveAccountId(status.activeAccountId);
        setSklandStatusSnapshot(status.snapshot ?? null);
        setSklandError(null);
      })
      .catch((error) => {
        if (!cancelled) setSklandError(toDisplayError(error, intl("App.couldNotLoadTheStatusCenterTryAgainLater")));
      })
      .finally(() => {
        statusLoadingAccount.current = null;
        if (!cancelled) setSklandBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [intl, activeSklandAccount, locale, page, sklandError, sklandSessionLoading, sklandStatusReloadKey, sklandStatusSnapshot]);

  async function handleFile(file: File, signal?: AbortSignal): Promise<void> {
    try {
      const { readOperboxFile } = await import("./operbox");
      const entries = await readOperboxFile(file);
      signal?.throwIfAborted();
      setOperbox(entries);
      setFileName(file.name);
      setBoxSource("maa");
      setInputError(null);
      setResult(null);
      clearIssueState();
    } catch (error) {
      if (signal?.aborted) throw error;
      setInputErrorCode("AIC-BOX-1101");
      throw new Error(localize_App.text(locale, "additional1", { choice1: (!(locale === "en")) && (error instanceof Error) ? "yes" : "no", value2: (!(locale === "en") && (error instanceof Error)) ? String(error.message) : "" }), { cause: error });
    }
  }

  function applySklandSnapshot(snapshot: SklandScheduleSnapshot, applyLayoutWhenClean = true) {
    setSklandScheduleSnapshot(snapshot);
    setOperbox(normalizeOperboxEntries(snapshot.operbox));
    setFileName(snapshot.sourceName);
    setBoxSource("skland");
    setInputMode("skland");
    clearPlanResult();
    if (applyLayoutWhenClean && !layoutDirty && snapshot.infrastructure.layoutSuggestion) {
      if (layoutSource === "local") setLocalLayoutBackup(structuredClone(layout));
      setLayout((current) => mergeSklandLayout(current, snapshot.infrastructure.layoutSuggestion as BaseBlueprint));
      setLayoutSource("skland");
      setPreset(resolvePreset(PRESETS.find((item) => item.label === snapshot.infrastructure.layoutLabel)));
      setLayoutDirty(false);
    }
  }

  function applySklandSession(session: SklandSessionData, applyLayoutWhenClean = true) {
    // Role changes and sign-out are authoritative for this restore generation.
    // Route renders must not start another restore over the completed mutation.
    sklandFullRestore.current = {
      generation: sklandRestoreGuard.current.current(),
      reloadKey: websiteAuthReloadKey,
      result: Promise.resolve({ session }),
    };
    setSklandAccounts(session.accounts);
    setSklandActiveAccountId(session.activeAccountId);
    setSklandBindingSummary(bindingSummaryFromSession(session));
    setSklandStatusSnapshot(session.statusSnapshot ?? null);
    if (session.authenticated && session.scheduleSnapshot) {
      applySklandSnapshot(session.scheduleSnapshot, applyLayoutWhenClean);
      return;
    }
    setSklandScheduleSnapshot(null);
    if (boxSource === "skland") {
      setOperbox(null);
      setFileName(null);
      setBoxSource("sample");
      clearPlanResult();
    }
  }

  async function handleMaaPaste(): Promise<boolean> {
    setInputError(null);
    try {
      const { readOperboxText } = await import("./operbox");
      const entries = await readOperboxText(maaPaste);
      setOperbox(entries);
      setFileName(intl("App.pastedArknightsOperboxExportJson"));
      setBoxSource("maa");
      clearPlanResult();
      return true;
    } catch (error) {
      setInputError(localize_App.text(locale, "additional2", { choice1: (!(locale === "en")) && (error instanceof Error) ? "yes" : "no", value2: (!(locale === "en") && (error instanceof Error)) ? String(error.message) : "" }));
      setInputErrorCode("AIC-BOX-1101");
      return false;
    }
  }

  function handleManualBox(entries: OperBoxEntry[]) {
    setInputError(null);
    setOperbox(normalizeOperboxEntries(entries));
    setFileName(intl("App.manuallySelectedBox"));
    setBoxSource("maa");
    clearPlanResult();
  }

  async function handleSklandRole(accountId: string, uid: string) {
    const generation = beginSklandStateChange();
    setSklandBusy(true);
    setSklandError(null);
    try {
      const session = await selectSklandRole(accountId, uid);
      if (!sklandRestoreGuard.current.isCurrent(generation)) return;
      if (!session.authenticated || !session.scheduleSnapshot) throw new Error(intl("App.couldNotSwitchCharacter"));
      sklandRestoreGuard.current.acceptFull(generation);
      applySklandSession(session, false);
    } catch (error) {
      if (!sklandRestoreGuard.current.isCurrent(generation)) return;
      const normalized = toDisplayError(error, intl("App.couldNotSwitchCharacterTryAgainLater"));
      setSklandError(normalized);
      try {
        const current = await getSklandAccounts();
        if (!sklandRestoreGuard.current.acceptFull(generation)) return;
        setSklandAccounts(current.accounts);
        setSklandActiveAccountId(current.activeAccountId);
        setSklandStatusSnapshot(current.statusSnapshot ?? null);
        if (current.authenticated && current.scheduleSnapshot) applySklandSnapshot(current.scheduleSnapshot, false);
      } catch {
        // 保留上一份成功快照，等待用户再次操作。
      }
    } finally {
      if (sklandRestoreGuard.current.isCurrent(generation)) setSklandBusy(false);
    }
  }

  async function handleSklandLogout() {
    if (!sklandActiveAccountId) return;
    const generation = beginSklandStateChange();
    setSklandBusy(true);
    setSklandError(null);
    try {
      const session = await deleteSklandAccount(sklandActiveAccountId);
      if (!sklandRestoreGuard.current.acceptFull(generation)) return;
      applySklandSession(session, false);
    } catch (error) {
      if (!sklandRestoreGuard.current.isCurrent(generation)) return;
      const normalized = toDisplayError(error, intl("App.couldNotSignOutOfSklandTryAgainLater"));
      setSklandError(normalized);
    } finally {
      if (sklandRestoreGuard.current.isCurrent(generation)) setSklandBusy(false);
    }
  }

  function handleApplySklandLayout() {
    const suggestion = sklandScheduleSnapshot?.infrastructure.layoutSuggestion;
    if (!suggestion) return;
    if (layoutSource === "local") setLocalLayoutBackup(structuredClone(layout));
    setLayout((current) => mergeSklandLayout(current, suggestion));
    setLayoutSource("skland");
    setPreset(resolvePreset(PRESETS.find((item) => item.label === sklandScheduleSnapshot.infrastructure.layoutLabel)));
    setLayoutDirty(false);
    clearPlanResult();
  }

  async function runPlanForLayout(
    planLayout: BaseBlueprint,
    retryUnavailable = false,
    planInput: { operbox: OperBoxEntry[] | null; sourceName: string | null; boxSource: BoxSource } = {
      operbox,
      sourceName: fileName,
      boxSource,
    },
  ): Promise<boolean> {
    setProgressionAdjustmentActivity({ active: false, loading: false, completed: false, error: null });
    if (!planInput.operbox) return false;
    if (planRetryCountdown > 0) return false;
    planClickAtRef.current = performance.now();
    trackTelemetry({ type: "interaction", name: "plan_click", page: "calculator" });
    const layoutError = layoutValidationError(planLayout, locale === "en");
    if (layoutError) {
      setApiError(displayError("AIC-LAYOUT-1201", layoutError));
      return false;
    }
    if (!cliReady && !retryUnavailable) {
      setApiError(displayError("AIC-PLAN-3001", intl("App.theSchedulingServiceIsTemporarilyUnavailableTryAgainLater"), true));
      return false;
    }
    void import("@/product-assets").then(({ preloadProductIcons }) => preloadProductIcons());
    setLoading(true);
    setResultClearNotice(null);
    setInputError(null);
    setApiError(null);
    clearIssueState();

    try {
      trackTelemetry({ type: "interaction", name: "plan_submit", page: "calculator" });
      const payload = {
        layout: planLayout,
        operbox: normalizeOperboxEntries(planInput.operbox),
        sourceName: planInput.sourceName,
        boxSource: planInput.boxSource,
        rotation: rotationProfile,
        fiammetta_enable: effectiveFiammettaSetting(planInput.operbox, rotationProfile, fiammettaEnabled),
      };
      if (!taskQueueEnabled || payload.boxSource === "sample") {
        planTask.complete(await computePlan(payload));
        return true;
      }
      const submitted = await submitPlanTask(payload);
      if (submitted.status === "done") planTask.complete(submitted.result);
      else planTask.begin(submitted);
      return true;
    } catch (error) {
      const normalized = toDisplayError(error, intl("App.theScheduleRequestFailedTryAgainLater"));
      setApiError(normalized);
      if (normalized.retryAfterSeconds) startPlanRetryCooldown(normalized.retryAfterSeconds);
      setLoading(false);
      return false;
    }
  }

  function handleCancelRun() {
    void planTask.cancel().then((cancelled) => {
      if (cancelled) setApiError(null);
    });
  }

  async function handleRun() {
    await runPlanForLayout(layout);
  }

  async function handleSimulateUpgrades(trialOperbox: OperBoxEntry[]): Promise<PublicPlanData> {
    if (!operbox) throw new Error(intl("App.importOperatorDataFirst"));
    if (!trialOperbox.some((entry) => entry.own)) throw new Error(intl("App.selectAtLeastOneOperatorForTheSimulation"));
    const normalizedTrialOperbox = normalizeOperboxEntries(trialOperbox);
    setProgressionAdjustmentActivity({ active: true, loading: true, completed: false, error: null });
    trackTelemetry({ type: "interaction", name: "upgrade_simulation_submit", page: "calculator" });
    try {
      const payload = {
        layout,
        operbox: normalizedTrialOperbox,
        sourceName: intl("App.progressionAdjustmentBoxJson"),
        // 示例数据的替代 BOX 不能沿用 sample；森空岛来源则保留其数据归属标签。
        boxSource: upgradeSimulationBoxSource(boxSource),
        rotation: rotationProfile,
        fiammetta_enable: effectiveFiammettaSetting(trialOperbox, rotationProfile, fiammettaEnabled),
      };
      const response = taskQueueEnabled
        ? await progressionAdjustmentTask.run(await submitPlanTask(payload))
        : await computePlan(payload);
      // 求解成功后再同步，避免失败的试算覆盖用户当前 BOX。
      setOperbox(normalizedTrialOperbox);
      setFileName(intl("App.progressionAdjustedBox"));
      setInputMode("manual");
      setProgressionAdjustmentActivity({ active: true, loading: false, completed: true, error: null, maa: response.maa });
      trackTelemetry({ type: "interaction", name: "upgrade_simulation_response", page: "calculator" });
      return response;
    } catch (error) {
      const normalized = toDisplayError(error, intl("App.progressionAdjustmentFailedPleaseTryAgainLater"));
      setProgressionAdjustmentActivity({
        active: true,
        loading: false,
        completed: false,
        // 弹窗保留原始错误并允许重新提交；Live Activity 不触发普通排班的重试入口。
        error: { ...normalized, retryable: false },
      });
      throw error;
    }
  }

  async function handleRunSampleTrial(): Promise<boolean> {
    if (sampleTrialInFlightRef.current) return false;
    sampleTrialInFlightRef.current = true;
    setSampleLoading(true);
    setInputError(null);
    setResult(null);
    clearIssueState();
    try {
      const sample = await getSampleOperbox();
      const sampleOperbox = normalizeOperboxEntries(sample.operbox);
      setOperbox(sampleOperbox);
      setFileName(sample.sourceName);
      setBoxSource("sample");
      return await runPlanForLayout(layout, false, {
        operbox: sampleOperbox,
        sourceName: sample.sourceName,
        boxSource: "sample",
      });
    } catch (error) {
      setInputError(localize_App.text(locale, "additional3", { choice1: (!(locale === "en")) && (error instanceof Error) ? "yes" : "no", value2: (!(locale === "en") && (error instanceof Error)) ? String(error.message) : "" }));
      const normalized = toDisplayError(error, intl("App.couldNotReadSampleDataTryAgainLater"));
      setInputErrorCode(normalized.code);
      setApiError(normalized);
      return false;
    } finally {
      sampleTrialInFlightRef.current = false;
      setSampleLoading(false);
    }
  }

  async function handleDownloadMaa() {
    if (!scheduleResult?.maa) return;
    const { downloadJson } = await import("./download");
    downloadJson("arknights-infra-schedule-maa.json", prepareMaaForExport(
      scheduleResult.maa,
      userSettings.strictMaaOperatorOrder,
      userSettings.allowReplacementOperatorSort,
    ));
  }

  function handleSwapCalculatorOperators(row: RoomRow, firstSlotIndex: number, secondSlotIndex: number) {
    if (row.group !== "trading" && row.group !== "manufacture") return;
    const group = row.group;
    const swap = (current: PublicPlanData | null) => {
      if (!current) return current;
      const next = structuredClone(current);
      const rooms = next.maa.plans[activeShift]?.rooms[group];
      const room = rooms?.[row.index];
      if (!room || firstSlotIndex === secondSlotIndex) return current;
      if (!room.operators[firstSlotIndex] || !room.operators[secondSlotIndex]) return current;
      [room.operators[firstSlotIndex], room.operators[secondSlotIndex]] = [
        room.operators[secondSlotIndex],
        room.operators[firstSlotIndex],
      ];
      return next;
    };
    if (scheduleVariant === "trial" && upgradeComparison?.baseline === result) {
      setUpgradeComparison((current) => current ? { ...current, trial: swap(current.trial)! } : current);
    } else {
      setResult(swap);
    }
  }

  async function handleDownloadScheduleImage() {
    if (!scheduleResult?.maa?.plans?.length) throw new Error("Schedule result is not ready");
    const { downloadScheduleImage } = await import("./schedule-image");
    const board = document.querySelector<HTMLElement>("[data-plan-board]");
    if (!board) throw new Error("Schedule board is not ready");
    await downloadScheduleImage(board, `arknights-infra-schedule-shift-${activeShift + 1}.png`);
  }

  async function evaluateManualScheduleFromPage(input: {
    draft: ManualScheduleDraft;
  }) {
    if (manualEvaluationPending) return;
    setManualEvaluationPending(true);
    try {
      const { assembleNativeManualPlanResult } = await import("./manual-plan-result");
      const result = await assembleNativeManualPlanResult({ draft: input.draft, layout, operbox });
      setManualPlanResult(result);
      try {
        persistManualEvaluationCache(window.localStorage, result);
      } catch {
        // The in-memory result remains available for the current workbench session.
      }
    } finally {
      setManualEvaluationPending(false);
    }
  }

  async function evaluatePaperManualScheduleFromPage(input: {
    draft: ManualScheduleDraft;
  }) {
    if (manualEvaluationPending) return;
    setManualEvaluationPending(true);
    try {
      const { assemblePaperManualPlanResult } = await import("./manual-plan-result");
      const result = await assemblePaperManualPlanResult({ draft: input.draft, layout, operbox });
      setManualPlanResult(result);
      try {
        persistManualEvaluationCache(window.localStorage, result);
      } catch {
        // The in-memory result remains available for the current workbench session.
      }
    } finally {
      setManualEvaluationPending(false);
    }
  }

  function restoreManualEvaluation(result: ManualPlanResult) {
    setManualPlanResult(result);
  }

  function clearManualEvaluation() {
    setManualPlanResult(null);
    setManualEvaluationPending(false);
    try {
      clearManualEvaluationCache(window.localStorage);
    } catch {
      // Local storage can be unavailable while the in-memory state is still cleared.
    }
  }

  function openManualScheduleDraft(draft: ManualScheduleDraft) {
    setPendingManualDraftReplacement(null);
    clearManualEvaluation();
    setManualShiftDurations(draft.shifts.map((shift) => shift.durationHours));
    setManualShiftStartTime(draft.startTime);
    setManualScheduleMode(draft.scheduleMode);
    setManualFiammettaEnabled(draft.fiammettaEnabled);
    setManualDraftHandoff(draft);
    try {
      window.localStorage.setItem(MANUAL_SCHEDULE_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // The manual page remains usable; it will surface its existing storage warning.
    }
    navigateToPage("manual");
  }

  function confirmManualDraftReplacement() {
    if (!pendingManualDraftReplacement) return;
    openManualScheduleDraft(pendingManualDraftReplacement);
  }

  async function handleEditManualSchedule() {
    if (!scheduleResult) {
      navigateToPage("manual");
      return;
    }
    const {
      DEFAULT_MANUAL_SHIFT_START_TIME,
      createManualScheduleDraftFromCalculator,
      loadManualScheduleDraft,
      manualScheduleDraftContentEqual,
      reconcileManualScheduleDraft,
    } = await import("./manual-schedule");
    const resultDurations = scheduleResult.rotation.shifts
      .map((shift) => shift.duration_hours)
      .filter((duration) => Number.isFinite(duration) && duration > 0);
    const durations = resultDurations?.length ? resultDurations : rotationDurations(rotationProfile);
    const equalDurations = durations.every((duration) => Math.abs(duration - durations[0]!) < 0.000_001);
    const draft = reconcileManualScheduleDraft(createManualScheduleDraftFromCalculator({
      layout,
      maa: scheduleResult.maa,
      fallbackDurations: durations,
      timingOverride: equalDurations
        ? { scheduleMode: "sequential" }
        : { scheduleMode: "period", startTime: DEFAULT_MANUAL_SHIFT_START_TIME },
      fiammettaEnabled: effectiveFiammettaEnabled,
      trainingRoomShifts: scheduleResult.trainingRoom?.shifts,
      source: {
        kind: "calculator",
        variant: scheduleVariant === "trial" && upgradeComparison?.baseline === result
          ? "progression-adjusted"
          : "baseline",
        createdAt: new Date().toISOString(),
      },
    }), layout, operbox);

    let existingDraft: ManualScheduleDraft | null = null;
    try {
      existingDraft = loadManualScheduleDraft(window.localStorage);
    } catch {
      existingDraft = null;
    }
    if (existingDraft && !manualScheduleDraftContentEqual(existingDraft, draft)) {
      setPendingManualDraftReplacement(draft);
      return;
    }

    openManualScheduleDraft(draft);
  }

  function clearIssueState() {
    setIssueDraftKind("room_issue");
    setIssueDraftRow(null);
    setIssueDraftNote("");
    setIssueOpen(false);
    setFeedbackResult(null);
  }

  function handleMarkIssue(row: RoomRow) {
    if (feedbackDisabledForSampleBox) return;
    setIssueDraftKind("room_issue");
    setIssueDraftRow(row);
    setIssueDraftNote("");
    setFeedbackResult(null);
    setIssueOpen(true);
  }

  function handlePerformanceIssue() {
    if (feedbackDisabledForSampleBox) return;
    if (!result?.diagnosticId) return;
    setIssueDraftKind("performance_issue");
    setIssueDraftRow(null);
    setIssueDraftNote(intl("App.thisSolveTookNoticeablyLongerThanExpected"));
    setFeedbackResult(null);
    setIssueOpen(true);
  }

  async function handleSaveIssue() {
    if (!issueDraftNote.trim() || (issueDraftKind === "room_issue" && !issueDraftRow)) return;
    if (!result?.diagnosticId) {
      setApiError(displayError("AIC-FEEDBACK-4001", intl("App.generateAScheduleBeforeSubmittingAnIssue")));
      return;
    }
    if (!operbox || boxSource === "sample") {
      setApiError(displayError("AIC-FEEDBACK-4001", "当前排班缺少可提交的个人干员 Box，请重新导入后生成排班。"));
      return;
    }

    const environment = locale === "en" ? [
      `Solve time: ${Math.round(result.durationMs)} ms`,
      `Shift: ${activeShift + 1}`,
      `Rotation: ${rotationProfile}`,
      `Layout: ${preset.label}`,
    ].join("; ") : [
      `求解耗时：${Math.round(result.durationMs)} ms`,
      `班次：${activeShift + 1}`,
      `换班方式：${rotationProfile}`,
      `布局：${preset.label}`,
    ].join("；");
    const note = `${issueDraftNote.trim()}\n\n[${intl("App.environment")}] ${environment}`;
    const reproduction = {
      layout: structuredClone(layout),
      operbox: normalizeOperboxEntries(operbox),
      rotation: rotationProfile,
      fiammettaEnabled: effectiveFiammettaEnabled,
      sourceType: boxSource,
    };

    setFeedbackSaving(true);
    setApiError(null);
    try {
      let response: FeedbackData;
      if (issueDraftKind === "performance_issue") {
        response = await saveFeedback({
          kind: "performance_issue",
          diagnosticId: result.diagnosticId,
          note,
          consent: true,
          reproduction,
        });
      } else {
        const row = issueDraftRow;
        if (!row) return;
        response = await saveFeedback({
          kind: "room_issue",
          diagnosticId: result.diagnosticId,
          room: {
            id: row.roomId,
            title: row.title,
            group: row.group,
            operators: row.operators,
          },
          note,
          consent: true,
          reproduction,
        });
      }
      setFeedbackResult(response);
      setIssueOpen(false);
      setIssueDraftKind("room_issue");
      setIssueDraftRow(null);
      setIssueDraftNote("");
    } catch (error) {
      const normalized = toDisplayError(error, intl("App.couldNotSaveFeedbackTryAgainLater"));
      setApiError(normalized);
    } finally {
      setFeedbackSaving(false);
    }
  }

  function handleCancelIssue() {
    setIssueOpen(false);
    setIssueDraftKind("room_issue");
    setIssueDraftRow(null);
    setIssueDraftNote("");
  }

  function clearPlanResult() {
    setResult(null);
    setUpgradeSimulationOpen(false);
    setActiveShift(0);
    clearIssueState();
  }

  function handleRotationProfileChange(value: RotationProfile) {
    setRotationProfile(value);
    clearPlanResult();
  }

  function handleFiammettaEnabledChange(enabled: boolean) {
    setFiammettaEnabled(enabled);
    clearPlanResult();
  }

  function handleUserSettingsChange(nextSettings: UserSettings) {
    setUserSettings(nextSettings);
    window.dispatchEvent(new CustomEvent(USER_SETTINGS_CHANGED_EVENT, { detail: nextSettings }));
    try {
      persistUserSettings(window.localStorage, nextSettings);
    } catch {
      // Keep the setting active for this session if storage is unavailable.
    }
  }

  function applyPartialLocalLayoutEdit(patch: (layout: BaseBlueprint) => BaseBlueprint): BaseBlueprint {
    const next = applyLocalLayoutPatch({ layout, layoutSource, localLayoutBackup }, patch, defaultLayout);
    setLayout(next.layout);
    setLayoutSource(next.layoutSource);
    setLocalLayoutBackup(next.localLayoutBackup);
    setLayoutDirty(true);
    clearPlanResult();
    return next.layout;
  }

  function applyProductChange(change: ProductChange) {
    applyPartialLocalLayoutEdit((current) => layoutWithProductChange(current, change));
  }

  function productChangeLabel(change: ProductChange) {
    if (locale === "en") {
      if (change.type === "factory") return ({ gold: "Precious Metals", battle_record: "Battle Records", originium: "Originium Shards" } as Partial<Record<FactoryRecipe, string>>)[change.recipe] ?? change.recipe;
      return ({ gold: "LMD Orders", originium: "Orundum Orders" } as const)[change.order];
    }
    if (change.type === "factory") {
      return FACTORY_RECIPE_OPTIONS.find((option) => option.value === change.recipe)?.label;
    }
    return TRADE_ORDER_OPTIONS.find((option) => option.value === change.order)?.label;
  }

  function showResultClearNotice(label: string | undefined) {
    if (resultClearWarningDismissed || !result) return;
    setResultClearNotice(label ? (intl("App.changedTo", { label: label })) : (intl("App.settingsChanged")));
  }

  function requestProductChange(change: ProductChange) {
    showResultClearNotice(productChangeLabel(change));
    applyProductChange(change);
  }

  function requestScheduleProductChange(change: ProductChange) {
    if (loading || pendingProductChange) return;
    if (!result) {
      requestProductChange(change);
      return;
    }
    setResultClearNotice(null);
    setPendingProductChange(change);
  }

  async function confirmScheduleProductChange() {
    if (!pendingProductChange || loading) return;
    const nextLayout = applyPartialLocalLayoutEdit(
      (current) => layoutWithProductChange(current, pendingProductChange)
    );
    try {
      await runPlanForLayout(nextLayout);
    } finally {
      setPendingProductChange(null);
    }
  }

  function dismissResultClearWarning() {
    setResultClearWarningDismissed(true);
    setResultClearNotice(null);
    try {
      window.localStorage.setItem(RESULT_CLEAR_WARNING_DISMISSED_KEY, "1");
    } catch {
      // The current session can still honor the preference when storage is unavailable.
    }
  }

  function restoreResultClearWarning() {
    setResultClearWarningDismissed(false);
    try {
      window.localStorage.removeItem(RESULT_CLEAR_WARNING_DISMISSED_KEY);
    } catch {
      // The in-memory preference has already been restored.
    }
  }

  function handlePresetSelect(nextPreset: PresetDef) {
    showResultClearNotice(intl("App.layout", { label: nextPreset.label }));
    setPreset(nextPreset);
    setLayout(buildBlueprint(nextPreset));
    setLayoutDirty(true);
    setLayoutSource("local");
    setLocalLayoutBackup(null);
    clearPlanResult();
  }

  function handleManualImportedLayout(nextLayout: BaseBlueprint) {
    setLayout(structuredClone(nextLayout));
    setPreset(PRESETS.find((candidate) => candidate.label === nextLayout.template) ?? preset);
    setLayoutDirty(true);
    setLayoutSource("local");
    setLocalLayoutBackup(null);
    clearPlanResult();
  }

  function handleFactoryRecipeChange(roomId: string, recipe: FactoryRecipe) {
    requestProductChange({ type: "factory", roomId, recipe });
  }

  function handleTradeOrderChange(roomId: string, order: TradeOrder) {
    requestProductChange({ type: "trade", roomId, order });
  }

  function handleScheduleFactoryRecipeChange(roomId: string, recipe: FactoryRecipe) {
    requestScheduleProductChange({ type: "factory", roomId, recipe });
  }

  function handleScheduleTradeOrderChange(roomId: string, order: TradeOrder) {
    requestScheduleProductChange({ type: "trade", roomId, order });
  }

  function handleScheduleDroneTargetChange(row: RoomRow) {
    setManualDroneShifts((current) => ({ ...current, [activeShift]: true }));
    setResult((current) => {
      if (!current) return current;
      if (automaticMaaRef.current?.diagnosticId !== current.diagnosticId) {
        automaticMaaRef.current = { diagnosticId: current.diagnosticId, maa: structuredClone(current.maa) };
      }
      const room = layout.rooms.find((candidate) => candidate.id === row.roomId);
      if (!room || (room.kind !== "trade_post" && room.kind !== "factory")) return current;
      const group = room.kind === "trade_post" ? "trading" : "manufacture";
      const index = layout.rooms.filter((candidate) => candidate.kind === room.kind).findIndex((candidate) => candidate.id === room.id) + 1;
      const next = structuredClone(current);
      const plan = next.maa.plans[droneStoragePlanIndex(activeShift, next.maa.plans.length)];
      if (!plan) return current;
      plan.drones = plan.drones?.room === group && plan.drones.index === index
        ? undefined
        : { enable: true, room: group, index, rule: "all", order: "pre" };
      return next;
    });
  }

  function handleManualDroneAllocation() {
    setManualDroneShifts((current) => ({ ...current, [activeShift]: true }));
  }

  function handleAutoDroneAllocation() {
    setManualDroneShifts((current) => ({ ...current, [activeShift]: false }));
    setResult((current) => {
      if (!current || automaticMaaRef.current?.diagnosticId !== current.diagnosticId) return current;
      const next = structuredClone(current);
      const automaticPlans = automaticMaaRef.current.maa.plans;
      const planIndex = droneStoragePlanIndex(activeShift, next.maa.plans.length);
      const plan = next.maa.plans[planIndex];
      if (!plan) return current;
      plan.drones = structuredClone(automaticPlans[planIndex]?.drones);
      return next;
    });
  }

  function handleRoomLevelChange(roomId: string, level: number) {
    applyPartialLocalLayoutEdit((current) => updateRoomLevel(current, roomId, level));
  }

  async function handleLayoutFile(file: File, signal?: AbortSignal) {
    try {
      const parsed = parseLayoutJson(JSON.parse(await file.text()));
      if (!parsed) throw new Error(intl("App.invalidLayoutFileCheckRoomNamesTypesAndFacility"));
      signal?.throwIfAborted();
      setLayout(parsed);
      setLayoutDirty(true);
      setLayoutSource("local");
      setLocalLayoutBackup(null);
      clearPlanResult();
      setInputError(null);
    } catch (error) {
      if (signal?.aborted) throw error;
      setInputErrorCode("AIC-LAYOUT-1201");
      throw new Error(localize_App.text(locale, "additional4", { choice1: ((locale === "en")) && (error instanceof Error) ? "yes" : "no", value2: ((locale === "en") && (error instanceof Error)) ? String(error.message) : "", choice3: (!(locale === "en")) && (error instanceof Error) ? "yes" : "no", value4: (!(locale === "en") && (error instanceof Error)) ? String(error.message) : "" }), { cause: error });
    }
  }

  function persistOnboardingPreference(value: OnboardingPreference) {
    setOnboardingPreference(value);
    try {
      window.localStorage.setItem(
        ONBOARDING_STORAGE_KEY,
        value === "completed" ? ONBOARDING_COMPLETED_VALUE : ONBOARDING_DISMISSED_VALUE,
      );
    } catch {
      // The current page can still honor the preference when storage is unavailable.
    }
  }

  function dismissOnboarding() {
    persistOnboardingPreference("dismissed");
  }

  function completeOnboarding() {
    persistOnboardingPreference("completed");
  }

  function openSetup(mode: "calculator" | "manual" = "calculator") {
    setSetupMode(mode);
    setSetupOpen(true);
  }

  function handleSetupOpenChange(next: boolean) {
    setSetupOpen(next);
    if (!next) setInputError(null);
  }

  function closeSetup() {
    setInputError(null);
    setSetupOpen(false);
  }

  function openSklandFromSetup() {
    setInputError(null);
    setSetupOpen(false);
    navigateToPage("skland");
  }

  function handleAppPageChange(nextPage: AppPage, trigger?: HTMLElement): boolean {
    if (nextPage === "manual" && !accountCanUseCurrentBox) {
      requestWebsiteAccount("manual", trigger);
      return false;
    }
    if ((nextPage === "account" || nextPage === "skland") && !websiteSession) {
      requestWebsiteAccount(nextPage, trigger);
      return false;
    }
    if (nextPage === "calculator") hasRenderedCalculator.current = true;
    return true;
  }

  function requestWebsiteAccount(intent: WebsiteAuthIntent, trigger?: HTMLElement | null) {
    websiteAuthIntentRef.current = intent;
    websiteAuthReturnFocusRef.current = trigger ?? document.activeElement as HTMLElement | null;
    setWebsiteAuthDialogOpen(true);
  }

  function handleWebsiteAuthDialogOpenChange(open: boolean) {
    if (websiteAuthFocusReturnTimerRef.current !== null) {
      window.clearTimeout(websiteAuthFocusReturnTimerRef.current);
      websiteAuthFocusReturnTimerRef.current = null;
    }
    setWebsiteAuthDialogOpen(open);
    if (open) return;
    websiteAuthIntentRef.current = null;
    const trigger = websiteAuthReturnFocusRef.current;
    websiteAuthReturnFocusRef.current = null;
    websiteAuthFocusReturnTimerRef.current = window.setTimeout(() => {
      websiteAuthFocusReturnTimerRef.current = null;
      const focusTarget = trigger?.isConnected
        ? trigger
        : document.querySelector<HTMLElement>('[data-primary-navigation-page="account"]');
      focusTarget?.focus();
    }, WEBSITE_AUTH_FOCUS_RETURN_DELAY_MS);
  }

  function navigateToPage(nextPage: AppPage) {
    if (!handleAppPageChange(nextPage)) return;
    router.push(workbenchHref(nextPage));
  }

  async function handleWebsiteSessionChanged(authenticated: boolean) {
    beginSklandStateChange();
    if (!authenticated) {
      setMasteryPickerRequested(false);
      websiteAuthIntentRef.current = null;
      websiteAuthReturnFocusRef.current = null;
      setWebsiteAuthDialogOpen(false);
      setUpgradeSimulationOpen(false);
      router.push(workbenchHref("calculator"));
      setSklandAccounts([]);
      setSklandActiveAccountId(null);
      setSklandBindingSummary(emptySklandBindingSummary());
      setSklandScheduleSnapshot(null);
      setSklandStatusSnapshot(null);
      setSklandError(null);
    }
    await refetchWebsiteSession();
    setWebsiteAuthReloadKey((current) => current + 1);
  }

  function handleStartPersonalFlow() {
    if (!websiteSession) {
      requestWebsiteAccount(hasPersonalBox ? "run" : "setup");
      return;
    }
    if (hasPersonalBox) {
      void handleRun();
      return;
    }
    openSetup();
  }

  function handleProtectedSetup() {
    if (!websiteSession) {
      requestWebsiteAccount("setup");
      return;
    }
    openSetup();
  }

  function handleProtectedUpgradeSimulation() {
    if (!websiteSession) {
      requestWebsiteAccount("upgrade");
      return;
    }
    setUpgradeSimulationOpen(true);
  }

  function handleManualSetup() {
    setSetupMode("manual");
    if (!accountCanUseCurrentBox) {
      requestWebsiteAccount("setup");
      return;
    }
    setSetupOpen(true);
  }

  function handleProtectedEditManualSchedule() {
    if (!accountCanUseCurrentBox) {
      requestWebsiteAccount("manual-edit");
      return;
    }
    handleEditManualSchedule();
  }

  function handleProtectedRun() {
    if (hasPersonalBox && !websiteSession) {
      requestWebsiteAccount("run");
      return;
    }
    if (!canRun) return;
    void handleRun();
  }

  function requireWebsiteAccountFromSetup() {
    setSetupOpen(false);
    requestWebsiteAccount("setup");
  }

  websiteIntentContinuationRef.current = (intent) => {
    if (intent === "setup") {
      setSetupOpen(true);
      return;
    }
    if (intent === "run") {
      if (cliReady) void handleRun();
      return;
    }
    if (intent === "upgrade") {
      setUpgradeSimulationOpen(true);
      return;
    }
    if (intent === "manual-edit") {
      handleEditManualSchedule();
      return;
    }
    if (intent === "manual") {
      router.push(workbenchHref("manual"));
      return;
    }
    if (intent === "mastery") {
      setMasteryPickerRequested(true);
      router.push(workbenchHref("mastery"));
      return;
    }
    router.push(workbenchHref(intent === "skland" ? "skland" : "account"));
  };

  function useSklandSnapshotFromSetup() {
    if (sklandScheduleSnapshot) applySklandSnapshot(sklandScheduleSnapshot);
  }

  function handleSklandAuthenticated(session: SklandSessionData) {
    const generation = beginSklandStateChange();
    sklandRestoreGuard.current.acceptFull(generation);
    setSklandError(null);
    applySklandSession(session);
  }

  function handleRetrySklandStatus() {
    setSklandError(null);
    statusLoadingAccount.current = null;
    setSklandStatusReloadKey((current) => current + 1);
  }

  async function handleDeleteAllSklandData() {
    const generation = beginSklandStateChange();
    setSklandBusy(true);
    setSklandError(null);
    try {
      await deleteAllSklandAccountData();
      if (!sklandRestoreGuard.current.acceptFull(generation)) return;
      const clearsBox = boxSource === "skland";
      const clearsLayout = layoutSource === "skland";
      const retainedLayout = clearsLayout
        ? localLayoutBackup ?? buildBlueprint(defaultPreset)
        : layout;
      const retainedPreset = clearsLayout
        ? resolvePreset(PRESETS.find((item) => item.label === retainedLayout.template))
        : preset;
      const retainedResult = clearsBox || clearsLayout ? null : result;
      try {
        persistSession(window.localStorage, {
          presetLabel: retainedPreset.label,
          layout: retainedLayout,
          operbox: clearsBox ? null : operbox,
          sourceName: clearsBox ? null : fileName,
          boxSource: clearsBox ? "sample" : boxSource,
          layoutDirty: clearsLayout ? false : layoutDirty,
          layoutSource: "local",
          localLayoutBackup: null,
          rotationProfile,
          result: retainedResult,
          activeShift: retainedResult ? activeShift : 0,
        });
      } catch {
        clearLocalProductData(window.localStorage);
        setStorageNotice(displayError(
          "AIC-LOCAL-7001",
          intl("App.theBrowserCouldNotRetainImportedDataSeparatelyThe")
        ));
      }
      setSklandAccounts([]);
      setSklandActiveAccountId(null);
      setSklandBindingSummary(emptySklandBindingSummary());
      setSklandScheduleSnapshot(null);
      setSklandStatusSnapshot(null);
      if (clearsBox) {
        setOperbox(null);
        setFileName(null);
        setBoxSource("sample");
        setResult(null);
        setActiveShift(0);
      }
      if (clearsLayout) {
        setPreset(retainedPreset);
        setLayout(retainedLayout);
        setLayoutSource("local");
        setLocalLayoutBackup(null);
        setLayoutDirty(false);
        setResult(null);
        setActiveShift(0);
      }
      clearIssueState();
    } catch (error) {
      if (!sklandRestoreGuard.current.isCurrent(generation)) return;
      setSklandError(toDisplayError(error, intl("App.couldNotDeleteSklandDataTryAgainLater")));
      throw error;
    } finally {
      if (sklandRestoreGuard.current.isCurrent(generation)) setSklandBusy(false);
    }
  }

  function handleClearLocalData() {
    try {
      clearLocalProductData(window.localStorage, [ONBOARDING_STORAGE_KEY, MANUAL_SCHEDULE_STORAGE_KEY, MOOD_STORAGE_KEY]);
      skipNextPersistence.current = true;
      setPreset(defaultPreset);
      setLayout(buildBlueprint(defaultPreset));
      setOperbox(null);
      setFileName(null);
      setBoxSource("sample");
      setManualShiftDurations([...DEFAULT_MANUAL_SHIFT_DURATIONS]);
      setManualShiftStartTime(DEFAULT_MANUAL_SHIFT_START_TIME);
      setManualScheduleMode("sequential");
      setManualFiammettaEnabled(false);
      setManualDraftHandoff(null);
      clearManualEvaluation();
      setLayoutDirty(false);
      setLayoutSource("local");
      setLocalLayoutBackup(null);
      setRotationProfile(DEFAULT_ROTATION_PROFILE);
      setResult(null);
      setActiveShift(0);
      setResultClearWarningDismissed(false);
      setOnboardingPreference("active");
      setStorageNotice(null);
      clearIssueState();
      setSetupOpen(false);
      router.push(workbenchHref("calculator"));
    } catch {
      setStorageNotice(displayError("AIC-LOCAL-7001", intl("App.theBrowserCouldNotClearLocalDataCheckSite")));
    }
  }

  async function handleRetry() {
    if (planRetryCountdown > 0) return;
    if (progressionAdjustmentActivity.active && progressionAdjustmentTask.pollStopped) {
      setProgressionAdjustmentActivity((current) => ({ ...current, loading: true, error: null }));
      progressionAdjustmentTask.resume();
      return;
    }
    if (apiError?.code === "AIC-PLAN-3001") {
      await runPlanForLayout(layout, true);
      return;
    }
    if (canRun) {
      await handleRun();
      return;
    }
    try {
      const health = await getHealth();
      setCliReady(health.plannerReady);
      setTaskQueueEnabled(Boolean(health.taskQueue?.enabled));
      setApiError(
        health.plannerReady
          ? null
          : displayError("AIC-PLAN-3001", intl("App.theSchedulingServiceIsTemporarilyUnavailableTryAgainLater"), true)
      );
    } catch (error) {
      setApiError(toDisplayError(error, intl("App.theSchedulingServiceIsTemporarilyUnavailableTryAgainLater")));
    }
  }

  const statusError = inputError && !setupOpen
    ? displayError(inputErrorCode, inputError)
    : apiError ?? storageNotice;
  const progressionAdjustmentPollError = progressionAdjustmentActivity.active
    && progressionAdjustmentTask.pollStopped
    && progressionAdjustmentTask.error
    ? displayError("AIC-PLAN-3004", progressionAdjustmentTask.error, true)
    : null;
  const activity = usePlanActivity({
    loading: progressionAdjustmentActivity.active
      ? progressionAdjustmentActivity.loading && !progressionAdjustmentTask.pollStopped
      : loading,
    error: progressionAdjustmentActivity.active
      ? progressionAdjustmentPollError ?? progressionAdjustmentActivity.error
      : statusError,
    completed: progressionAdjustmentActivity.active ? progressionAdjustmentActivity.completed : planTask.status === "done",
    completedMaa: progressionAdjustmentActivity.active ? progressionAdjustmentActivity.maa : planTask.result?.maa,
    kind: progressionAdjustmentActivity.active ? "progression-adjustment" : "schedule",
    queued: progressionAdjustmentActivity.active
      ? progressionAdjustmentActivity.loading && (
          progressionAdjustmentTask.status === "buffered"
          || progressionAdjustmentTask.status === "pending"
        )
      : loading && (
        planTask.status === "buffered"
        || planTask.status === "pending"
        || planTask.pollStopped
      ),
    queuePosition: progressionAdjustmentActivity.active ? progressionAdjustmentTask.queuePosition : planTask.queuePosition,
    etaSeconds: progressionAdjustmentActivity.active ? progressionAdjustmentTask.etaSeconds : planTask.etaSeconds,
    buffered: progressionAdjustmentActivity.active ? progressionAdjustmentTask.status === "buffered" : planTask.status === "buffered",
  });
  useEffect(() => {
    if (page !== "calculator" || !result?.maa) return;
    let cancelled = false;
    let cancelPreload: (() => void) | undefined;
    void import("@/schedule-portrait-preload").then((module) => {
      if (!cancelled) cancelPreload = module.scheduleNextShiftPortraitPreload(result.maa, activeShift);
    });
    return () => {
      cancelled = true;
      cancelPreload?.();
    };
  }, [activeShift, page, result?.maa]);
  const visiblePlanRevision = scheduleResult?.diagnosticId;
  const animatePlanEntrance = Boolean(
    page === "calculator"
    && visiblePlanRevision
    && !revealedPlanRevisions.current.has(visiblePlanRevision)
  );
  const animateEmptyScheduleEntrance = page === "calculator" && hasRenderedCalculator.current;
  const workbenchContext = {
    inventory: {
      identityKey: JSON.stringify([websiteUserId, sklandActiveAccountId, activeSklandAccount?.selectedUid ?? null]),
      pending: websiteSessionPending || !hasRestoredSession,
    },
    healthOperators: boxSource === "skland"
      ? sklandStatusSnapshot && sklandStatusSnapshot.player.uid === activeSklandAccount?.selectedUid
        ? { items: sklandStatusSnapshot.operators, source: "skland" as const } : undefined
      : accountCanUseCurrentBox && operbox ? { items: operbox, source: boxSource } : undefined,
    calculator: {
      layout,
      result,
      scheduleResult,
      activeShift,
      rows,
      activePlan,
      activeDronePlan,
      closestComparison,
      resultClearNotice,
      feedbackResult,
      operbox,
      sampleLoading,
      loading,
      canRun,
      runCooldownSeconds: planRetryCountdown,
      runOutcome: apiError ? "error" as const : planTask.status === "done" ? "success" as const : "idle" as const,
      hasBox,
      hasPersonalBox,
      feedbackDisabledForSampleBox,
      plannerReady: cliReady,
      websiteAuthenticated: Boolean(websiteSession),
      showOnboarding: onboardingPreference === "active" && !result,
      taskQueue: loading && planTask.taskId ? {
        queuePosition: planTask.queuePosition,
        etaSeconds: planTask.etaSeconds,
        pollStopped: planTask.pollStopped,
        error: planTask.error,
        resumeDisabled: planTask.resumeDisabled,
        resumeCountdown: planTask.resumeCountdown,
        onResumePoll: planTask.resume,
      } : null,
      animatePlanEntrance,
      animateEmptyScheduleEntrance,
      onPlanEntranceConsumed: (revision: string) => {
        revealedPlanRevisions.current.add(revision);
        // 只统计"本次生成"的首次渲染；切班次/重挂载不再重复打点。
        if (planClickAtRef.current !== null) {
          trackTelemetry({
            type: "interaction",
            name: "plan_render",
            page: "calculator",
            durationMs: Math.max(0, Math.round(performance.now() - planClickAtRef.current)),
          });
          planClickAtRef.current = null;
        }
      },
      requiresAccount: !accountCanUseCurrentBox,
      accountControl: CLIENT_SKLAND_ENABLED && activeSklandAccount ? (
        <SklandAccountControl
          account={activeSklandAccount}
          statusSnapshot={sklandStatusSnapshot}
          onOpenSkland={() => navigateToPage("skland")}
        />
      ) : undefined,
      onRunSampleTrial: handleRunSampleTrial,
      onStartPersonalFlow: handleStartPersonalFlow,
      onDismissOnboarding: dismissOnboarding,
      onOpenSetup: handleProtectedSetup,
      upgradeSimulationOpen,
      onOpenUpgradeSimulation: handleProtectedUpgradeSimulation,
      onUpgradeSimulationOpenChange: setUpgradeSimulationOpen,
      onRun: handleProtectedRun,
      onAutoDroneAllocation: handleAutoDroneAllocation,
      onManualDroneAllocation: handleManualDroneAllocation,
      manualDroneSelection: Boolean(manualDroneShifts[activeShift]),
      onSimulateUpgrades: handleSimulateUpgrades,
      upgradeComparison: upgradeComparison?.baseline === result ? { trial: upgradeComparison.trial } : null,
      scheduleVariant,
      onScheduleVariantChange: setScheduleVariant,
      onUpgradeTrialReady: (trial: PublicPlanData) => {
        if (!result) return;
        setUpgradeComparison({ baseline: result, trial: withDefaultDormAutofill(trial) });
        setScheduleVariant("trial");
        setActiveShift(0);
      },
      onCancelRun: handleCancelRun,
      onSetActiveShift: setActiveShift,
      onMarkIssue: handleMarkIssue,
      onPerformanceIssue: handlePerformanceIssue,
      onFactoryRecipeChange: handleScheduleFactoryRecipeChange,
      onTradeOrderChange: handleScheduleTradeOrderChange,
      onSwapOperators: handleSwapCalculatorOperators,
      droneTargetRoomId: activeDronePlan?.drones?.enable ? (() => {
        const kind = activeDronePlan.drones.room === "trading" ? "trade_post" : "factory";
        return layout.rooms.filter((room) => room.kind === kind)[activeDronePlan.drones.index - 1]?.id ?? null;
      })() : null,
      onDroneTargetChange: handleScheduleDroneTargetChange,
      onEditManualSchedule: handleProtectedEditManualSchedule,
      onDownloadMaa: handleDownloadMaa,
      onDownloadImage: handleDownloadScheduleImage,
      onClearResultNotice: () => setResultClearNotice(null),
      onDismissResultClearWarning: dismissResultClearWarning,
      showProgressionRecalculate: userSettings.showProgressionRecalculate,
      showManualScheduleEdit: userSettings.showManualScheduleEdit,
      scheduleViewControl: userSettings.scheduleViewControl,
      shiftViewControl: userSettings.linkShiftViewControl ? userSettings.scheduleViewControl : userSettings.shiftViewControl,
      imageExportScope: userSettings.imageExportScope,
      showFeedback: userSettings.showFeedback,
      showImages: userSettings.showImages,
      allowReplacementOperatorSort: userSettings.allowReplacementOperatorSort,
      highlightNoLayoutSkill: userSettings.highlightNoLayoutSkill,
    },
    manual: {
      layout,
      operbox: accountCanUseCurrentBox ? operbox : null,
      sourceName: accountCanUseCurrentBox ? fileName : null,
      shiftDurations: manualShiftDurations,
      shiftStartTime: manualShiftStartTime,
      scheduleMode: manualScheduleMode,
      fiammettaEnabled: effectiveManualFiammettaEnabled,
      initialDraft: accountCanUseCurrentBox ? manualDraftHandoff : null,
      restorationReady: hasRestoredSession,
      onInitialDraftConsumed: () => setManualDraftHandoff(null),
      result: manualPlanResult,
      evaluationPending: manualEvaluationPending,
      onEvaluate: evaluateManualScheduleFromPage,
      onPaperEvaluate: evaluatePaperManualScheduleFromPage,
      onRestoreEvaluation: restoreManualEvaluation,
      onOpenCalculator: () => navigateToPage("calculator"),
      onShiftDurationsChange: setManualShiftDurations,
      onShiftStartTimeChange: setManualShiftStartTime,
      onScheduleModeChange: setManualScheduleMode,
      onImportedLayoutChange: handleManualImportedLayout,
      showMower: userSettings.showMower,
      onFiammettaEnabledChange: setManualFiammettaEnabled,
      onOpenSetup: handleManualSetup,
      onFactoryRecipeChange: handleFactoryRecipeChange,
      onTradeOrderChange: handleTradeOrderChange,
      strictMaaOperatorOrder: userSettings.strictMaaOperatorOrder,
      allowReplacementOperatorSort: userSettings.allowReplacementOperatorSort,
      scheduleViewControl: userSettings.scheduleViewControl,
      shiftViewControl: userSettings.linkShiftViewControl ? userSettings.scheduleViewControl : userSettings.shiftViewControl,
      imageExportScope: userSettings.imageExportScope,
      showImages: userSettings.showImages,
    },
    training: {
      operbox: accountCanUseCurrentBox ? operbox : null,
      layout,
      profile: accountCanUseCurrentBox ? sklandTrainingSync?.data?.profile ?? result?.profile : null,
      trainingAdvice: accountCanUseCurrentBox ? (sklandTrainingSync?.data ? sklandTrainingSync.data.trainingAdvice ?? null : result?.trainingAdvice ?? null) : null,
      sync: sklandTrainingSync ?? undefined,
      requiresAccount: !accountCanUseCurrentBox,
      onOpenCalculator: () => navigateToPage("calculator"),
    },
    recruitment: {
      operbox: accountCanUseCurrentBox && boxSource !== "sample" ? operbox : null,
      sourceName: accountCanUseCurrentBox && boxSource !== "sample" ? fileName : null,
      pending: websiteSessionPending || !hasRestoredSession,
      onOpenSetup: () => { if (!websiteSession) requestWebsiteAccount("setup"); else handleProtectedSetup(); },
    },
    mastery: {
      operbox: accountCanUseCurrentBox ? operbox : null,
      sourceName: accountCanUseCurrentBox ? fileName : null,
      requiresAccount: !websiteSession && !(boxSource === "sample" && hasBox),
      pending: websiteSessionPending || !hasRestoredSession,
      identityKey: `${websiteUserId ?? "anonymous"}:${sklandActiveAccountId ?? "local"}`,
      onOpenSetup: () => { if (!websiteSession) requestWebsiteAccount("setup"); else handleProtectedSetup(); },
      onRequestAccount: () => requestWebsiteAccount("mastery"),
      pickerRequested: masteryPickerRequested,
      onPickerRequestConsumed: () => setMasteryPickerRequested(false),
    },
    account: {
      authenticated: Boolean(websiteSession),
      pending: websiteSessionPending,
      onSessionChanged: handleWebsiteSessionChanged,
      ...(CLIENT_ACCOUNT_CLOUD_SYNC_ENABLED ? {
        cloudWorkspace: accountCloudWorkspace.cloudWorkspaceData,
        cloudSyncStatus: accountCloudWorkspace.cloudSyncStatus,
        onRestoreSavedPlan: (saved: SavedPlanData) => {
          const context = saved.calculationContext;
          if (!context) return;
          const restoredPreset = resolvePreset(PRESETS.find((item) => item.label === context.presetLabel));
          const restoredLayout = structuredClone(context.layout);
          setPreset(restoredPreset);
          setLayout(restoredLayout);
          setLayoutDirty(JSON.stringify(restoredLayout) !== JSON.stringify(buildBlueprint(restoredPreset)));
          setLayoutSource("local");
          setLocalLayoutBackup(null);
          setRotationProfile(context.rotationProfile);
          setFiammettaEnabled(context.fiammettaEnabled);
          setResult(saved.result);
          setActiveShift(0);
          router.push(workbenchHref("calculator"));
        },
        onCloudDataChanged: accountCloudWorkspace.refreshCloudData,
      } : {}),
    },
    settings: {
      value: userSettings,
      onChange: handleUserSettingsChange,
    },
    skland: CLIENT_SKLAND_ENABLED ? {
      websiteAuthenticated: Boolean(websiteSession),
      websiteSessionPending,
      bindingSummary: sklandBindingSummary,
      onOpenAccount: () => navigateToPage("account"),
      skland: {
        scheduleSnapshot: sklandScheduleSnapshot,
        snapshot: sklandStatusSnapshot,
        accounts: sklandAccounts,
        activeAccountId: sklandActiveAccountId,
        bindingCount: sklandBindingCount,
        sessionLoading: sklandSessionLoading,
        layoutMatches: sklandLayoutMatches ?? false,
        layoutDirty,
        configured: sklandConfigured,
        disabledReason: sklandDisabledReason,
        busy: sklandBusy,
        error: sklandError,
        onAuthenticated: handleSklandAuthenticated,
        onRoleChange: handleSklandRole,
        onLogout: handleSklandLogout,
        onRetryStatus: handleRetrySklandStatus,
        onDeleteAllData: handleDeleteAllSklandData,
        onApplyLayout: handleApplySklandLayout,
        onContinueSetup: () => {
          setSetupOpen(true);
        },
        onOpenCalculator: () => navigateToPage("calculator"),
        onCopyUid: (uid: string) => {
          void import("./download").then(({ copyText }) => copyText(uid));
        },
      },
    } : null,
  };

  return (
    <AppMotionProvider>
      <TooltipProvider>
    <div
      className="contents"
      data-workbench-hydrated={hasRestoredSession ? "true" : "false"}
      onKeyDown={(event) => {
        if (event.key === "Escape" && websiteAuthDialogOpen) handleWebsiteAuthDialogOpenChange(false);
      }}
    >
    <SidebarProvider defaultOpen defaultOpenBreakpoint={1280} style={{ "--sidebar-width": "14rem", "--sidebar-width-icon": "3.25rem" } as React.CSSProperties}>
      {trainingSyncLoaded || page === "training" ? (
        <Suspense fallback={null}>
          <SklandTrainingSyncBridge options={sklandTrainingSyncOptions} onChange={setTrainingSyncSnapshot} />
        </Suspense>
      ) : null}
      <AppSidebar page={page} onPageChange={handleAppPageChange} showMower={userSettings.showMower} />
      <SidebarInset className="isolate">
        <DotDistortionBackground />
        {page !== "agent" ? <AppTopBar /> : null}
        {agentArtifactNotice && page !== "agent" ? (
          <div className="flex flex-wrap items-center gap-3 border-b bg-[#FFD501]/15 px-4 py-2 text-sm" data-agent-artifact-banner>
            <span className="min-w-0">
              {intl("App.agentArtifactBannerText", { preset: agentArtifactNotice.preset ? `（${agentArtifactNotice.preset}）` : "" })}
            </span>
            <button
              type="button"
              disabled={agentArtifactLoading}
              className="rounded-md bg-[#FFD501] px-3 py-1 text-xs font-medium text-black disabled:opacity-50"
              onClick={() => void applyAgentArtifact(agentArtifactNotice)}
            >
              {agentArtifactLoading ? intl("App.agentArtifactLoading") : intl("App.agentArtifactOpen")}
            </button>
            <button
              type="button"
              className="rounded-md border px-3 py-1 text-xs hover:bg-muted"
              onClick={() => setAgentArtifactNotice(null)}
            >
              {intl("App.agentArtifactIgnore")}
            </button>
          </div>
        ) : null}
        {agentArtifactApplied ? (
          <div className="flex flex-wrap items-center gap-3 border-b bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-300" data-agent-artifact-applied-banner>
            <span className="min-w-0">
              {intl("App.agentArtifactAppliedText", { preset: agentArtifactApplied.preset ? `（${agentArtifactApplied.preset}）` : "" })}
            </span>
            <button
              type="button"
              className="rounded-md border px-3 py-1 text-xs hover:bg-muted"
              onClick={() => setAgentArtifactApplied(null)}
            >
              {intl("App.agentArtifactIgnore")}
            </button>
          </div>
        ) : null}
        {agentArtifactError ? (
          <div className="flex flex-wrap items-center gap-3 border-b bg-destructive/10 px-4 py-2 text-sm text-destructive" data-agent-artifact-error-banner>
            <span className="min-w-0">{intl("App.agentArtifactErrorText")}</span>
            <button
              type="button"
              className="rounded-md border px-3 py-1 text-xs hover:bg-muted"
              onClick={() => setAgentArtifactError(false)}
            >
              {intl("App.agentArtifactIgnore")}
            </button>
          </div>
        ) : null}
        <LiveActivity
          activity={activity}
          onRetry={() => void handleRetry()}
          retryCountdownSeconds={planRetryCountdown}
          onCopyDiagnostic={() => {
            const error = activity?.error;
            if (!error) return;
            void Promise.all([import("./download"), import("./solver-diagnostic")])
              .then(([{ copyText }, { formatSolverDiagnostic }]) => copyText(formatSolverDiagnostic(error, locale === "en")));
          }}
        />

      <div
        className={page === "calculator" && !scheduleResult && onboardingPreference === "active"
          ? "w-full flex-1"
          : page === "agent" ? "app-content-track py-0 md:py-4" : "app-content-track py-4"}
        data-app-content
        inert={!hasRestoredSession}
        aria-busy={!hasRestoredSession}
      >
      <WorkbenchContext.Provider value={workbenchContext}>
        <PrimaryPageTransition pageKey={page}>{children}</PrimaryPageTransition>
      </WorkbenchContext.Provider>
      </div>

      {page !== "agent" ? <footer className="app-content-track workbench-footer mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/70 py-5 text-xs text-muted-foreground">
        <div className="w-full md:w-auto max-md:[&>div]:h-12 max-md:[&_button]:h-11 max-md:[&_button]:min-w-12 max-md:[&_span]:h-11"><LanguageSwitch /></div>
        <div className="flex w-full flex-wrap items-center gap-x-4 md:contents">
        <Link prefetch={false} className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground" href="/help" data-help-link>{intl("App.help")}</Link>
        <Link prefetch={false} className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground" href="/terms">{intl("App.terms")}</Link>
        <Link prefetch={false} className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground" href="/privacy">{intl("App.privacy")}</Link>
        <a className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground" href="/about" data-about-link>{intl("App.about")}</a>
        </div>
        <div className="flex w-full min-w-0 flex-col items-start gap-x-3 gap-y-1 md:ml-auto md:w-auto md:flex-row md:flex-wrap md:items-center md:justify-end">
          <FilingLinks />
          <span className="h-4 w-px shrink-0 bg-border max-md:hidden" aria-hidden="true" />
          <a
            href="https://www.rainyun.com/riic_"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={intl("App.sponsoredByRainyunOpensInANewTab")}
            data-rainyun-link
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-1 text-[11px] leading-none opacity-70 outline-none transition-[opacity,transform] duration-180 ease-[var(--motion-ease-out)] hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-foreground/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            <span className="block leading-none" data-rainyun-copy>{intl("App.sponsoredBy")}</span>
            <img
              src="/images/partners/rainyun-logo.png"
              alt=""
              width={1120}
              height={390}
              loading="eager"
              decoding="async"
              className="block h-5 w-14 -translate-y-0.5 object-contain sm:h-[23px] sm:w-16"
            />
            {locale === "en" ? null : <span className="block leading-none">提供云计算服务</span>}
          </a>
        </div>
      </footer> : null}

      {CLIENT_ACCOUNT_CLOUD_SYNC_ENABLED ? accountCloudWorkspace.syncElement : null}
      {hasRestoredSession ? <Suspense fallback={null}>
        <ReleaseAnnouncement enabled={!websiteSessionPending && !websiteAuthDialogOpen && !setupOpen && !issueOpen && !pendingProductChange && !pendingManualDraftReplacement && !loading} />
      </Suspense> : null}

      {websiteAuthDialogMounted ? <Suspense fallback={(
        <WebsiteAccountDialogLoading open={websiteAuthDialogOpen} onOpenChange={handleWebsiteAuthDialogOpenChange} />
      )}><WebsiteAccountDialog
          open={websiteAuthDialogOpen}
          onOpenChange={handleWebsiteAuthDialogOpenChange}
          onSessionChanged={handleWebsiteSessionChanged}
        /></Suspense> : null}

      {setupMounted ? <Suspense fallback={(
        <SetupDialogSkeleton open={setupOpen} onOpenChange={handleSetupOpenChange} />
      )}><SetupDialog
        {...(CLIENT_SKLAND_ENABLED ? {
          sklandSnapshot: sklandScheduleSnapshot,
          sklandBindingCount,
          sklandConfigured,
          sklandDisabledReason,
          onOpenSkland: openSklandFromSetup,
          onUseSklandSnapshot: useSklandSnapshotFromSetup,
        } : {})}
        open={setupOpen}
        mode={setupMode}
        onOpenChange={handleSetupOpenChange}
        operbox={operbox}
        boxSource={boxSource}
        fileName={fileName}
        inputMode={inputMode}
        onInputModeChange={setInputMode}
        maaPaste={maaPaste}
        onMaaPasteChange={setMaaPaste}
        inputError={inputError}
        resultClearWarningDismissed={resultClearWarningDismissed}
        onMaaFile={handleFile}
        onMaaPaste={handleMaaPaste}
        onManualBox={handleManualBox}
        onRequireWebsiteAccount={requireWebsiteAccountFromSetup}
        presets={PRESETS}
        preset={preset}
        layout={layout}
        configurationKey={setupMode === "manual" ? `${setupConfigurationKey}:${manualScheduleMode}:${manualShiftStartTime}:${manualShiftDurations.join(",")}:${manualFiammettaEnabled}` : setupConfigurationKey}
        rotationProfile={setupMode === "manual" ? DEFAULT_ROTATION_PROFILE : rotationProfile}
        onRotationProfileChange={handleRotationProfileChange}
        manualShiftDurations={manualShiftDurations}
        onManualShiftDurationsChange={setManualShiftDurations}
        manualShiftStartTime={manualShiftStartTime}
        onManualShiftStartTimeChange={setManualShiftStartTime}
        manualScheduleMode={manualScheduleMode}
        onManualScheduleModeChange={setManualScheduleMode}
        fiammettaEnabled={setupMode === "manual" ? effectiveManualFiammettaEnabled : effectiveFiammettaEnabled}
        onFiammettaEnabledChange={setupMode === "manual" ? setManualFiammettaEnabled : handleFiammettaEnabledChange}
        onPresetSelect={handlePresetSelect}
        onLayoutFile={handleLayoutFile}
        onDownloadLayout={() => {
          void import("./download").then(({ downloadJson }) => downloadJson(`layout-${layout.template}.json`, layout));
        }}
        onRestoreResultClearWarning={restoreResultClearWarning}
        storageNotice={storageNotice}
        onClearLocalData={handleClearLocalData}
        onFactoryRecipeChange={handleFactoryRecipeChange}
        onTradeOrderChange={handleTradeOrderChange}
        onRoomLevelChange={handleRoomLevelChange}
        powerBudget={powerBudget}
        onFinish={closeSetup}
        onSkip={closeSetup}
      /></Suspense> : null}

      {issueModalMounted ? <Suspense fallback={null}><IssueNoteModal
        open={issueOpen}
        kind={issueDraftKind}
        row={issueDraftRow}
        note={issueDraftNote}
        saving={feedbackSaving}
        onNoteChange={setIssueDraftNote}
        onSave={handleSaveIssue}
        onCancel={handleCancelIssue}
      /></Suspense> : null}
      {productModalMounted ? <Suspense fallback={null}><ProductChangeConfirmModal
        open={Boolean(pendingProductChange)}
        roomLabel={rows.find((row) => row.roomId === pendingProductChange?.roomId)?.title ?? pendingProductChange?.roomId ?? (intl("App.currentFacility"))}
        changeKind={pendingProductChange?.type === "trade" ? "贸易策略" : "制造配方"}
        nextValueLabel={pendingProductChange ? productChangeLabel(pendingProductChange) ?? (intl("App.newSetting")) : (intl("App.newSetting"))}
        busy={loading && Boolean(pendingProductChange)}
        onConfirm={() => void confirmScheduleProductChange()}
        onCancel={() => setPendingProductChange(null)}
      /></Suspense> : null}
      {pendingManualDraftReplacement ? <Suspense fallback={null}><ManualDraftReplaceDialog
        draft={pendingManualDraftReplacement}
        onCancel={() => setPendingManualDraftReplacement(null)}
        onConfirm={confirmManualDraftReplacement}
      /></Suspense> : null}
      </SidebarInset>
    </SidebarProvider>
    </div>
      </TooltipProvider>
    </AppMotionProvider>
  );
}

function WorkbenchApp({ children }: { children: ReactNode }) {
  return <WorkbenchAppContent>{children}</WorkbenchAppContent>;
}

export default WorkbenchApp;
