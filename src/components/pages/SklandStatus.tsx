"use client";
import { localize as localize_components_pages_SklandStatus } from "../../i18n/helpers/components_pages_SklandStatus.ts";
import { useTranslations, useLocale } from "next-intl";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { sklandTabHref, sklandTabFromPathname } from "@/workbench-routes";
import { messageRecord } from "@/i18n/translate";

import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
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
const InventoryPage = lazy(() => import("@/components/pages/InventoryPage"));
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonRouteFallback } from "@/components/ui/skeleton-swap";
import { HoldToConfirm } from "@/components/ui/hold-to-confirm";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
const SklandLoginPanel = lazy(() => import("@/skland-components").then((module) => ({ default: module.SklandLoginPanel })));
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
} from "@/types";
import { deriveSklandBindingState } from "@/skland-binding-state";

const ROOM_LABELS: Record<SklandInfrastructureRoom["group"], string> = {
  control: "控制中枢",
  trading: "贸易站",
  manufacture: "制造站",
  power: "发电站",
  dormitory: "宿舍",
  meeting: "会客室",
  hire: "人力办公室",
  processing: "加工站",
  training: "训练室",
};

const ROOM_LABELS_ENGLISH: Record<SklandInfrastructureRoom["group"], string> = {
  control: "Control Center",
  trading: "Trading Post",
  manufacture: "Factory",
  power: "Power Plant",
  dormitory: "Dormitory",
  meeting: "Reception Room",
  hire: "HR Office",
  processing: "Workshop",
  training: "Training Room",
};

