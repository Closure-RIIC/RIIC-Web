"use client";

import { lazyWithMessages } from "@/i18n/features-client";
import { useLocale as useRawLocale } from "use-intl";
import { createLocalizer as createRawLocalizer, richValue } from "@riic/arknights-domain/i18n/localize";
import type RawMessages from "../../../messages/zh-CN/AK_Raw_components_pages_SklandStatus.json";
const rawText = createRawLocalizer<typeof RawMessages>("AK_Raw_components_pages_SklandStatus");
import type { AppLocale } from "@riic/contracts/locale";
import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../../messages/zh-CN/AK_components_pages_SklandStatus.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_components_pages_SklandStatus");

import { localize as localize_components_pages_SklandStatus } from "../../i18n/helpers/components_pages_SklandStatus.ts";
import { useTranslations, useLocale } from "use-intl";
import { usePathname } from "@/navigation";
import { Link } from "@tanstack/react-router";
import { sklandTabHref, sklandTabFromPathname } from "@/workbench-routes";
import { messageRecord } from "@/i18n/translate";

import { Suspense, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Boxes,
  Building2,
  Check,
  Database,
  DoorOpen,
  HeartPulse,
  LogOut,
  PackageCheck,
  Search,
  Shirt,
  Trash2,
  UserPlus,
  UsersRound,
  Zap,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { RecyclingRoomPlaceholder } from "@/components/RecyclingRoomPlaceholder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SetupActionButton } from "@/components/setup/SetupActionButton";
import { SklandAccountSelect } from "@/components/skland/SklandAccountSelect";
import { SklandPlayerIdentity } from "@/components/skland/SklandPlayerIdentity";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
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
const InventoryPage = lazyWithMessages(() => import("@/components/pages/InventoryPage"), "apps/arknights/src/components/pages/InventoryPage.tsx");
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonRouteFallback } from "@/components/ui/skeleton-swap";
import { HoldToConfirm } from "@/components/ui/hold-to-confirm";
import { Tabs, TabsContent, TabsList, CompactTabsList, TabsTrigger } from "@/components/ui/tabs";
import { LevelDiamonds, OperatorSlot, roomVisualFor } from "@/components";
import {
  InfraTechnicalCard as OverviewTechnicalCard,
  InfraTechnicalHeading as OverviewTechnicalHeading,
} from "@/components/InfraTechnicalCard";
import {
  StatusCenterHeader,
  StatusCenterLoading,
  StatusCenterPage,
} from "@/components/pages/StatusCenterShell";
import { cn } from "@/lib/utils";
import { localizedOperatorName } from "@/i18n/game-data";
import { useGameCatalog } from "@/i18n/game-data-client";
import { operatorPortraitFor, operatorProfessionFor } from "@/operatorPortraits";
import { roomGridTone } from "@/schedule-view-presentation";
const SklandLoginPanel = lazyWithMessages(() => import("@/skland-components").then((module) => ({ default: module.SklandLoginPanel })), "apps/arknights/src/skland-components.tsx");
import {
  deriveSklandBuildingMetrics,
  sklandTradingOrderRewardLabel,
  type SklandStatusMetric,
} from "@/skland-status-metrics";
import type {
  DisplayError,
  SklandAccountSummary,
  SklandBindingSummary,
  SklandInfrastructureRoom,
  SklandOperatorStatus,
  SklandOwnedSkin,
  SklandSessionData,
  SklandScheduleSnapshot,
  SklandStatusSnapshot,
} from "@riic/arknights-domain/types";
import { deriveSklandBindingState } from "@riic/arknights-domain/skland-binding-state";

const ROOM_KEYS = {"control":"control","trading":"trading","manufacture":"manufacture","power":"power","dormitory":"dormitory","meeting":"meeting","hire":"hire","processing":"processing","training":"training"} as const;

const INITIAL_LIST_LIMIT = 60;
const rarityOptions = (locale: AppLocale) => [
  { value: "all", label: rawText.text(locale, "allRarities") },
  ...[6, 5, 4, 3, 2, 1].map((value) => ({ value: String(value), label: rawText.text(locale, "rarityStars", { value }) })),
];

type FilterOption = {
  value: string;
  label: string;
};

