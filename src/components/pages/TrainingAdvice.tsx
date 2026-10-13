import { localize as localize_components_pages_TrainingAdvice } from "../../i18n/helpers/components_pages_TrainingAdvice.ts";
import { useTranslations, useLocale } from "next-intl";
import { WorkbenchPageHeading } from "@/components/workbench/WorkbenchPageHeading";
import { messageRecord } from "@/i18n/translate";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { CircleAlert, ChevronDown, GraduationCap } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { InfraTechnicalCard, InfraTechnicalHeading } from "@/components/InfraTechnicalCard";
import { cn } from "@/lib/utils";
import { MOTION_DURATION, MOTION_EASE_IN_OUT } from "@/motion";
import { TrainingAdviceActionCard } from "@/components/training-advice/TrainingAdviceActionCard";
import { Button } from "@/components/ui/button";
import { OwnedOperatorFilter } from "@/components/operators/OwnedOperatorFilter";
import { OperatorRarityFilter, OperatorProfessionFilter } from "@/components/operators/OperatorPickerParts";
import { SkillFilterRow } from "@/components/skill-query/SkillFilterRow";
import { operatorPresentationFor } from "@/operatorPortraits";
import type {
  BaseBlueprint,
  OperBoxEntry,
  TrainingAdviceReport,
  UserProfile,
  UserProfileAction,
} from "@/types";

const TRAINING_BLACKLIST_KEY = "arknights-infra-training-blacklist-v1";
const TrainingCombinationCard = lazy(() => import("@/components/training-advice/TrainingCombinationCard").then((module) => ({
  default: module.TrainingCombinationCard,
})));

const RecommendationCard = lazy(() => import("@/components/RecommendationCard").then((module) => ({
  default: module.RecommendationCard,
})));

export type TrainingAdviceProps = {
  operbox?: OperBoxEntry[] | null;
  layout?: BaseBlueprint | null;
  profile?: UserProfile | null;
  trainingAdvice?: TrainingAdviceReport | null;
  requiresAccount?: boolean;
  sync?: {
    busy: boolean;
    disabled: boolean;
    retryIn: number;
    syncedAt: number | null;
    error: string | null;
    stale: boolean;
    resume: (() => void) | null;
    resumeDisabled: boolean;
    refresh: () => void;
  };
  onOpenCalculator: () => void;
};

function countRooms(layout: BaseBlueprint | null | undefined) {
  const rooms = layout?.rooms ?? [];
  return {
    total: rooms.length,
    trade: rooms.filter((room) => room.kind === "trade_post").length,
    factory: rooms.filter((room) => room.kind === "factory").length,
    power: rooms.filter((room) => room.kind === "power_plant").length,
    dormitory: rooms.filter((room) => room.kind === "dormitory").length,
  };
}

function duplicateValues(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    if (seen.has(normalized)) duplicates.add(normalized);
    seen.add(normalized);
  }
  return [...duplicates];
}

function contractIssues(layout: BaseBlueprint | null | undefined, operbox: OperBoxEntry[] | null | undefined, en = false) {
  const issues: string[] = [];
  const rooms = layout?.rooms ?? [];
  const entries = operbox ?? [];

  if (!rooms.length) issues.push(localize_components_pages_TrainingAdvice.text(en, "noBaseFacilitiesConfigured"));
  if (!entries.length) issues.push(localize_components_pages_TrainingAdvice.text(en, "noOperatorDataImported"));
  if (rooms.length > 64) issues.push(localize_components_pages_TrainingAdvice.text(en, "theBaseCannotContainMoreThan64Rooms"));
  if (entries.length > 1000) issues.push(localize_components_pages_TrainingAdvice.text(en, "operatorDataCannotContainMoreThan1000Entries"));
  if (rooms.some((room) => !room.id.trim())) issues.push(localize_components_pages_TrainingAdvice.text(en, "aRoomIdIsEmpty"));
  if (entries.some((entry) => !entry.id.trim() || !entry.name.trim())) issues.push(localize_components_pages_TrainingAdvice.text(en, "anOperatorIdOrNameIsEmpty"));

  const duplicateRoomIds = duplicateValues(rooms.map((room) => room.id));
  if (duplicateRoomIds.length) issues.push(localize_components_pages_TrainingAdvice.text(en, "duplicateRoomIds", { value1: (en) ? (duplicateRoomIds.join(", ")) : "", value2: (en) ? "" : (duplicateRoomIds.join("、")) }));

  const duplicateOperatorIds = duplicateValues(entries.map((entry) => entry.id));
  if (duplicateOperatorIds.length) issues.push(localize_components_pages_TrainingAdvice.text(en, "duplicateOperatorIds", { value1: (en) ? (duplicateOperatorIds.join(", ")) : "", value2: (en) ? "" : (duplicateOperatorIds.join("、")) }));

  const duplicateOperatorNames = duplicateValues(entries.map((entry) => entry.name));
  if (duplicateOperatorNames.length) issues.push(localize_components_pages_TrainingAdvice.text(en, "duplicateOperatorNames", { value1: (en) ? (duplicateOperatorNames.join(", ")) : "", value2: (en) ? "" : (duplicateOperatorNames.join("、")) }));

  return issues;
}