const INITIAL_LIST_LIMIT = 60;
const RARITY_OPTIONS = [
  { value: "all", label: "全部星级" },
  ...[6, 5, 4, 3, 2, 1].map((value) => ({ value: String(value), label: `${value} 星` })),
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
  const en = locale === "en";
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
      <ComboboxInput className="font-number h-11 w-full" aria-label={label} placeholder={intl("components_pages_SklandStatus.search", { value1: (en) ? (label.toLocaleLowerCase("en-US")) : "", label: (en) ? "" : (label) })} />
      <ComboboxContent>
        <ComboboxEmpty>{intl("components_pages_SklandStatus.noMatching", { value1: (en) ? (label.toLocaleLowerCase("en-US")) : "", label: (en) ? "" : (label) })}</ComboboxEmpty>
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

function credentialExpiryLabel(timestamp: number, en = false): string {
  return new Intl.DateTimeFormat((en ? "en-US" : "zh-CN"), {
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

  return (
    <section className="grid gap-3 pt-2" data-skland-data-controls>
      <div>
        <h2 className="text-sm font-semibold">{intl("components_pages_SklandStatus.dataManagement")}</h2>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground" data-ui-number-font>
          {intl.rich("components_pages_SklandStatus.rich1", { value1: () => (credentialExpiryLabel(account.credentialExpiresAt, true)), value2: () => (credentialExpiryLabel(account.credentialExpiresAt)) })}
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

function formatDateTime(timestamp: number | null, en = false): string {
  const date = timestamp !== null && timestamp > 0 && Number.isFinite(timestamp)
    ? new Date(timestamp * 1000)
    : null;
  if (!date || Number.isNaN(date.getTime())) return localize_components_pages_SklandStatus.text(en, "notProvided");
  return new Intl.DateTimeFormat((en ? "en-US" : "zh-CN"), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatCompactDateTime(timestamp: number | null, en = false): string {
  const date = timestamp !== null && timestamp > 0 && Number.isFinite(timestamp)
    ? new Date(timestamp * 1000)
    : null;
  if (!date || Number.isNaN(date.getTime())) return localize_components_pages_SklandStatus.text(en, "notProvided");
  const time = [date.getHours(), date.getMinutes()]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()} ${time}`;
}

function formatDate(timestamp: number | null, en = false): string {
  const date = timestamp !== null && timestamp > 0 && Number.isFinite(timestamp)
    ? new Date(timestamp * 1000)
    : null;
  if (!date || Number.isNaN(date.getTime())) return localize_components_pages_SklandStatus.text(en, "notProvided");
  return new Intl.DateTimeFormat((en ? "en-US" : "zh-CN"), { dateStyle: "medium" }).format(date);
}

function formatDuration(seconds: number, en = false): string {
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

function roomLabel(room: SklandInfrastructureRoom, en = false): string {
  const base = en ? ROOM_LABELS_ENGLISH[room.group] : ROOM_LABELS[room.group];
  return ["control", "meeting", "hire", "processing", "training"].includes(room.group) ? base : `${base} ${room.index + 1}`;
}

function roomMaxLevel(room: SklandInfrastructureRoom): number {
  return room.group === "control" || room.group === "dormitory" ? 5 : 3;
}

function professionLabel(profession: string, en = false): string {
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
  const en = locale === "en";
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
                  : intl("components_pages_SklandStatus.fullRecovery", { value1: (en) ? (formatDateTime(player.sanity.completeRecoveryTime, true)) : "", value2: (en) ? "" : (formatDateTime(player.sanity.completeRecoveryTime)) })}
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
                : intl("components_pages_SklandStatus.nextRecoveryInAbout", { value1: (en) ? (formatDuration(infrastructure.labor.remainSecs, true)) : "", value2: (en) ? "" : (formatDuration(infrastructure.labor.remainSecs)) })}
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
  const en = locale === "en";
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
                label: intl("components_pages_SklandStatus.working", { name: operator.name, value2: (en) ? (formatDuration(operator.workTime, true)) : "", value3: (en) ? "" : (formatDuration(operator.workTime)) }),
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
  const en = locale === "en";
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { infrastructure } = snapshot;

  function requestApplyLayout() {
    if (layoutDirty) setConfirmOpen(true);
    else onApplyLayout();
  }

  const hasSuggestion = Boolean(infrastructure.layoutSuggestion);
  const status = hasSuggestion
    ? intl("components_pages_SklandStatus.sklandLayout", { value1: (en) ? (infrastructure.layoutLabel ?? "Unrecognized") : "", value2: (en) ? "" : (infrastructure.layoutLabel ?? "未识别") })
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
  const en = locale === "en";
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
  return (
    <article className="[content-visibility:auto] [contain-intrinsic-size:16rem] border-t border-border/70 pt-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className="truncate font-medium">{operator.name}</h4>
            {operator.isAssist ? <Badge variant="secondary">助战</Badge> : null}
          </div>
          <p className="font-number mt-1 text-xs text-muted-foreground">
            {operator.rarity}★ · {professionLabel(operator.profession)} / {operator.subProfessionName}
          </p>
        </div>
        <Badge variant="outline" className="font-number">精 {operator.elite} Lv.{operator.level}</Badge>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div><dt className="text-muted-foreground">潜能</dt><dd className="font-number mt-0.5 font-medium">{operator.potential}</dd></div>
        <div><dt className="text-muted-foreground">信赖</dt><dd className="font-number mt-0.5 font-medium">{operator.favorPercent}%</dd></div>
        <div><dt className="text-muted-foreground">技能</dt><dd className="font-number mt-0.5 font-medium">Lv.{operator.mainSkillLevel}</dd></div>
      </dl>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer font-medium text-primary">专精、模组与皮肤</summary>
        <div className="mt-2 grid gap-1.5 leading-5 text-muted-foreground">
          <p className="font-number">
            专精：{operator.skills.length
              ? operator.skills.map((skill) => `S${skill.index} M${skill.specializeLevel}`).join(" · ")
              : "森空岛暂未提供"}
          </p>
          <p className="font-number">
            模组：{operator.modules.length
              ? operator.modules.map((module) => `${module.name} Lv.${module.level}${module.isDefault ? "（使用中）" : ""}`).join(" · ")
              : "无"}
          </p>
          <p>当前皮肤：{operator.currentSkinName ?? "默认服装"}</p>
          <p className="font-number">获得时间：{formatDate(operator.acquiredAt)}</p>
        </div>
      </details>
    </article>
  );
}

function SkinCard({ skin }: { skin: SklandOwnedSkin }) {
  return (
    <article className="[content-visibility:auto] border-t border-border/70 pt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-medium">{skin.name}</h4>
          <p className="mt-1 text-xs text-muted-foreground">{skin.operatorName} · {skin.brandId}</p>
        </div>
        {skin.isCurrent ? <Badge variant="secondary">使用中</Badge> : null}
      </div>
      <p className="font-number mt-3 text-xs text-muted-foreground">获得于 {formatDate(skin.obtainedAt)}</p>
    </article>
  );
}

export function OperatorsTab({ snapshot }: { snapshot: SklandStatusSnapshot }) {
  const [query, setQuery] = useState("");
  const [rarity, setRarity] = useState("all");
  const [profession, setProfession] = useState("all");
  const [operatorLimit, setOperatorLimit] = useState(INITIAL_LIST_LIMIT);
  const [skinLimit, setSkinLimit] = useState(INITIAL_LIST_LIMIT);
  const professions = useMemo(
    () => [...new Set(snapshot.operators.map((operator) => operator.profession))]
      .sort((left, right) => professionLabel(left).localeCompare(professionLabel(right), "zh-CN")),
    [snapshot.operators]
  );
  const professionOptions = useMemo(
    () => [
      { value: "all", label: "全部职业" },
      ...professions.map((value) => ({ value, label: professionLabel(value) })),
    ],
    [professions]
  );
  const filteredOperators = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return snapshot.operators
      .filter((operator) => !normalizedQuery || operator.name.toLocaleLowerCase("zh-CN").includes(normalizedQuery))
      .filter((operator) => rarity === "all" || operator.rarity === Number(rarity))
      .filter((operator) => profession === "all" || operator.profession === profession)
      .sort((left, right) =>
        right.rarity - left.rarity
        || right.elite - left.elite
        || right.level - left.level
        || left.name.localeCompare(right.name, "zh-CN")
      );
  }, [profession, query, rarity, snapshot.operators]);
  const filteredSkins = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return snapshot.skins
      .filter((skin) =>
        !normalizedQuery
        || skin.name.toLocaleLowerCase("zh-CN").includes(normalizedQuery)
        || skin.operatorName.toLocaleLowerCase("zh-CN").includes(normalizedQuery)
      )
      .sort((left, right) => right.obtainedAt - left.obtainedAt || left.name.localeCompare(right.name, "zh-CN"));
  }, [query, snapshot.skins]);

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
            placeholder="搜索干员或皮肤"
            aria-label="搜索干员或皮肤"
          />
        </label>
        <OperatorFilterCombobox
          label="星级"
          value={rarity}
          options={RARITY_OPTIONS}
          onValueChange={(value) => {
            setRarity(value);
            setOperatorLimit(INITIAL_LIST_LIMIT);
          }}
        />
        <OperatorFilterCombobox
          label="职业"
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
            <TabsTrigger value="operators" className="h-10 px-4">
              <UsersRound />干员 <span className="font-number">{filteredOperators.length}</span>
            </TabsTrigger>
            <TabsTrigger value="skins" className="h-10 px-4">
              <Shirt />皮肤 <span className="font-number">{filteredSkins.length}</span>
            </TabsTrigger>
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
                >
                  显示更多干员
                </Button>
              ) : null}
            </>
          ) : <p className="py-12 text-center text-sm text-muted-foreground">没有符合筛选条件的干员。</p>}
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
                >
                  显示更多皮肤
                </Button>
              ) : null}
            </>
          ) : <p className="py-12 text-center text-sm text-muted-foreground">森空岛暂未提供皮肤数据。</p>}
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
  const { player, progress } = snapshot;
  const now = useMinuteTimestamp(snapshot.infrastructure.currentTs);
  return (
    <div className="grid gap-7">
      <section className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
        <Card className="surface-shadow ring-0">
          <CardHeader>
            <CardDescription>博士档案</CardDescription>
            <CardTitle>{player.nickname}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div><dt className="text-muted-foreground">注册时间</dt><dd className="font-number mt-1 font-medium">{formatDate(player.registerTs)}</dd></div>
              <div><dt className="text-muted-foreground">主线进度</dt><dd className="font-number mt-1 font-medium">{player.mainStageProgress ?? "未提供"}</dd></div>
              <div><dt className="text-muted-foreground">助理</dt><dd className="mt-1 font-medium">{player.secretary?.name ?? "未提供"}</dd></div>
              <div><dt className="text-muted-foreground">月卡到期</dt><dd className="font-number mt-1 font-medium">{formatDate(player.subscriptionEnd)}</dd></div>
            </dl>
            {player.resume ? <p className="border-t pt-3 leading-6 text-muted-foreground">{player.resume}</p> : null}
          </CardContent>
        </Card>
        <Card className="surface-shadow ring-0">
          <CardHeader>
            <CardDescription>收藏概况</CardDescription>
            <CardTitle className="font-number">
              {player.counts.operators === null ? "暂未提供" : `${player.counts.operators} 名干员`}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-xs">
            <div><span className="text-muted-foreground">皮肤</span><strong className="font-number mt-1 block text-lg">{player.counts.skins ?? "—"}</strong></div>
            <div><span className="text-muted-foreground">家具</span><strong className="font-number mt-1 block text-lg">{player.counts.furniture ?? "—"}</strong></div>
          </CardContent>
        </Card>
      </section>

      <ProgressSection title="公开招募" description="完成时间以本次森空岛存档为准。">
        {progress.recruit?.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {progress.recruit.map((slot) => {
              const finished = slot.state === "completed"
                || (slot.state === "recruiting" && slot.finishTs > 0 && slot.finishTs <= now);
              const label = finished
                ? "已完成"
                : slot.state === "locked"
                  ? "未解锁"
                  : slot.state === "standby"
                    ? "空闲"
                    : "进行中";
              return (
                <div key={slot.index} className="rounded-lg bg-muted/45 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <strong className="font-number">槽位 {slot.index + 1}</strong>
                    <Badge variant={finished ? "secondary" : "outline"}>{label}</Badge>
                  </div>
                  <p className="font-number mt-2 text-xs text-muted-foreground">
                    {slot.finishTs > 0 ? formatDateTime(slot.finishTs) : "暂无计时"}
                  </p>
                </div>
              );
            })}
          </div>
        ) : <p className="text-sm text-muted-foreground">森空岛暂未提供公招计时。</p>}
      </ProgressSection>

      <ProgressSection title="作战进度" description="剿灭、保全派驻与集成战略。">
        {progress.campaign || progress.tower || progress.rogue ? (
          <div className="grid gap-6 lg:grid-cols-3">
            {progress.campaign ? (
              <div>
                <div className="flex items-center gap-2 text-sm font-medium"><PackageCheck className="size-4" />剿灭作战</div>
                <ProgressMeter label="奖励进度" {...progress.campaign.reward} />
                <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                  {progress.campaign.records.map((record) => (
                    <p key={`${record.zoneName}-${record.name}`} className="font-number">
                      {record.zoneName ? `${record.zoneName} · ` : ""}{record.name}：{record.maxKills}
                    </p>
                  ))}
                  {!progress.campaign.records.length ? <p>暂无记录</p> : null}
                </div>
              </div>
            ) : null}
            {progress.tower ? (
              <div>
                <div className="flex items-center gap-2 text-sm font-medium"><Boxes className="size-4" />保全派驻</div>
                <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                  {progress.tower.records.map((record) => (
                    <p key={`${record.name}-${record.subName}`} className="font-number">{record.name}{record.subName ? ` · ${record.subName}` : ""}：{record.best}</p>
                  ))}
                  {!progress.tower.records.length ? <p>暂无记录</p> : null}
                </div>
              </div>
            ) : null}
            {progress.rogue ? (
              <div>
                <div className="flex items-center gap-2 text-sm font-medium"><DoorOpen className="size-4" />集成战略</div>
                <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                  {progress.rogue.map((record) => (
                    <p key={record.name} className="font-number">{record.name}：藏品 {record.relicCount} · 银行 {record.bankCurrent}/{record.bankRecord}</p>
                  ))}
                  {!progress.rogue.length ? <p>暂无记录</p> : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : <p className="text-sm text-muted-foreground">森空岛暂未提供作战进度。</p>}
      </ProgressSection>

      <ProgressSection title="活动记录" description="只展示森空岛返回的关卡完成情况，不加载活动宣传链接。">
        {progress.activities?.length || progress.bossRush?.length ? (
          <div className="grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
            {(progress.activities ?? []).map((activity) => (
              <article key={`${activity.name}-${activity.startTime}`} className="border-t border-border/70 pt-3">
                <div className="flex items-center justify-between gap-3">
                  <strong>{activity.name}</strong>
                  {activity.isReplicate ? <Badge variant="outline">复刻</Badge> : null}
                </div>
                <p className="font-number mt-2 text-xs text-muted-foreground">
                  关卡 {activity.clearedStages}/{activity.totalStages} · 至 {formatDate(activity.endTime)}
                </p>
              </article>
            ))}
            {(progress.bossRush ?? []).map((record, index) => (
              <article key={`${record.stageCode}-${index}`} className="border-t border-border/70 pt-3">
                <strong className="font-number">{record.stageCode ?? "首领活动"} {record.stageName ?? ""}</strong>
                <p className="font-number mt-2 text-xs text-muted-foreground">
                  {record.played ? "已有记录" : "尚未挑战"} · {record.difficulty}
                </p>
              </article>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">森空岛暂未提供活动记录。</p>}
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
  const en = locale === "en";
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const pathname = usePathname();
  const selectedTab = sklandTabFromPathname(pathname) ?? "overview";
  const bindingState = deriveSklandBindingState(bindingSummary, accounts.length);
  if (sessionLoading) return <LoadingState />;

  if (!scheduleSnapshot) {
    const loginTitle = localize_components_pages_SklandStatus.text(en, "additional1", { choice1: ((en)) && (bindingState === "renewal-due") ? "yes" : "no", choice2: ((en) && !(bindingState === "renewal-due")) && (bindingState === "reauthorize") ? "yes" : "no", choice3: (!(en)) && (bindingState === "renewal-due") ? "yes" : "no", choice4: (!(en) && !(bindingState === "renewal-due")) && (bindingState === "reauthorize") ? "yes" : "no" });
    const loginDescription = localize_components_pages_SklandStatus.text(en, "additional2", { choice1: ((en)) && (bindingState === "renewal-due") ? "yes" : "no", choice2: ((en) && !(bindingState === "renewal-due")) && (bindingState === "reauthorize") ? "yes" : "no", value3: ((en) && !(bindingState === "renewal-due") && (bindingState === "reauthorize")) ? String(bindingCount) : "", choice4: (!(en)) && (bindingState === "renewal-due") ? "yes" : "no", choice5: (!(en) && (bindingState === "renewal-due")) && (bindingSummary.latestExpiredAt) ? "yes" : "no", value6: (!(en) && (bindingState === "renewal-due") && (bindingSummary.latestExpiredAt)) ? String(credentialExpiryLabel(bindingSummary.latestExpiredAt)) : "", choice7: (!(en) && !(bindingState === "renewal-due")) && (bindingState === "reauthorize") ? "yes" : "no", value8: (!(en) && !(bindingState === "renewal-due") && (bindingState === "reauthorize")) ? String(bindingCount) : "" });
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
            {intl("components_pages_SklandStatus.signedInAsReloadOrSignOutAndAuthorize", { value1: (en) ? (activeRole ? `“${activeRole.nickname}”` : "Skland") : "", value2: (en) ? "" : (activeRole ? `“${activeRole.nickname}”` : "森空岛") })}
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

      {bindingSummary.renewalDueCount > 0 ? (
        <Alert>
          <AlertDescription data-ui-number-font>
            {intl("components_pages_SklandStatus.sklandLinkSReachedTheSevenDayLimitAnd", { renewalDueCount: bindingSummary.renewalDueCount })}
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
            <TabsList data-yeye-scroll={undefined} className="max-w-full flex-wrap" data-skland-view-tabs>
              <TabsTrigger value="overview" nativeButton={false} render={<Link href={sklandTabHref("overview")} scroll={false} />}>{intl("components_pages_SklandStatus.overview")}</TabsTrigger>
              <TabsTrigger value="inventory" nativeButton={false} render={<Link href={sklandTabHref("inventory")} scroll={false} />}>{en ? "Backpack" : "背包"}</TabsTrigger>
              <TabsTrigger value="infrastructure" nativeButton={false} render={<Link href={sklandTabHref("infrastructure")} scroll={false} />}>{intl("components_pages_SklandStatus.infrastructure")}</TabsTrigger>
            </TabsList>
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