function OperatorFilterCombobox({
  label,
  value,
  options,
  onValueChange,
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onValueChange: (value: string) => void;
}) {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale;
  const [query, setQuery] = useState<string | null>(null);
  const selected = options.find((option) => option.value === value) ?? null;

  return (
    <Combobox
      items={options}
      value={selected}
      inputValue={query ?? selected?.label ?? ""}
      itemToStringValue={(option) => option.label}
      isItemEqualToValue={(option, selectedOption) => option.value === selectedOption.value}
      autoHighlight
      onInputValueChange={(inputValue) => setQuery(inputValue)}
      onOpenChange={(open) => {
        if (!open) setQuery(null);
      }}
      onValueChange={(option) => {
        if (option) {
          setQuery(null);
          onValueChange(option.value);
        }
      }}
    >
      <ComboboxInput className="font-number h-11 w-full" aria-label={label} placeholder={intl("components_pages_SklandStatus.search", { label: en === "en" ? (((label.toLocaleLowerCase("en-US")))) : (((label))) })} />
      <ComboboxContent>
        <ComboboxEmpty>{intl("components_pages_SklandStatus.noMatching", { label: en === "en" ? (((label.toLocaleLowerCase("en-US")))) : (((label))) })}</ComboboxEmpty>
        <ComboboxList>
          {(option) => (
            <ComboboxItem key={option.value} value={option} className="font-number">
              {option.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
export interface SklandStatusProps {
  scheduleSnapshot: SklandScheduleSnapshot | null;
  snapshot: SklandStatusSnapshot | null;
  accounts: SklandAccountSummary[];
  activeAccountId: string | null;
  bindingCount: number;
  bindingSummary: SklandBindingSummary;
  sessionLoading: boolean;
  layoutMatches: boolean;
  layoutDirty: boolean;
  configured: boolean;
  disabledReason: string | null;
  busy: boolean;
  error: DisplayError | null;
  onAuthenticated: (session: SklandSessionData) => void;
  onRoleChange: (accountId: string, uid: string) => Promise<void>;
  onLogout: () => Promise<void>;
  onRetryStatus: () => void;
  onDeleteAllData: () => Promise<void>;
  onApplyLayout: () => void;
  onContinueSetup: () => void;
  onOpenCalculator: () => void;
  onCopyUid: (uid: string) => void;
}

function credentialExpiryLabel(timestamp: number, en: AppLocale = "zh-CN"): string {
  return new Intl.DateTimeFormat((en === "en" ? "en-US" : "zh-CN"), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function SklandDataControls({
  account,
  busy,
  onDeleteAllData,
}: {
  account: SklandAccountSummary;
  busy: boolean;
  onDeleteAllData: () => Promise<void>;
}) {
  const intl = useTranslations();
  const locale = useLocale();

  return (
    <section className="grid gap-3 pt-2" data-skland-data-controls>
      <div>
        <h2 className="text-sm font-semibold">{intl("components_pages_SklandStatus.dataManagement")}</h2>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground" data-ui-number-font>
          {intl.rich("components_pages_SklandStatus.rich1", { value2: () => credentialExpiryLabel(account.credentialExpiresAt, locale) })}
        </p>
      </div>
      <HoldToConfirm
        disabled={busy}
        confirmLabel={intl("components_pages_SklandStatus.deleting")}
        className="w-full sm:w-fit"
        onConfirm={() => void onDeleteAllData().catch(() => {
          // 上层统一展示删除失败信息；此处只避免产生未处理的 Promise rejection。
        })}
      >
        <Trash2 className="size-4" />{intl("components_pages_SklandStatus.holdToDeleteAllSklandData")}
      </HoldToConfirm>
    </section>
  );
}
function formatDateTime(timestamp: number | null, en: AppLocale = "zh-CN"): string {
  const date = timestamp !== null && timestamp > 0 && Number.isFinite(timestamp)
    ? new Date(timestamp * 1000)
    : null;
  if (!date || Number.isNaN(date.getTime())) return localize_components_pages_SklandStatus.text(en, "notProvided");
  return new Intl.DateTimeFormat((en === "en" ? "en-US" : "zh-CN"), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatCompactDateTime(timestamp: number | null, en: AppLocale = "zh-CN"): string {
  const date = timestamp !== null && timestamp > 0 && Number.isFinite(timestamp)
    ? new Date(timestamp * 1000)
    : null;
  if (!date || Number.isNaN(date.getTime())) return localize_components_pages_SklandStatus.text(en, "notProvided");
  const time = [date.getHours(), date.getMinutes()]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()} ${time}`;
}

function formatDate(timestamp: number | null, en: AppLocale = "zh-CN"): string {
  const date = timestamp !== null && timestamp > 0 && Number.isFinite(timestamp)
    ? new Date(timestamp * 1000)
    : null;
  if (!date || Number.isNaN(date.getTime())) return localize_components_pages_SklandStatus.text(en, "notProvided");
  return new Intl.DateTimeFormat((en === "en" ? "en-US" : "zh-CN"), { dateStyle: "medium" }).format(date);
}

function formatDuration(seconds: number, en: AppLocale = "zh-CN"): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (!safeSeconds) return localize_components_pages_SklandStatus.text(en, "complete");
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours > 0) return localize_components_pages_SklandStatus.text(en, "hM", { hours: hours, minutes: minutes });
  return localize_components_pages_SklandStatus.text(en, "m", { value1: Math.max(1, minutes) });
}

function useMinuteTimestamp(baseTimestamp: number): number {
  const [elapsedMinutes, setElapsedMinutes] = useState(0);
  useEffect(() => {
    setElapsedMinutes(0);
    const timer = window.setInterval(() => setElapsedMinutes((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, [baseTimestamp]);
  return baseTimestamp + elapsedMinutes * 60;
}

function roomLabel(room: SklandInfrastructureRoom, en: AppLocale = "zh-CN"): string {
  const base = rawText.text(en, ROOM_KEYS[room.group]);
  return ["control", "meeting", "hire", "processing", "training"].includes(room.group) ? base : `${base} ${room.index + 1}`;
}

function roomMaxLevel(room: SklandInfrastructureRoom): number {
  return room.group === "control" || room.group === "dormitory" ? 5 : 3;
}

function professionLabel(profession: string, en: AppLocale = "zh-CN"): string {
  return (messageRecord(en, "components_pages_SklandStatus_labels"))[profession] ?? profession;
}

function ProgressMeter({
  label,
  current,
  total,
  technical = false,
}: {
  label: string;
  current: number;
  total: number;
  technical?: boolean;
}) {
  const safeTotal = Number.isFinite(total) ? Math.max(0, total) : 0;
  const safeCurrent = Number.isFinite(current) ? Math.max(0, current) : 0;
  const percent = safeTotal > 0 ? Math.min(100, Math.round((safeCurrent / safeTotal) * 100)) : 0;
  const ariaMax = Math.max(1, safeTotal);
  const ariaCurrent = Math.min(ariaMax, safeCurrent);
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-4 text-xs">
        <span className={technical ? "text-white/58" : "text-muted-foreground"}>{label}</span>
        <span className={cn("font-medium tabular-nums", technical && "text-[var(--room-accent)]")}>
          {safeCurrent}/{safeTotal}
        </span>
      </div>
      <div
        className={cn(
          "h-1.5 overflow-hidden",
          technical ? "bg-white/12" : "rounded-full bg-muted"
        )}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={ariaMax}
        aria-valuenow={ariaCurrent}
      >
        <div
          className={cn("h-full", technical ? "bg-[var(--room-accent)]" : "rounded-full bg-primary")}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
function OverviewTab({
  snapshot,
  onContinueSetup,
  onOpenCalculator,
}: {
  snapshot: SklandStatusSnapshot;
  onContinueSetup: () => void;
  onOpenCalculator: () => void;
}) {
  const intl = useTranslations();
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  const en = locale;
  const { infrastructure, player, progress } = snapshot;
  const fullProductionRooms = infrastructure.rooms.filter(
    (room) =>
      (room.group === "trading" || room.group === "manufacture")
      && room.production.stock !== null
      && room.production.capacity !== null
      && room.production.capacity > 0
      && room.production.stock >= room.production.capacity
  );
  const readyRecruit = (progress.recruit ?? []).filter(
    (slot) => slot.state === "completed"
      || (slot.state === "recruiting" && slot.finishTs > 0 && slot.finishTs <= infrastructure.currentTs)
  );
  const dronesFull = infrastructure.labor.maxValue > 0
    && infrastructure.labor.value >= infrastructure.labor.maxValue;
  const attentionItems = [
    infrastructure.tiredOperators.length
      ? intl("components_pages_SklandStatus.operatorsHaveLowMorale", { length: infrastructure.tiredOperators.length })
      : null,
    fullProductionRooms.length
      ? intl("components_pages_SklandStatus.productionFacilitiesAreFull", { length: fullProductionRooms.length })
      : null,
    readyRecruit.length ? intl("components_pages_SklandStatus.recruitmentSlotsAreComplete", { length: readyRecruit.length }) : null,
    dronesFull ? (intl("components_pages_SklandStatus.dronesHaveReachedCapacity")) : null,
  ].filter((item): item is string => Boolean(item));

  return (
    <div className="grid gap-3">
      <section
        className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3"
        aria-label={intl("components_pages_SklandStatus.needsAttention")}
      >
        <OverviewTechnicalCard group="manufacture" className="min-h-40 xl:col-span-2">
          <div className="flex h-full flex-col">
            <div className="flex items-start justify-between gap-4">
              <div>
                <OverviewTechnicalHeading icon={<AlertTriangle className="size-4" aria-hidden="true" />}>
                  {intl("components_pages_SklandStatus.needsAttention")}
                </OverviewTechnicalHeading>
                <p className="font-number mt-3 text-lg font-semibold">
                  {attentionItems.length ? (intl("components_pages_SklandStatus.statusAlerts", { length: attentionItems.length })) : (intl("components_pages_SklandStatus.infrastructureRunningSmoothly"))}
                </p>
              </div>
              <strong className="text-4xl font-semibold tabular-nums text-[var(--room-accent)]">
                {attentionItems.length}
              </strong>
            </div>
            <div className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {attentionItems.length ? attentionItems.map((item) => (
                <div key={item} className="flex items-start gap-2 border-t border-white/10 pt-2 text-sm text-white/82">
                  <AlertTriangle
                    className="mt-0.5 size-3.5 shrink-0 text-[var(--room-accent)]"
                    aria-hidden="true"
                  />
                  <span className="font-number">{item}</span>
                </div>
              )) : (
                <p className="border-t border-white/10 pt-2 text-sm text-white/58 sm:col-span-2">
                  {intl("components_pages_SklandStatus.noInventoryRecruitmentTrainingOrMoraleAlerts")}
                </p>
              )}
            </div>
          </div>
        </OverviewTechnicalCard>

        <OverviewTechnicalCard group="control" className="min-h-40">
          <div className="grid h-full content-between gap-4">
            <div>
              <OverviewTechnicalHeading icon={<Database className="size-4" aria-hidden="true" />}>
                {intl("components_pages_SklandStatus.syncedToScheduler")}
              </OverviewTechnicalHeading>
              <p className="mt-4 text-2xl font-semibold tabular-nums text-[var(--room-accent)]">
                {snapshot.operbox.length}
                <span className="ml-1 text-sm font-normal text-white/60">{intl("components_pages_SklandStatus.operators")}</span>
              </p>
              <p className="font-number mt-1 text-xs text-white/58">
                {intl("components_pages_SklandStatus.currentLayout")} · {infrastructure.layoutLabel ?? (intl("components_pages_SklandStatus.unrecognized"))}
              </p>
            </div>
            <div className="flex flex-wrap justify-start gap-2">
              <Button
                type="button"
                size="dialog"
                className="bg-white text-[#272a2b] hover:bg-white/90"
                onClick={onOpenCalculator}
              >
                {intl("components_pages_SklandStatus.generateSchedule")}
              </Button>
              <Button
                type="button"
                size="dialog"
                className="border-white/22 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                variant="outline"
                onClick={onContinueSetup}
              >
                {intl("components_pages_SklandStatus.continueLayoutSetup")}
              </Button>
            </div>
          </div>
        </OverviewTechnicalCard>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label={intl("components_pages_SklandStatus.statusSummary")}>
        <OverviewTechnicalCard group="trading" className="min-h-36 md:col-span-2 xl:col-span-1">
          <div className="flex h-full flex-col">
            <OverviewTechnicalHeading icon={<HeartPulse className="size-4" aria-hidden="true" />}>
              {intl("components_pages_SklandStatus.currentSanity")}
            </OverviewTechnicalHeading>
            <div className="mt-5 flex items-end gap-1">
              <strong className="text-4xl font-semibold tabular-nums text-[var(--room-accent)]">
                {player.sanity?.current ?? "—"}
              </strong>
              {player.sanity ? (
                <span className="pb-1 text-sm tabular-nums text-white/52">/ {player.sanity.max}</span>
              ) : null}
            </div>
            <p className="font-number mt-auto pt-4 text-xs text-white/58">
              {!player.sanity
                ? (intl("components_pages_SklandStatus.sklandDidNotProvideSanityStatus"))
                : player.sanity.current >= player.sanity.max
                  ? (intl("components_pages_SklandStatus.sanityIsFull"))
                  : intl("components_pages_SklandStatus.fullRecovery", { value2: formatDateTime(player.sanity.completeRecoveryTime, en) })}
            </p>
          </div>
        </OverviewTechnicalCard>

        <OverviewTechnicalCard group="power" className="min-h-36">
          <div className="flex h-full flex-col">
            <OverviewTechnicalHeading icon={<Zap className="size-4" aria-hidden="true" />}>
              {intl("components_pages_SklandStatus.drones")}
            </OverviewTechnicalHeading>
            <p className="mt-5 text-3xl font-semibold tabular-nums text-[var(--room-accent)]">
              {infrastructure.labor.value}
              <span className="ml-1 text-sm font-normal text-white/52">
                / {infrastructure.labor.maxValue}
              </span>
            </p>
            <p className="font-number mt-auto pt-4 text-xs text-white/58">
              {dronesFull
                ? (intl("components_pages_SklandStatus.dronesAreAtCapacity"))
                : intl("components_pages_SklandStatus.nextRecoveryInAbout", { value2: formatDuration(infrastructure.labor.remainSecs, en) })}
            </p>
          </div>
        </OverviewTechnicalCard>

        <OverviewTechnicalCard group="manufacture" className="min-h-36">
          <div className="flex h-full flex-col">
            <OverviewTechnicalHeading icon={<Activity className="size-4" aria-hidden="true" />}>
              {intl("components_pages_SklandStatus.dailyWeekly")}
            </OverviewTechnicalHeading>
            <div className="mt-5 grid gap-3">
              {progress.routine ? (
                <>
                  <ProgressMeter technical label={intl("components_pages_SklandStatus.daily")} {...progress.routine.daily} />
                  <ProgressMeter technical label={intl("components_pages_SklandStatus.weekly")} {...progress.routine.weekly} />
                </>
              ) : (
                <p className="text-xs text-white/58">{intl("components_pages_SklandStatus.sklandDidNotProvideMissionProgress")}</p>
              )}
            </div>
          </div>
        </OverviewTechnicalCard>
      </section>

      <section
        className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]"
        aria-label={intl("components_pages_SklandStatus.doctorProfileAndCollection")}
      >
        <OverviewTechnicalCard group="control" className="min-h-48">
          <OverviewTechnicalHeading icon={<UsersRound className="size-4" aria-hidden="true" />}>
            {intl("components_pages_SklandStatus.doctorProfile")}
          </OverviewTechnicalHeading>
          <p className="mt-3 text-base font-semibold text-white">{player.nickname}</p>
          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
            <div className="border-t border-white/10 pt-2">
              <dt className="text-white/50">{intl("components_pages_SklandStatus.registered")}</dt>
              <dd className="font-number mt-1 font-medium text-white">{formatDate(player.registerTs, en)}</dd>
            </div>
            <div className="border-t border-white/10 pt-2">
              <dt className="text-white/50">{intl("components_pages_SklandStatus.mainStory")}</dt>
              <dd className="font-number mt-1 font-medium text-[var(--room-accent)]">
                {player.mainStageProgress ?? (intl("components_pages_SklandStatus.notProvided"))}
              </dd>
            </div>
            <div className="border-t border-white/10 pt-2">
              <dt className="text-white/50">{intl("components_pages_SklandStatus.assistant")}</dt>
              <dd className="mt-1 font-medium text-white">{player.secretary?.name ? localizedOperatorName(player.secretary.name, locale, gameCatalog) : (intl("components_pages_SklandStatus.notProvided"))}</dd>
            </div>
            <div className="border-t border-white/10 pt-2">
              <dt className="text-white/50">{intl("components_pages_SklandStatus.monthlyCardExpires")}</dt>
              <dd className="font-number mt-1 font-medium text-white">{formatDate(player.subscriptionEnd, en)}</dd>
            </div>
          </dl>
          {player.resume ? (
            <p className="mt-4 border-t border-white/10 pt-3 text-sm leading-6 text-white/58">{player.resume}</p>
          ) : null}
        </OverviewTechnicalCard>

        <OverviewTechnicalCard group="trading" className="min-h-48">
          <OverviewTechnicalHeading icon={<Boxes className="size-4" aria-hidden="true" />}>
            {intl("components_pages_SklandStatus.collection")}
          </OverviewTechnicalHeading>
          <dl className="mt-5 grid grid-cols-3 divide-x divide-white/10 border-y border-white/10 py-3">
            <div className="px-3 first:pl-0">
              <dt className="text-xs text-white/50">{intl("components_pages_SklandStatus.operators2")}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-[var(--room-accent)]">
                {player.counts.operators ?? "—"}
              </dd>
            </div>
            <div className="px-3">
              <dt className="text-xs text-white/50">{intl("components_pages_SklandStatus.outfits")}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-[var(--room-accent)]">
                {player.counts.skins ?? "—"}
              </dd>
            </div>
            <div className="px-3">
              <dt className="text-xs text-white/50">{intl("components_pages_SklandStatus.furniture")}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-[var(--room-accent)]">
                {player.counts.furniture ?? "—"}
              </dd>
            </div>
          </dl>
        </OverviewTechnicalCard>
      </section>

      <section aria-labelledby="overview-recruit-title">
        <OverviewTechnicalCard group="hire" className="min-h-36">
          <OverviewTechnicalHeading icon={<PackageCheck className="size-4" aria-hidden="true" />}>
            <span id="overview-recruit-title">{intl("components_pages_SklandStatus.recruitment")}</span>
          </OverviewTechnicalHeading>
          {progress.recruit?.length ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {progress.recruit.map((slot) => {
                const finished = slot.state === "completed"
                  || (slot.state === "recruiting" && slot.finishTs > 0 && slot.finishTs <= infrastructure.currentTs);
                const label = finished
                  ? (intl("components_pages_SklandStatus.complete"))
                  : slot.state === "locked"
                    ? (intl("components_pages_SklandStatus.locked"))
                    : slot.state === "standby"
                      ? (intl("components_pages_SklandStatus.idle"))
                      : (intl("components_pages_SklandStatus.inProgress"));
                return (
                  <div key={slot.index} className="border-t border-white/12 bg-black/12 px-3 py-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <strong className="font-number">{intl("components_pages_SklandStatus.slot")} {slot.index + 1}</strong>
                      <span className={finished ? "text-[var(--room-accent)]" : "text-white/58"}>
                        {label}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-nowrap text-xs tabular-nums text-white/58">
                      {slot.finishTs > 0 ? formatDateTime(slot.finishTs, en) : (intl("components_pages_SklandStatus.noTimer"))}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : <p className="mt-5 text-sm text-white/58">{intl("components_pages_SklandStatus.sklandDidNotProvideRecruitmentTimers")}</p>}
        </OverviewTechnicalCard>
      </section>
    </div>
  );
}

function RoomCard({ room }: { room: SklandInfrastructureRoom }) {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale;
  const productionRoom = room.group === "trading" || room.group === "manufacture" ? room : null;
  const isAuxiliaryRoom = ["meeting", "training", "hire", "processing"].includes(room.group);
  const hasRoomDetails = productionRoom !== null || room.group === "hire";
  const visual = roomVisualFor(room.group);
  const gridTone = roomGridTone(room.group);
  const style = {
    "--room-accent": visual.accent,
    "--room-level": visual.level,
    "--room-grid-color": gridTone.color,
    "--room-grid-opacity": gridTone.opacity,
    "--room-grid-fade-start": gridTone.fadeStart,
  } as CSSProperties;

  return (
    <article
      className={`infra-room-surface relative gap-2 overflow-hidden px-3 py-2 text-white ${
        isAuxiliaryRoom
          ? "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start"
          : "flex min-h-36 flex-col"
      }`}
      data-room-group={room.group}
      style={style}
    >
      <div
        className="infra-room-emblem absolute inset-0 bg-left bg-no-repeat"
        style={{
          backgroundImage: `url(${visual.background})`,
          backgroundPosition: "-18px center",
          backgroundSize: "auto 100%",
        }}
        aria-hidden="true"
      />
      <div className="relative z-10 min-w-0">
        <div className="flex min-h-7 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="infra-room-accent h-5 w-1 shrink-0 bg-[var(--room-accent)]" aria-hidden="true" />
            <h4 className="font-number truncate text-sm font-medium tracking-[-0.02em] text-white [text-shadow:0_2px_3px_rgba(0,0,0,0.75)]">
              {roomLabel(room, en)}
            </h4>
            <LevelDiamonds level={room.level} maxLevel={roomMaxLevel(room)} variant="compact" />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2 text-xs text-white/64 max-sm:ml-3 max-sm:w-full max-sm:flex-wrap">
            {productionRoom ? (
              <strong className="infra-room-value text-xs font-semibold text-[var(--room-accent)]">
                {(messageRecord(en, "components_pages_SklandStatus_labels2"))[productionRoom.product] ?? productionRoom.product}
              </strong>
            ) : null}
            {room.group === "manufacture" ? <span className="font-number">{intl("components_pages_SklandStatus.productivity")} {Math.round(room.speed * 100)}%</span> : null}
            {room.group === "dormitory" ? <span className="font-number">{intl("components_pages_SklandStatus.ambience")} {room.comfort}</span> : null}
            {room.group === "hire" ? <span className="font-number">{intl("components_pages_SklandStatus.refreshes", { refreshCount: room.refreshCount })}</span> : null}
            {room.group === "training" ? (
              <span className="font-number" aria-label={intl("components_pages_SklandStatus.ofSlotsOccupied", { current: room.occupancy.current, capacity: room.occupancy.capacity })}>
                {room.occupancy.current}/{room.occupancy.capacity}
              </span>
            ) : null}
          </div>
        </div>
        {room.group === "power" ? (
          <div
            className="mt-1 flex min-h-7 items-center gap-2 text-xs text-white/58"
            data-skland-power-efficiency
          >
            <span>{intl("components_pages_SklandStatus.efficiency")}</span>
            <strong className="font-number font-semibold tabular-nums text-[var(--room-accent)]">{intl("components_pages_SklandStatus.baseline")} 100%</strong>
          </div>
        ) : null}
      </div>

      <div
        className={`relative z-10 min-w-0 ${
          isAuxiliaryRoom ? "flex justify-end" : "grid flex-1 content-between gap-2"
        }`}
      >
        <div
          className={`flex flex-wrap items-start gap-3 max-sm:grid max-sm:w-full max-sm:grid-cols-5 max-sm:gap-1.5 max-sm:[&_.infra-operator-slot]:w-full max-sm:[&_.infra-operator-slot]:[--operator-slot-size:clamp(48px,calc((100vw-72px)/5),64px)] ${
            isAuxiliaryRoom ? "justify-end" : ""
          }`}
        >
          {room.group === "training" ? ([
            { position: "trainee" as const, positionLabel: intl("components_pages_SklandStatus.trainee") },
            { position: "trainer" as const, positionLabel: intl("components_pages_SklandStatus.trainer") },
          ].map(({ position, positionLabel }) => {
            const operator = room.operators.find((candidate) => candidate.position === position);
            return (
              <OperatorSlot
                key={`${room.key}-${position}`}
                slot={operator ? {
                  name: operator.name,
                  label: operator.name,
                  portrait: operatorPortraitFor(operator.name, operator.id),
                  profession: operatorProfessionFor(operator.name),
                } : undefined}
                currentMorale={operator?.morale}
                compactView
                positionLabel={positionLabel}
              />
            );
          })) : room.operators.length ? room.operators.map((operator) => (
            <OperatorSlot
              key={`${room.key}-${operator.id}`}
              slot={{
                name: operator.name,
                label: intl("components_pages_SklandStatus.working", { name: operator.name, value3: formatDuration(operator.workTime, en) }),
                portrait: operatorPortraitFor(operator.name, operator.id),
                profession: operatorProfessionFor(operator.name),
              }}
              currentMorale={operator.morale}
              compactView
            />
          )) : isAuxiliaryRoom ? Array.from(
            { length: room.group === "meeting" ? 2 : 1 },
            (_, index) => <OperatorSlot key={`${room.key}-empty-${index}`} slot={undefined} compactView />,
          ) : <span className="py-2 text-sm text-white/48">{intl("components_pages_SklandStatus.noOperatorsAssigned")}</span>}
        </div>
      </div>

      {hasRoomDetails ? <div className={`relative z-10 border-t border-white/10 pt-2 text-xs leading-5 text-white/58 ${
        isAuxiliaryRoom ? "col-span-full" : ""
      }`}>
          {productionRoom ? (
            <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5 xl:flex-nowrap">
              <div className="flex items-baseline gap-1 whitespace-nowrap">
                <dt>{intl("components_pages_SklandStatus.stock")}</dt>
                <dd className="font-medium tabular-nums text-white">
                  {productionRoom.production.stock ?? "—"} / {productionRoom.production.capacity ?? "—"}
                </dd>
              </div>
              <div className="flex items-baseline gap-1 whitespace-nowrap">
                <dt>{intl("components_pages_SklandStatus.estimatedCompletion")}</dt>
                <dd
                  className="font-medium tabular-nums text-white"
                  data-infra-complete-time
                >
                  {formatCompactDateTime(productionRoom.production.completeWorkTime, en)}
                </dd>
              </div>
              {productionRoom.production.completed !== null ? (
                <div className="flex items-baseline gap-1 whitespace-nowrap">
                  <dt>{intl("components_pages_SklandStatus.completed")}</dt>
                  <dd className="font-medium tabular-nums text-white">{productionRoom.production.completed}</dd>
                </div>
              ) : null}
              {productionRoom.production.remaining !== null ? (
                <div className="flex items-baseline gap-1 whitespace-nowrap">
                  <dt>{intl("components_pages_SklandStatus.queueRemaining")}</dt>
                  <dd className="font-medium tabular-nums text-white">{productionRoom.production.remaining}</dd>
                </div>
              ) : null}
            </dl>
          ) : room.group === "hire" ? (
            <p className="font-number">{intl("components_pages_SklandStatus.nextCompletion")} {formatDateTime(room.completeWorkTime, en)}</p>
          ) : null}

          {room.group === "trading" && room.orders.length ? (
            <details className="mt-2">
              <summary className="font-number cursor-pointer font-medium text-[var(--room-accent)]">
                {intl("components_pages_SklandStatus.viewOrders", { length: room.orders.length })}
              </summary>
              <div className="mt-2 grid gap-1">
                {room.orders.map((order, index) => (
                  <p key={`${room.key}-order-${index}`} className="font-number">
                    {intl("components_pages_SklandStatus.orderDeliver", { value1: index + 1 })}{order.delivery.reduce((total, item) => total + item.count, 0)}
                    {intl("components_pages_SklandStatus.receive")}{order.reward.count} {sklandTradingOrderRewardLabel(order, en)}
                  </p>
                ))}
              </div>
            </details>
          ) : null}
        </div> : null}
    </article>
  );
}

function BuildingMetricCard({ metric }: { metric: SklandStatusMetric }) {
  const group = metric.visual === "rest"
    ? "dormitory"
    : metric.visual === "clue"
      ? "meeting"
      : metric.visual;

  return (
    <div
      className="h-full min-w-0"
      data-skland-metric={metric.id}
      data-metric-tone={metric.tone}
    >
      <OverviewTechnicalCard group={group} className="h-full min-h-40" showEmblem={false}>
        <div className="flex h-full min-w-0 flex-col">
          <OverviewTechnicalHeading icon={<Activity className="size-4" aria-hidden="true" />}>
            {metric.label}
          </OverviewTechnicalHeading>
          <div className="mt-5 flex min-w-0 items-end gap-1">
            <strong className="min-w-0 truncate text-3xl font-semibold leading-none tabular-nums text-[var(--room-accent)]">
              {metric.value}
            </strong>
            {metric.total !== null ? (
              <span className="mb-0.5 shrink-0 text-sm leading-none tabular-nums text-white/52">
                / {metric.total}
              </span>
            ) : null}
          </div>
          <p className="font-number mt-auto pt-4 text-xs leading-5 text-white/58">{metric.hint}</p>
        </div>
      </OverviewTechnicalCard>
    </div>
  );
}

function LayoutSyncControl({
  snapshot,
  layoutMatches,
  layoutDirty,
  onApplyLayout,
}: {
  snapshot: SklandStatusSnapshot;
  layoutMatches: boolean;
  layoutDirty: boolean;
  onApplyLayout: () => void;
}) {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { infrastructure } = snapshot;

  function requestApplyLayout() {
    if (layoutDirty) setConfirmOpen(true);
    else onApplyLayout();
  }

  const hasSuggestion = Boolean(infrastructure.layoutSuggestion);
  const status = hasSuggestion
    ? intl("components_pages_SklandStatus.sklandLayout", { value2: en === "en" ? (((infrastructure.layoutLabel ?? "Unrecognized"))) : (((infrastructure.layoutLabel ?? rawText.text(en, "unknownLayout")))) })
    : intl("components_pages_SklandStatus.noSyncableLayoutRecognized");

  return (
    <>
      <div
        className="flex min-w-0 items-center gap-2"
        data-slot="skland-layout-sync"
        aria-label={intl("components_pages_SklandStatus.layoutSync")}
        aria-live="polite"
      >
        <span
          className={cn(
            "inline-flex min-w-0 items-center gap-1.5 text-xs",
            layoutMatches ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {layoutMatches
            ? <Check className="size-3.5 shrink-0" aria-hidden="true" />
            : <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />}
          <span className="font-number truncate">{status}</span>
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0 max-sm:h-11"
          disabled={!hasSuggestion || layoutMatches}
          onClick={requestApplyLayout}
        >
          <Building2 />
          {layoutMatches ? (intl("components_pages_SklandStatus.synced")) : hasSuggestion ? (intl("components_pages_SklandStatus.applyLayout")) : (intl("components_pages_SklandStatus.unavailable"))}
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{intl("components_pages_SklandStatus.overwriteCurrentLayoutSettings")}</DialogTitle>
            <DialogDescription>
              {intl("components_pages_SklandStatus.youChangedTheCurrentLayoutManuallyContinuingWillUse")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button className="max-sm:min-w-16 sm:min-w-[88px]" type="button" size="dialog" variant="ghost" onClick={() => setConfirmOpen(false)}>{intl("components_pages_SklandStatus.cancel")}</Button>
            <Button
              type="button"
              size="dialog"
              onClick={() => {
                onApplyLayout();
                setConfirmOpen(false);
              }}
            >
              {intl("components_pages_SklandStatus.overwriteAndApply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function InfrastructureTab({ snapshot }: { snapshot: SklandStatusSnapshot }) {
  const intl = useTranslations();
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  const en = locale;
  const { infrastructure } = snapshot;
  const now = useMinuteTimestamp(infrastructure.currentTs);
  const buildingMetrics = useMemo(() => deriveSklandBuildingMetrics(snapshot, now, en), [en, snapshot, now]);


  return (
    <div className="grid gap-7">
      <section
        className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
        aria-label={intl("components_pages_SklandStatus.infrastructureOverview")}
        data-skland-overview-grid
        data-skland-metric-section="building"
      >
        <OverviewTechnicalCard
          group="training"
          className="min-h-40"
          dataSlot="skland-training-room"
          showEmblem={false}
        >
          <div className="flex h-full flex-col">
            <OverviewTechnicalHeading icon={<Activity className="size-4" aria-hidden="true" />}>
              {intl("components_pages_SklandStatus.trainingRoom")}
            </OverviewTechnicalHeading>
            <p className="mt-5 text-2xl font-semibold tracking-[-0.02em] text-[var(--room-accent)]">
              {infrastructure.training?.trainee ? localizedOperatorName(infrastructure.training.trainee, locale, gameCatalog) : (intl("components_pages_SklandStatus.currentlyIdle"))}
            </p>
            <div className="mt-auto pt-4 text-xs leading-5 text-white/58">
            {infrastructure.training ? (
              <>
                <p className="font-number">{intl("components_pages_SklandStatus.skill")} {infrastructure.training.skillIndex} · {intl("components_pages_SklandStatus.trainer2")}: {infrastructure.training.trainer ? localizedOperatorName(infrastructure.training.trainer, locale, gameCatalog) : (intl("components_pages_SklandStatus.none"))}</p>
                <p className="font-number">{intl("components_pages_SklandStatus.remaining")} {formatDuration(infrastructure.training.remainSecs, en)} · {intl("components_pages_SklandStatus.speed")} {Math.round(infrastructure.training.speed * 100)}%</p>
              </>
            ) : (intl("components_pages_SklandStatus.noTrainingTask"))}
            </div>
          </div>
        </OverviewTechnicalCard>

        <OverviewTechnicalCard
          group="power"
          className="min-h-40"
          dataSlot="skland-infra-assets"
          showEmblem={false}
        >
          <div className="flex h-full flex-col">
            <OverviewTechnicalHeading icon={<Boxes className="size-4" aria-hidden="true" />}>
              {intl("components_pages_SklandStatus.infrastructureAssets")}
            </OverviewTechnicalHeading>
            <p className="mt-5 text-3xl font-semibold tabular-nums text-[var(--room-accent)]">
              {infrastructure.furnitureTotal}
              <span className="ml-1 text-sm font-normal text-white/58">{intl("components_pages_SklandStatus.furnitureItems")}</span>
            </p>
            <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-4 text-xs text-white/58">
              <span className="font-number">{intl("components_pages_SklandStatus.drones")} {infrastructure.labor.value}/{infrastructure.labor.maxValue}</span>
              <span className="font-number">{intl("components_pages_SklandStatus.lowMoraleOperators", { length: infrastructure.tiredOperators.length })}</span>
            </div>
          </div>
        </OverviewTechnicalCard>

        {buildingMetrics.map((metric) => <BuildingMetricCard key={metric.id} metric={metric} />)}
      </section>

      {infrastructure.layoutWarning ? (
        <Alert>
          <AlertDescription className="font-number">{infrastructure.layoutWarning}</AlertDescription>
        </Alert>
      ) : null}

      <SklandInfrastructureLayout rooms={infrastructure.rooms} />

    </div>
  );
}

export function SklandInfrastructureLayout({ rooms }: { rooms: SklandInfrastructureRoom[] }) {
  const intl = useTranslations();
  const controlRooms = rooms.filter((room) => room.group === "control");
  const workRooms = rooms.filter((room) => room.group === "trading" || room.group === "manufacture");
  const powerRooms = rooms.filter((room) => room.group === "power");
  const primaryFunctionRooms = rooms.filter(
    (room) => room.group === "meeting" || room.group === "training",
  );
  const secondaryFunctionRooms = rooms.filter(
    (room) => room.group === "hire" || room.group === "processing",
  );
  const dormitoryRooms = rooms.filter((room) => room.group === "dormitory");
  const alignDenseInfrastructureRows = powerRooms.length >= 2 && workRooms.length >= 6 && dormitoryRooms.length >= 4;
  return (
      <section aria-labelledby="skland-compact-layout-title">
        <div className="mb-3 flex min-w-0 items-end justify-between gap-3 border-b border-border/70 pb-3">
          <h3 id="skland-compact-layout-title" className="min-w-0 text-lg font-semibold tracking-[-0.025em]">
            {intl("components_pages_SklandStatus.currentInfrastructure")}
          </h3>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{rooms.length} {intl("components_pages_SklandStatus.facilities")}</span>
        </div>

        <div
          className="grid items-stretch gap-3 xl:grid-cols-[minmax(0,55fr)_minmax(19rem,45fr)]"
          data-skland-compact-layout
        >
          <div
            className={`flex min-w-0 flex-col gap-3 ${alignDenseInfrastructureRows ? "" : "xl:justify-between"}`}
            data-skland-compact-column="production"
          >
            {controlRooms.map((room) => <RoomCard key={room.key} room={room} />)}

            {workRooms.length ? <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
              {workRooms.map((room) => <RoomCard key={room.key} room={room} />)}
            </div> : null}

            {powerRooms.length ? <div className="grid min-w-0 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {powerRooms.map((room) => <RoomCard key={room.key} room={room} />)}
            </div> : null}
          </div>

          <div
            className={`flex min-w-0 flex-col gap-3 ${alignDenseInfrastructureRows ? "skland-dense-auxiliary-column" : "xl:justify-between"}`}
            data-skland-compact-column="auxiliary"
          >
            {primaryFunctionRooms.length || secondaryFunctionRooms.length ? <div className="compact-auxiliary-container min-w-0">
              <div className="compact-auxiliary-grid" data-skland-functional-rooms>
                {primaryFunctionRooms.map((room) => <RoomCard key={room.key} room={room} />)}
                <RecyclingRoomPlaceholder />
                {secondaryFunctionRooms.map((room) => <RoomCard key={room.key} room={room} />)}
              </div>
            </div> : null}

            {dormitoryRooms.map((room) => <RoomCard key={room.key} room={room} />)}
          </div>
        </div>
      </section>
  );
}

function OperatorCard({ operator }: { operator: SklandOperatorStatus }) {
  const rawLocale = useRawLocale();
  const gameCatalog = useGameCatalog();
  return (
    <article className="[content-visibility:auto] [contain-intrinsic-size:16rem] border-t border-border/70 pt-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className="truncate font-medium">{localizedOperatorName(operator.name, rawLocale, gameCatalog)}</h4>
            {operator.isAssist ? <Badge variant="secondary">{rawText.text(rawLocale, "supportUnit")}</Badge> : null}
          </div>
          <p className="font-number mt-1 text-xs text-muted-foreground">
            {operator.rarity}★ · {professionLabel(operator.profession, rawLocale)} / {operator.subProfessionName}
          </p>
        </div>
        <Badge variant="outline" className="font-number">{rawText.rich(rawLocale, "eLv", { part1: richValue((operator.elite)), part2: richValue((operator.level)) })}</Badge>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div><dt className="text-muted-foreground">{rawText.text(rawLocale, "potential")}</dt><dd className="font-number mt-0.5 font-medium">{operator.potential}</dd></div>
        <div><dt className="text-muted-foreground">{rawText.text(rawLocale, "trust")}</dt><dd className="font-number mt-0.5 font-medium">{operator.favorPercent}%</dd></div>
        <div><dt className="text-muted-foreground">{rawText.text(rawLocale, "skill")}</dt><dd className="font-number mt-0.5 font-medium">Lv.{operator.mainSkillLevel}</dd></div>
      </dl>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer font-medium text-primary">{rawText.text(rawLocale, "masteryModulesAndOutfits")}</summary>
        <div className="mt-2 grid gap-1.5 leading-5 text-muted-foreground">
          <p className="font-number">{rawText.rich(rawLocale, "mastery", { part1: richValue((operator.skills.length
              ? operator.skills.map((skill) => `S${skill.index} M${skill.specializeLevel}`).join(" · ")
              : rawText.text(rawLocale, "notProvidedSkland"))) })}</p>
          <p className="font-number">{rawText.rich(rawLocale, "module", { part1: richValue((operator.modules.length
              ? operator.modules.map((module) => `${module.name} Lv.${module.level}${module.isDefault ? rawText.text(rawLocale, "using") : ""}`).join(" · ")
              : rawText.text(rawLocale, "none"))) })}</p>
          <p>{rawText.rich(rawLocale, "currentOutfit", { part1: richValue((operator.currentSkinName ?? rawText.text(rawLocale, "defaultOutfit"))) })}</p>
          <p className="font-number">{rawText.rich(rawLocale, "obtained", { part1: richValue((formatDate(operator.acquiredAt, rawLocale))) })}</p>
        </div>
      </details>
    </article>
  );
}

function SkinCard({ skin }: { skin: SklandOwnedSkin }) {
  const rawLocale = useRawLocale();
  const gameCatalog = useGameCatalog();
  return (
    <article className="[content-visibility:auto] border-t border-border/70 pt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-medium">{skin.name}</h4>
          <p className="mt-1 text-xs text-muted-foreground">{localizedOperatorName(skin.operatorName, rawLocale, gameCatalog)} · {skin.brandId}</p>
        </div>
        {skin.isCurrent ? <Badge variant="secondary">{rawText.text(rawLocale, "inUse")}</Badge> : null}
      </div>
      <p className="font-number mt-3 text-xs text-muted-foreground">{rawText.rich(rawLocale, "obtained2", { part1: richValue((formatDate(skin.obtainedAt, rawLocale))) })}</p>
    </article>
  );
}

export function OperatorsTab({ snapshot }: { snapshot: SklandStatusSnapshot }) {
  const rawLocale = useRawLocale();
  const gameCatalog = useGameCatalog();
  const [query, setQuery] = useState("");
  const [rarity, setRarity] = useState("all");
  const [profession, setProfession] = useState("all");
  const [operatorLimit, setOperatorLimit] = useState(INITIAL_LIST_LIMIT);
  const [skinLimit, setSkinLimit] = useState(INITIAL_LIST_LIMIT);
  const professions = useMemo(
    () => [...new Set(snapshot.operators.map((operator) => operator.profession))]
      .sort((left, right) => professionLabel(left, rawLocale).localeCompare(professionLabel(right, rawLocale), rawLocale)),
    [snapshot.operators, rawLocale]
  );
  const professionOptions = useMemo(
    () => [
      { value: "all", label: rawText.text(rawLocale, "allProfessions") },
      ...professions.map((value) => ({ value, label: professionLabel(value, rawLocale) })),
    ],
    [professions, rawLocale]
  );
  const filteredOperators = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return snapshot.operators
      .filter((operator) => !normalizedQuery || [operator.name, localizedOperatorName(operator.name, rawLocale, gameCatalog)].some(name => name.toLocaleLowerCase(rawLocale).includes(normalizedQuery)))
      .filter((operator) => rarity === "all" || operator.rarity === Number(rarity))
      .filter((operator) => profession === "all" || operator.profession === profession)
      .sort((left, right) =>
        right.rarity - left.rarity
        || right.elite - left.elite
        || right.level - left.level
        || left.name.localeCompare(right.name, "zh-CN")
      );
  }, [profession, query, rarity, snapshot.operators, rawLocale, gameCatalog]);
  const filteredSkins = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return snapshot.skins
      .filter((skin) =>
        !normalizedQuery
        || skin.name.toLocaleLowerCase("zh-CN").includes(normalizedQuery)
        || [skin.operatorName, localizedOperatorName(skin.operatorName, rawLocale, gameCatalog)].some(name => name.toLocaleLowerCase(rawLocale).includes(normalizedQuery))
      )
      .sort((left, right) => right.obtainedAt - left.obtainedAt || left.name.localeCompare(right.name, "zh-CN"));
  }, [query, snapshot.skins, rawLocale, gameCatalog]);

  function updateQuery(value: string) {
    setQuery(value);
    setOperatorLimit(INITIAL_LIST_LIMIT);
    setSkinLimit(INITIAL_LIST_LIMIT);
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-3 rounded-xl bg-muted/45 p-3 md:grid-cols-[minmax(0,1fr)_10rem_12rem]">
        <label className="relative">
          <Search className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
            className="h-11 pl-9"
            placeholder={rawText.text(rawLocale, "searchOperatorsOrOutfits")}
            aria-label={rawText.text(rawLocale, "searchOperatorsOrOutfits")}
          />
        </label>
        <OperatorFilterCombobox
          label={rawText.text(rawLocale, "rarity")}
          value={rarity}
          options={rarityOptions(rawLocale)}
          onValueChange={(value) => {
            setRarity(value);
            setOperatorLimit(INITIAL_LIST_LIMIT);
          }}
        />
        <OperatorFilterCombobox
          label={rawText.text(rawLocale, "profession")}
          value={profession}
          options={professionOptions}
          onValueChange={(value) => {
            setProfession(value);
            setOperatorLimit(INITIAL_LIST_LIMIT);
          }}
        />
      </div>

      <Tabs defaultValue="operators">
        <div className="min-w-0 pb-1">
          <TabsList data-yeye-scroll={undefined} variant="line" className="max-w-full flex-wrap">
            <TabsTrigger value="operators" className="h-10 px-4">{rawText.rich(rawLocale, "operators", { part1: richValue((<UsersRound />)), part2: richValue((<span className="font-number">{filteredOperators.length}</span>)) })}</TabsTrigger>
            <TabsTrigger value="skins" className="h-10 px-4">{rawText.rich(rawLocale, "outfits", { part1: richValue((<Shirt />)), part2: richValue((<span className="font-number">{filteredSkins.length}</span>)) })}</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="operators" className="pt-3">
          {filteredOperators.length ? (
            <>
              <div className="grid gap-x-6 gap-y-5 md:grid-cols-2 xl:grid-cols-3">
                {filteredOperators.slice(0, operatorLimit).map((operator) => (
                  <OperatorCard key={operator.id} operator={operator} />
                ))}
              </div>
              {operatorLimit < filteredOperators.length ? (
                <Button
                  type="button"
                  className="mt-6 h-11 w-full"
                  variant="outline"
                  onClick={() => setOperatorLimit((current) => current + INITIAL_LIST_LIMIT)}
                >{rawText.text(rawLocale, "showMoreOperators")}</Button>
              ) : null}
            </>
          ) : <p className="py-12 text-center text-sm text-muted-foreground">{rawText.text(rawLocale, "noOperatorsMatchTheseFilters")}</p>}
        </TabsContent>
        <TabsContent value="skins" className="pt-3">
          {filteredSkins.length ? (
            <>
              <div className="grid gap-x-6 gap-y-5 md:grid-cols-2 xl:grid-cols-3">
                {filteredSkins.slice(0, skinLimit).map((skin) => <SkinCard key={skin.id} skin={skin} />)}
              </div>
              {skinLimit < filteredSkins.length ? (
                <Button
                  type="button"
                  className="mt-6 h-11 w-full"
                  variant="outline"
                  onClick={() => setSkinLimit((current) => current + INITIAL_LIST_LIMIT)}
                >{rawText.text(rawLocale, "showMoreOutfits")}</Button>
              ) : null}
            </>
          ) : <p className="py-12 text-center text-sm text-muted-foreground">{rawText.text(rawLocale, "sklandHasNotProvidedOutfitDataYet")}</p>}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProgressSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-border/70 pt-5">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function ProgressTab({ snapshot }: { snapshot: SklandStatusSnapshot }) {
  const rawLocale = useRawLocale();
  const gameCatalog = useGameCatalog();
  const { player, progress } = snapshot;
  const now = useMinuteTimestamp(snapshot.infrastructure.currentTs);
  return (
    <div className="grid gap-7">
      <section className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
        <Card className="surface-shadow ring-0">
          <CardHeader>
            <CardDescription>{rawText.text(rawLocale, "doctorProfile")}</CardDescription>
            <CardTitle>{player.nickname}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div><dt className="text-muted-foreground">{rawText.text(rawLocale, "registered")}</dt><dd className="font-number mt-1 font-medium">{formatDate(player.registerTs, rawLocale)}</dd></div>
              <div><dt className="text-muted-foreground">{rawText.text(rawLocale, "mainStory")}</dt><dd className="font-number mt-1 font-medium">{player.mainStageProgress ?? rawText.text(rawLocale, "notProvided")}</dd></div>
              <div><dt className="text-muted-foreground">{rawText.text(rawLocale, "assistant")}</dt><dd className="mt-1 font-medium">{player.secretary?.name ? localizedOperatorName(player.secretary.name, rawLocale, gameCatalog) : rawText.text(rawLocale, "notProvided")}</dd></div>
              <div><dt className="text-muted-foreground">{rawText.text(rawLocale, "monthlyCardExpires")}</dt><dd className="font-number mt-1 font-medium">{formatDate(player.subscriptionEnd, rawLocale)}</dd></div>
            </dl>
            {player.resume ? <p className="border-t pt-3 leading-6 text-muted-foreground">{player.resume}</p> : null}
          </CardContent>
        </Card>
        <Card className="surface-shadow ring-0">
          <CardHeader>
            <CardDescription>{rawText.text(rawLocale, "collection")}</CardDescription>
            <CardTitle className="font-number">
              {player.counts.operators === null ? rawText.text(rawLocale, "notAvailableYet") : rawText.text(rawLocale, "operatorCount", { count: player.counts.operators })}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-xs">
            <div><span className="text-muted-foreground">{rawText.text(rawLocale, "outfits2")}</span><strong className="font-number mt-1 block text-lg">{player.counts.skins ?? "—"}</strong></div>
            <div><span className="text-muted-foreground">{rawText.text(rawLocale, "furniture")}</span><strong className="font-number mt-1 block text-lg">{player.counts.furniture ?? "—"}</strong></div>
          </CardContent>
        </Card>
      </section>

      <ProgressSection title={rawText.text(rawLocale, "recruitment")} description={rawText.text(rawLocale, "completionTimesComeFromThisSklandSnapshot")}>
        {progress.recruit?.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {progress.recruit.map((slot) => {
              const finished = slot.state === "completed"
                || (slot.state === "recruiting" && slot.finishTs > 0 && slot.finishTs <= now);
              const label = finished
                ? rawText.text(rawLocale, "complete")
                : slot.state === "locked"
                  ? rawText.text(rawLocale, "locked")
                  : slot.state === "standby"
                    ? rawText.text(rawLocale, "idle")
                    : rawText.text(rawLocale, "inProgress");
              return (
                <div key={slot.index} className="rounded-lg bg-muted/45 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <strong className="font-number">{rawText.rich(rawLocale, "slot", { part1: richValue((slot.index + 1)) })}</strong>
                    <Badge variant={finished ? "secondary" : "outline"}>{label}</Badge>
                  </div>
                  <p className="font-number mt-2 text-xs text-muted-foreground">
                    {slot.finishTs > 0 ? formatDateTime(slot.finishTs, rawLocale) : rawText.text(rawLocale, "noTimer")}
                  </p>
                </div>
              );
            })}
          </div>
        ) : <p className="text-sm text-muted-foreground">{rawText.text(rawLocale, "sklandDidNotProvideRecruitmentTimers")}</p>}
      </ProgressSection>

      <ProgressSection title={rawText.text(rawLocale, "combatProgress")} description={rawText.text(rawLocale, "annihilationStationarySecurityServiceAndIntegratedStrategies")}>
        {progress.campaign || progress.tower || progress.rogue ? (
          <div className="grid gap-6 lg:grid-cols-3">
            {progress.campaign ? (
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">{rawText.rich(rawLocale, "annihilation", { part1: richValue((<PackageCheck className="size-4" />)) })}</div>
                <ProgressMeter label={rawText.text(rawLocale, "rewardProgress")} {...progress.campaign.reward} />
                <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                  {progress.campaign.records.map((record) => (
                    <p key={`${record.zoneName}-${record.name}`} className="font-number">
                      {record.zoneName ? `${record.zoneName} · ` : ""}{record.name}：{record.maxKills}
                    </p>
                  ))}
                  {!progress.campaign.records.length ? <p>{rawText.text(rawLocale, "noRecords")}</p> : null}
                </div>
              </div>
            ) : null}
            {progress.tower ? (
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">{rawText.rich(rawLocale, "stationarySecurityService", { part1: richValue((<Boxes className="size-4" />)) })}</div>
                <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                  {progress.tower.records.map((record) => (
                    <p key={`${record.name}-${record.subName}`} className="font-number">{record.name}{record.subName ? ` · ${record.subName}` : ""}：{record.best}</p>
                  ))}
                  {!progress.tower.records.length ? <p>{rawText.text(rawLocale, "noRecords")}</p> : null}
                </div>
              </div>
            ) : null}
            {progress.rogue ? (
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">{rawText.rich(rawLocale, "integratedStrategies", { part1: richValue((<DoorOpen className="size-4" />)) })}</div>
                <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                  {progress.rogue.map((record) => (
                    <p key={record.name} className="font-number">{rawText.rich(rawLocale, "collectiblesBank", { part1: richValue((record.name)), part2: richValue((record.relicCount)), part3: richValue((record.bankCurrent)), part4: richValue((record.bankRecord)) })}</p>
                  ))}
                  {!progress.rogue.length ? <p>{rawText.text(rawLocale, "noRecords")}</p> : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : <p className="text-sm text-muted-foreground">{rawText.text(rawLocale, "sklandHasNotProvidedCombatProgressYet")}</p>}
      </ProgressSection>

      <ProgressSection title={rawText.text(rawLocale, "eventHistory")} description={rawText.text(rawLocale, "showsOnlyStageCompletionReturnedBySklandEventPromotional")}>
        {progress.activities?.length || progress.bossRush?.length ? (
          <div className="grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
            {(progress.activities ?? []).map((activity) => (
              <article key={`${activity.name}-${activity.startTime}`} className="border-t border-border/70 pt-3">
                <div className="flex items-center justify-between gap-3">
                  <strong>{activity.name}</strong>
                  {activity.isReplicate ? <Badge variant="outline">{rawText.text(rawLocale, "rerun")}</Badge> : null}
                </div>
                <p className="font-number mt-2 text-xs text-muted-foreground">{rawText.rich(rawLocale, "stagesThrough", { part1: richValue((activity.clearedStages)), part2: richValue((activity.totalStages)), part3: richValue((formatDate(activity.endTime, rawLocale))) })}</p>
              </article>
            ))}
            {(progress.bossRush ?? []).map((record, index) => (
              <article key={`${record.stageCode}-${index}`} className="border-t border-border/70 pt-3">
                <strong className="font-number">{record.stageCode ?? rawText.text(rawLocale, "bossEvent")} {record.stageName ?? ""}</strong>
                <p className="font-number mt-2 text-xs text-muted-foreground">
                  {record.played ? rawText.text(rawLocale, "recorded") : rawText.text(rawLocale, "notAttempted")} · {record.difficulty}
                </p>
              </article>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">{rawText.text(rawLocale, "sklandHasNotProvidedEventHistoryYet")}</p>}
      </ProgressSection>
    </div>
  );
}

function LoadingState() {
  const intl = useTranslations();

  return (
    <SkeletonRouteFallback><StatusCenterPage data-skland-loading>
      <StatusCenterLoading label={intl("components_pages_SklandStatus.restoringSklandSession")} />
    </StatusCenterPage></SkeletonRouteFallback>
  );
}

export function SklandStatus({
  scheduleSnapshot,
  snapshot,
  accounts,
  activeAccountId,
  bindingCount,
  bindingSummary,
  sessionLoading,
  layoutMatches,
  layoutDirty,
  configured,
  disabledReason,
  busy,
  error,
  onAuthenticated,
  onRoleChange,
  onLogout,
  onRetryStatus,
  onDeleteAllData,
  onApplyLayout,
  onContinueSetup,
  onOpenCalculator,
  onCopyUid,
}: SklandStatusProps) {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale;
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const pathname = usePathname();
  const selectedTab = sklandTabFromPathname(pathname) ?? "overview";
  const bindingState = deriveSklandBindingState(bindingSummary, accounts.length);
  if (sessionLoading) return <LoadingState />;

  if (!scheduleSnapshot) {
    const loginTitle = localize_components_pages_SklandStatus.text(en, "additional1", { choice3: ((bindingState === "renewal-due") ? ("yes") : ("no")), choice4: ((!(bindingState === "renewal-due")) && (bindingState === "reauthorize") ? ("yes") : ("no")) });
    const loginDescription = localize_components_pages_SklandStatus.text(en, "additional2", { state: bindingState === "renewal-due" ? "expired" : bindingState === "reauthorize" ? "linked" : "other", hasExpiry: bindingSummary.latestExpiredAt ? "yes" : "no", expiry: bindingSummary.latestExpiredAt ? credentialExpiryLabel(bindingSummary.latestExpiredAt, en) : "", count: bindingCount });
    return (
      <StatusCenterPage
        className="min-h-[calc(100dvh-7rem)] place-items-center py-8 sm:py-12"
        data-skland-page
      >
        <div className="grid w-full max-w-4xl justify-items-center gap-7 text-center">
          <header className="grid max-w-lg gap-3" data-skland-login-copy>
            <p className="text-xs font-medium tracking-wide text-primary">{intl("components_pages_SklandStatus.sklandStatus")}</p>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{loginTitle}</h2>
            <p className="text-pretty text-sm leading-6 text-muted-foreground">{loginDescription}</p>
            <p className="text-xs leading-5 text-muted-foreground/80">
              {intl("components_pages_SklandStatus.credentialsStayInThisBrowserAndExpireAfter7")}
            </p>
          </header>
          {error ? (
            <Alert className="w-full max-w-lg text-start" variant="destructive">
              <AlertDescription>{error.message}{intl("components_pages_SklandStatus.label", { code: error.code })}</AlertDescription>
            </Alert>
          ) : null}
          <Suspense fallback={<Skeleton className="h-80 w-full max-w-4xl" />}>
            <SklandLoginPanel className="max-w-4xl" configured={configured} disabledReason={disabledReason} onAuthenticated={onAuthenticated} />
          </Suspense>
        </div>
      </StatusCenterPage>
    );
  }

  const activeAccount = accounts.find((account) => account.accountId === activeAccountId) ?? accounts[0] ?? null;
  const activeRole = activeAccount?.roles.find((role) => role.uid === activeAccount.selectedUid) ?? activeAccount?.roles[0] ?? null;

  if (!snapshot && activeAccount) {
    if (!error) return <LoadingState />;
    return (
      <StatusCenterPage data-skland-page data-skland-status-load-error>
        <header className="max-w-2xl">
          <p className="text-xs font-medium tracking-wide text-primary">{intl("components_pages_SklandStatus.sklandStatus")}</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">{intl("components_pages_SklandStatus.fullStatusIsTemporarilyUnavailable")}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {intl("components_pages_SklandStatus.signedInAsReloadOrSignOutAndAuthorize", { value2: en === "en" ? (((activeRole ? (`“${activeRole.nickname}”`) : ("Skland")))) : (((activeRole ? (`“${activeRole.nickname}”`) : (rawText.text(locale, "sklandName"))))) })}
          </p>
        </header>
        <Alert variant="destructive"><AlertDescription>{error.message}{intl("components_pages_SklandStatus.label", { code: error.code })}</AlertDescription></Alert>
        <Card>
          <CardHeader>
            <CardTitle>{intl("components_pages_SklandStatus.reloadStatus")}</CardTitle>
            <CardDescription className="max-w-2xl leading-6">
              {intl("components_pages_SklandStatus.afterSignInCompleteStatusIsReadAndDisplayed")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={onRetryStatus}>{intl("components_pages_SklandStatus.reloadStatus")}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void onLogout()}>
              <LogOut />{intl("components_pages_SklandStatus.signOut")}
            </Button>
          </CardContent>
        </Card>
        <SklandDataControls
          account={activeAccount}
          busy={busy}
          onDeleteAllData={onDeleteAllData}
        />
      </StatusCenterPage>
    );
  }

  if (!snapshot || !activeAccount) return <LoadingState />;


  return (
    <StatusCenterPage className="pb-0 sm:pb-0" data-skland-page>
      <StatusCenterHeader
        data-ui-number-font
        identity={<SklandPlayerIdentity player={snapshot.player} syncedAt={snapshot.infrastructure.storeTs} onCopyUid={onCopyUid} />}
        actions={(
          <div className="flex flex-wrap items-center justify-end gap-2">
          <div
              className="h-11 w-full sm:h-9 sm:w-64"
            data-skland-account-select
          >
            <SklandAccountSelect accounts={accounts} accountId={activeAccountId} uid={snapshot.player.uid} disabled={busy} onRoleChange={(accountId, uid) => { void onRoleChange(accountId, uid); }} />
          </div>
            <SetupActionButton
              type="button"
              className="!min-w-0 max-w-full max-md:!h-auto max-md:min-h-11 max-md:whitespace-normal max-md:!px-3 max-md:py-2"
            disabled={busy || accounts.length >= 5}
            title={accounts.length >= 5 ? (intl("components_pages_SklandStatus.upTo5SklandAccounts")) : undefined}
            onClick={() => setAddAccountOpen(true)}
            data-skland-add-account
          >
            <UserPlus />{intl("components_pages_SklandStatus.addAccount")}
            </SetupActionButton>
            <SetupActionButton
              type="button"
              className="!min-w-0 max-w-full text-muted-foreground hover:text-destructive max-md:!h-auto max-md:min-h-11 max-md:whitespace-normal max-md:!px-3 max-md:py-2"
            variant="ghost"
            disabled={busy}
            onClick={() => void onLogout()}
            data-skland-logout
          >
            <LogOut />{intl("components_pages_SklandStatus.signOut2")}
            </SetupActionButton>
          </div>
        )}
      />

      <Dialog open={addAccountOpen} onOpenChange={setAddAccountOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-[min(960px,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>{intl("components_pages_SklandStatus.addSklandAccount")}</DialogTitle>
            <DialogDescription>
              {intl.rich("components_pages_SklandStatus.rich2", { element1: (chunks) => (<span className="font-number">{chunks}</span>) })}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="min-h-0 overflow-y-auto pb-5 pt-0 sm:pb-7">
            <Suspense fallback={<Skeleton className="h-80 w-full" />}>
            <SklandLoginPanel
              className="max-w-none"
              configured={configured}
              disabledReason={disabledReason}
              dialogPresentation
              onAuthenticated={(session) => {
                onAuthenticated(session);
                setAddAccountOpen(false);
              }}
            />
            </Suspense>
          </DialogBody>
        </DialogContent>
      </Dialog>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>
            {error.message}{intl("components_pages_SklandStatus.lastSuccessfullySyncedDataWasKept", { code: error.code })}
          </AlertDescription>
        </Alert>
      ) : null}

      {snapshot.warnings.length ? (
        <Alert>
          <AlertDescription className="font-number">
            {snapshot.warnings.join(" ")}
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={selectedTab}>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3" data-skland-view-header>
          <div className="min-w-0 max-w-full pb-1">
            <CompactTabsList data-skland-view-tabs>
              <TabsTrigger value="overview" nativeButton={false} render={<Link to={sklandTabHref("overview")} resetScroll={false} />}>{intl("components_pages_SklandStatus.overview")}</TabsTrigger>
              <TabsTrigger value="inventory" nativeButton={false} render={<Link to={sklandTabHref("inventory")} resetScroll={false} />}>{uiText.text(en, "backpack")}</TabsTrigger>
              <TabsTrigger value="infrastructure" nativeButton={false} render={<Link to={sklandTabHref("infrastructure")} resetScroll={false} />}>{intl("components_pages_SklandStatus.infrastructure")}</TabsTrigger>
            </CompactTabsList>
          </div>
          <LayoutSyncControl
            snapshot={snapshot}
            layoutMatches={layoutMatches}
            layoutDirty={layoutDirty}
            onApplyLayout={onApplyLayout}
          />
        </div>
        <TabsContent value="overview" className="pt-5">
          <OverviewTab snapshot={snapshot} onContinueSetup={onContinueSetup} onOpenCalculator={onOpenCalculator} />
        </TabsContent>
        <TabsContent value="infrastructure" className="pt-5">
          <InfrastructureTab snapshot={snapshot} />
        </TabsContent>
        <TabsContent value="inventory" className="pt-5">
          <Suspense fallback={<Skeleton className="h-64 w-full" />}><InventoryPage /></Suspense>
        </TabsContent>
      </Tabs>

      <SklandDataControls
        account={activeAccount}
        busy={busy}
        onDeleteAllData={onDeleteAllData}
      />
    </StatusCenterPage>
  );
}