function actionKey(action: UserProfileAction, index: number) {
  return `${action.domain_id}-${action.kind}-${action.operator}-${index}`;
}

function formatPercent(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}

function CollapsibleSection({
  accent,
  title,
  count,
  collapsed,
  onToggle,
  filter,
  children,
}: {
  accent: string;
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  filter?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0" aria-label={title}>
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
        <button
          type="button"
          className="flex min-w-0 items-center gap-2.5 text-left max-sm:min-h-11"
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          <span className={`h-6 w-1.5 shrink-0 ${accent}`} aria-hidden="true" />
          <h2 className="truncate text-lg font-semibold text-foreground">{title}</h2>
          <span className="font-number text-xs text-muted-foreground">{count}</span>
          <motion.span
            className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
            animate={{ rotate: collapsed ? -90 : 0 }}
            transition={{ duration: MOTION_DURATION.fast, ease: MOTION_EASE_IN_OUT }}
            aria-hidden="true"
          >
            <ChevronDown className="size-4" />
          </motion.span>
        </button>
        {filter}
      </div>
      <div className={cn("grid min-w-0 gap-3", collapsed && "hidden")}>{children}</div>
    </section>
  );
}

export function TrainingAdvice({
  operbox,
  layout,
  profile,
  trainingAdvice,
  requiresAccount = false,
  sync,
  onOpenCalculator,
}: TrainingAdviceProps) {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale === "en";
  const shouldReduceMotion = useReducedMotion();
  const [onlyOwned, setOnlyOwned] = useState(false);
  const [rarityFilter, setRarityFilter] = useState("all");
  const [professionFilter, setProfessionFilter] = useState("all");
  const [blacklist, setBlacklist] = useState<string[]>([]);
  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(window.localStorage.getItem(TRAINING_BLACKLIST_KEY) ?? "[]");
      if (Array.isArray(stored)) setBlacklist(stored.filter((value): value is string => typeof value === "string"));
    } catch { /* Unavailable storage leaves this session's filters usable. */ }
  }, []);
  function updateBlacklist(next: string[]) {
    setBlacklist(next);
    try { window.localStorage.setItem(TRAINING_BLACKLIST_KEY, JSON.stringify(next)); } catch { /* Keep the session preference. */ }
  }
  const entries = operbox ?? [];
  const ownedByName = new Map(entries.map((entry) => [entry.name, entry]));
  const roomCounts = countRooms(layout);
  const issues = contractIssues(layout, operbox, en);
  function matchesFilters(name: string) {
    const entry = ownedByName.get(name);
    const operator = operatorPresentationFor({ name }).operator;
    return (!onlyOwned || entry?.own === true)
      && (rarityFilter === "all" || (operator?.rarity ?? entry?.rarity) === Number(rarityFilter))
      && (professionFilter === "all" || operator?.profession === Number(professionFilter))
      && !blacklist.includes(name);
  }
  const actions = (profile?.actions ?? []).filter((action) => matchesFilters(action.operator));
  const ownedTotal = entries.filter((entry) => entry.own).length;
  const eliteTotal = entries.filter((entry) => entry.own && entry.elite >= 2).length;
  const advice = trainingAdvice ?? null;
  const recommendations = (advice?.recommendations ?? []).filter((recommendation) => matchesFilters(recommendation.operator));
  const newbie = (advice?.incomplete_newbie ?? []).filter((item) => matchesFilters(item.operator));
  const hasFilters = onlyOwned || rarityFilter !== "all" || professionFilter !== "all" || blacklist.length > 0;
  const combinations = advice?.combinations ?? [];
  const context = advice?.context;
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const toggleSection = (id: string) =>
    setCollapsedSections((current) => ({ ...current, [id]: !current[id] }));
  const ownedFilter = <OwnedOperatorFilter value={onlyOwned} onChange={setOnlyOwned} />;
  const ownedEmpty = (
    <InfraTechnicalCard group="training" dataSlot="training-owned-empty" showEmblem={false}>
      <p className="py-6 text-center text-sm text-white/76">{localize_components_pages_TrainingAdvice.text(en, onlyOwned && rarityFilter === "all" && professionFilter === "all" && blacklist.length === 0 ? "noOwnedRecommendations" : "noMatchingRecommendations")}</p>
    </InfraTechnicalCard>
  );

  if (requiresAccount) {
    return (
      <div className="flex w-full flex-col gap-5 pt-5" data-training-page>
        <section className="min-w-0" aria-label={intl("components_pages_TrainingAdvice.trainingAdviceOverview")}>
          <div className="mb-2 flex min-w-0 items-center gap-2.5">
            <WorkbenchPageHeading page="training">{intl("components_pages_TrainingAdvice.trainingAdvice")}</WorkbenchPageHeading>
          </div>
          <InfraTechnicalCard group="training" className="min-h-[248px]" dataSlot="training-account-required" showEmblem={false}>
            <div className="grid min-h-[216px] place-content-center text-center">
              <CircleAlert className="mx-auto size-8 text-[var(--room-accent)]" aria-hidden="true" />
              <h2 className="mt-4 text-xl font-semibold">{intl("components_pages_TrainingAdvice.signInToViewTrainingAdvice")}</h2>
              <p className="mt-2 max-w-lg text-sm leading-6 text-white/62">{intl("components_pages_TrainingAdvice.dataComesFromYourUploadOrAThirdParty")}</p>
              <Button type="button" size="dialog" className="mx-auto mt-5 bg-white text-[#272a2b] hover:bg-white/90" onClick={onOpenCalculator}>{intl("components_pages_TrainingAdvice.backToCalculator")}</Button>
            </div>
          </InfraTechnicalCard>
        </section>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-5 pt-5" data-training-page>
      {sync ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-black/10 bg-white/60 p-3 text-sm" data-training-sync>
          <div className="min-w-0" role="status" aria-live="polite">
            <p>{sync.busy
              ? intl("components_pages_TrainingAdvice.syncing")
              : sync.syncedAt
                ? intl("components_pages_TrainingAdvice.lastSynced", { time: new Date(sync.syncedAt).toLocaleString(locale) })
                : intl("components_pages_TrainingAdvice.autoSync")}</p>
            {sync.error || sync.stale ? <p className="mt-1 text-amber-800">{sync.error ?? intl("components_pages_TrainingAdvice.syncStale")}</p> : null}
          </div>
          <Button type="button" variant="outline" size="sm"
            disabled={sync.resume ? sync.resumeDisabled : sync.busy || sync.disabled || sync.retryIn > 0}
            onClick={sync.resume ?? sync.refresh}>
            {sync.resume ? intl("components_pages_TrainingAdvice.resumeSync")
              : sync.retryIn > 0 ? intl("components_pages_TrainingAdvice.syncCooldown", { seconds: sync.retryIn })
                : intl("components_pages_TrainingAdvice.syncNow")}
          </Button>
        </div>
      ) : null}
      <section className="min-w-0" aria-label={intl("components_pages_TrainingAdvice.trainingAdviceOverview")}>
        <div className="mb-2 flex min-w-0 items-center gap-2.5">
          <WorkbenchPageHeading page="training">{intl("components_pages_TrainingAdvice.trainingAdvice")}</WorkbenchPageHeading>
          <span className="font-number text-xs text-muted-foreground">
            {advice ? recommendations.length : actions.length}
          </span>
        </div>
        <InfraTechnicalCard group="manufacture" dataSlot="training-summary" showEmblem={false}>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(28rem,0.8fr)] lg:items-end">
            <div>
              <InfraTechnicalHeading icon={<GraduationCap className="size-4" aria-hidden="true" />}>
                {intl("components_pages_TrainingAdvice.latestSchedule")}
              </InfraTechnicalHeading>
              <h2 className="mt-4 text-[23px] font-medium leading-tight tracking-[-0.02em]">
                {intl("components_pages_TrainingAdvice.trainingPrioritiesBasedOnTheLatestSchedule")}
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-px bg-white/10 sm:grid-cols-4">
              {[
                [intl("components_pages_TrainingAdvice.layout"), layout?.template || "—"],
                [intl("components_pages_TrainingAdvice.rooms"), roomCounts.total || "—"],
                [intl("components_pages_TrainingAdvice.owned"), entries.length ? ownedTotal : "—"],
                [intl("components_pages_TrainingAdvice.elite2"), entries.length ? eliteTotal : "—"],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0 bg-black/24 px-3 py-3">
                  <span className="text-[10px] text-white/48">{label}</span>
                  <strong className="mt-1 block truncate text-2xl font-semibold tabular-nums text-[var(--room-accent)]">
                    {value}
                  </strong>
                </div>
              ))}
              {advice ? (
                <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 bg-black/24 px-3 py-2 text-xs text-white/65 sm:col-span-4">
                  <span>{intl("components_pages_TrainingAdvice.efficiency")}</span>
                  <span>
                    <span className="font-number">{formatPercent(context?.trade_average_efficiency_percent)}</span> {intl("components_pages_TrainingAdvice.trading")}
                  </span>
                  <span>
                    <span className="font-number">{formatPercent(context?.manufacturing_average_efficiency_percent)}</span> {intl("components_pages_TrainingAdvice.manufacturing")}
                  </span>
                  {context?.dormitory_level_sum != null ? (
                    <span><span className="font-number">{context.dormitory_level_sum}</span> {intl("components_pages_TrainingAdvice.dormLevels")}</span>
                  ) : null}
                  {context?.engineering_robot_count != null ? (
                    <span><span className="font-number">{context.engineering_robot_count}</span> {intl("components_pages_TrainingAdvice.robots")}</span>
                  ) : null}
                  {context?.meeting_room_max_level != null ? (
                    <span>{intl("components_pages_TrainingAdvice.receptionRoom")} Lv<span className="font-number">{context.meeting_room_max_level}</span></span>
                  ) : null}
                  {context?.has_originium_shard_factory != null ? (
                    <span>{intl("components_pages_TrainingAdvice.originiumShards")} {context.has_originium_shard_factory ? (intl("components_pages_TrainingAdvice.yes")) : (intl("components_pages_TrainingAdvice.no"))}</span>
                  ) : null}
                </div>
              ) : (
                <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 bg-black/24 px-3 py-2 text-xs text-white/65 sm:col-span-4">
                  <span>{intl("components_pages_TrainingAdvice.facilities")}</span>
                  <span><span className="font-number">{roomCounts.trade}</span> {intl("components_pages_TrainingAdvice.trading")}</span>
                  <span><span className="font-number">{roomCounts.factory}</span> {intl("components_pages_TrainingAdvice.factories")}</span>
                  <span><span className="font-number">{roomCounts.power}</span> {intl("components_pages_TrainingAdvice.powerPlants")}</span>
                  <span><span className="font-number">{roomCounts.dormitory}</span> {intl("components_pages_TrainingAdvice.dormitories")}</span>
                </div>
              )}
            </div>
          </div>
        </InfraTechnicalCard>
      </section>

      {issues.length ? (
        <InfraTechnicalCard group="manufacture" dataSlot="training-data-check" showEmblem={false}>
          <div className="flex gap-3 text-sm" aria-label={intl("components_pages_TrainingAdvice.dataValidationIssues")}>
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-[var(--room-accent)]" aria-hidden="true" />
            <div>
              <strong className="text-[var(--room-accent)]">{intl("components_pages_TrainingAdvice.moreInformationIsRequired")}</strong>
              <ul className="mt-2 grid gap-1 text-white/72">
                {issues.map((issue) => <li key={issue}>• {issue}</li>)}
              </ul>
            </div>
          </div>
        </InfraTechnicalCard>
      ) : null}

      <div className="grid min-w-0 gap-1" data-training-filters>
        <SkillFilterRow label={intl("SkillFilters.rarity")}>
          <OperatorRarityFilter value={rarityFilter} onChange={setRarityFilter} />
        </SkillFilterRow>
        <SkillFilterRow label={intl("components_setup_ManualOperboxPicker.profession")}>
          <OperatorProfessionFilter value={professionFilter} onChange={setProfessionFilter} />
        </SkillFilterRow>
        {blacklist.length > 0 ? <Button type="button" variant="outline" className="justify-self-end" onClick={() => updateBlacklist([])}>{localize_components_pages_TrainingAdvice.text(en, "clearBlocked", { count: blacklist.length })}</Button> : null}
      </div>

      {advice ? (
        <>
          {advice.newbie_section_status === "shown" && advice.incomplete_newbie.length ? (
            <CollapsibleSection
              accent="bg-[#B8F03A]"
              title={intl("components_pages_TrainingAdvice.beginnerGoals")}
              count={newbie.length}
              collapsed={Boolean(collapsedSections.newbie)}
              onToggle={() => toggleSection("newbie")}
            >
              <div className="grid min-w-0 gap-3" data-training-newbie-list>
                {newbie.map((item, index) => (
                  <TrainingAdviceActionCard
                    key={`${item.action}-${item.operator}`}
                    action={item}
                    index={index}
                    onToggleBlacklist={() => updateBlacklist([...blacklist, item.operator])}
                  />
                ))}
              </div>
            </CollapsibleSection>
          ) : advice.newbie_section_status === "skipped_by_efficiency" ? (
            <InfraTechnicalCard group="power" dataSlot="training-newbie-skipped" showEmblem={false}>
              <p className="text-sm leading-6 text-white/76">
                {intl("components_pages_TrainingAdvice.averageTradingAndManufacturingEfficiencyAlreadyExceedsTheBeginner")}
                <span className="font-number mx-1 text-[var(--room-accent)]">{advice.incomplete_newbie.length}</span>
                {intl("components_pages_TrainingAdvice.operatorsStillHaveIncompleteBasicGoals")}
              </p>
            </InfraTechnicalCard>
          ) : advice.newbie_section_status === "complete" ? (
            <InfraTechnicalCard group="power" dataSlot="training-newbie-complete" showEmblem={false}>
              <p className="text-sm leading-6 text-white/76">{intl("components_pages_TrainingAdvice.basicTrainingGoalsAreComplete")}</p>
            </InfraTechnicalCard>
          ) : null}

          <CollapsibleSection
            accent="bg-[#29BDF5]"
            title={intl("components_pages_TrainingAdvice.trainingRecommendations")}
            count={recommendations.length}
            collapsed={Boolean(collapsedSections.actions)}
            onToggle={() => toggleSection("actions")}
            filter={ownedFilter}
          >
            {recommendations.length ? (
              <div className="grid min-w-0 gap-3" data-training-advice-list>
                {recommendations.map((recommendation, index) => (
                  <TrainingAdviceActionCard
                    key={`${recommendation.combination_id}-${recommendation.operator}`}
                    action={recommendation}
                    entry={ownedByName.get(recommendation.operator)}
                    index={index}
                    onToggleBlacklist={() => updateBlacklist([...blacklist, recommendation.operator])}
                  />
                ))}
              </div>
            ) : hasFilters ? ownedEmpty : (
              <InfraTechnicalCard group="training" className="min-h-[248px]" dataSlot="training-empty" showEmblem={false}>
                <div className="grid min-h-[216px] place-content-center text-center">
                  <h3 className="text-xl font-semibold">{intl("components_pages_TrainingAdvice.noPriorityTrainingTargets")}</h3>
                  <p className="mt-2 max-w-lg text-sm leading-6 text-white/62">
                    {intl("components_pages_TrainingAdvice.noOperatorOrLayoutRequiresPriorityTrainingYouCan")}
                  </p>
                </div>
              </InfraTechnicalCard>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            accent="bg-[#FFD501]"
            title={intl("components_pages_TrainingAdvice.combinationProgress")}
            count={combinations.length}
            collapsed={Boolean(collapsedSections.combinations)}
            onToggle={() => toggleSection("combinations")}
          >
            <div className="grid min-w-0 gap-3" data-training-combination-list>
              <Suspense fallback={<p className="py-4 text-sm text-white/62" role="status">{intl("components_pages_TrainingAdvice.loadingTrainingRecommendations")}</p>}>
              {combinations.map((combination) => (
                <TrainingCombinationCard key={combination.id} combination={combination} />
              ))}
              </Suspense>
            </div>
          </CollapsibleSection>
        </>
      ) : (
        <CollapsibleSection
          accent="bg-[#29BDF5]"
          title={intl("components_pages_TrainingAdvice.trainingRecommendations2")}
          count={actions.length}
          collapsed={Boolean(collapsedSections["legacy-actions"])}
          onToggle={() => toggleSection("legacy-actions")}
          filter={ownedFilter}
        >
          {actions.length ? (
            <div className="grid min-w-0 gap-3" data-training-advice-list>
              <Suspense fallback={<p className="py-4 text-sm text-white/62" role="status">{intl("components_pages_TrainingAdvice.loadingTrainingRecommendations")}</p>}>
                {actions.map((action, index) => (
                  <RecommendationCard key={actionKey(action, index)} action={action} entry={ownedByName.get(action.operator)} index={index} />
                ))}
              </Suspense>
            </div>
          ) : hasFilters ? ownedEmpty : (
            <InfraTechnicalCard
              group="training"
              className="min-h-[248px]"
              dataSlot="training-empty"
              showEmblem={false}
            >
              <div className="grid min-h-[216px] gap-6 sm:grid-cols-[minmax(0,1fr)_15rem] sm:items-center">
                <motion.div className="max-w-xl" initial={{ opacity: 0, x: shouldReduceMotion ? 0 : -12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: shouldReduceMotion ? 0 : 0.38, ease: [0.23, 1, 0.32, 1] }}>
                  <h3 className="text-xl font-semibold">
                    {profile ? (intl("components_pages_TrainingAdvice.noRecommendationsForThisSchedule")) : (intl("components_pages_TrainingAdvice.noTrainingRecommendationsYet"))}
                  </h3>
                  {profile ? (
                    <p className="mt-2 max-w-lg text-sm leading-6 text-white/62">
                      {intl("components_pages_TrainingAdvice.noOperatorOrLayoutRequiresPriorityTrainingYouCan")}
                    </p>
                  ) : null}
                  <div className="mt-5 flex justify-start">
                    <Button type="button" size="dialog" className="bg-white text-[#272a2b] hover:bg-white/90" onClick={onOpenCalculator}>
                      {profile ? (intl("components_pages_TrainingAdvice.viewCurrentSchedule")) : (intl("components_pages_TrainingAdvice.generateASchedule"))}
                    </Button>
                  </div>
                </motion.div>
                <motion.div className="hidden border-y border-white/12 py-3 sm:block" aria-hidden="true" initial={{ opacity: 0, x: shouldReduceMotion ? 0 : 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: shouldReduceMotion ? 0 : 0.38, delay: shouldReduceMotion ? 0 : 0.08, ease: [0.23, 1, 0.32, 1] }}>
                  {(messageRecord(en, "components_pages_TrainingAdvice_labels")).map((label, index) => (
                    <div key={label} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-white/8 py-2.5 last:border-0">
                      <span className="font-number text-[10px] text-white/35">0{index + 1}</span>
                      <span className="text-xs text-white/65">{label}</span>
                      <span className="font-number text-[10px] text-emerald-300/80">CLEAR</span>
                    </div>
                  ))}
                </motion.div>
              </div>
            </InfraTechnicalCard>
          )}
        </CollapsibleSection>
      )}
    </div>
  );
}
