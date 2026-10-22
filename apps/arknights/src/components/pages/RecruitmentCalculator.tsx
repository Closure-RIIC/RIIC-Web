"use client";
import { WorkbenchPageHeading } from "@/components/workbench/WorkbenchPageHeading";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import { ChevronDown, Settings2 } from "lucide-react";
import { SetupActionButton } from "@/components/setup/SetupActionButton";
import { InfraTechnicalCard } from "@/components/InfraTechnicalCard";
import { Tabs, TabsList, TabsTrigger, tabsListVariants } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PROFESSION_LABELS, PROFESSION_LABELS_ENGLISH } from "@/operator-presentation";
import catalog from "@riic/arknights-domain/generated/arkntools/operator-catalog.json";
import { cn } from "@/lib/utils";
import { localizedOperatorName } from "@/i18n/game-data";
import { useGameCatalog } from "@/i18n/game-data-client";
import { calculateRecruitment, RECRUITMENT_TAGS, RECRUITMENT_TAG_GROUPS, RECRUITMENT_SOURCE } from "@/recruitment";
import type { OperBoxEntry } from "@riic/arknights-domain/types";

export interface RecruitmentCalculatorProps {
  operbox: OperBoxEntry[] | null;
  sourceName: string | null;
  pending: boolean;
  onOpenSetup: () => void;
}

const operatorsById = new Map(catalog.map((operator) => [operator.id, operator]));

export function RecruitmentCalculator({ operbox, sourceName, pending, onOpenSetup }: RecruitmentCalculatorProps) {
  const t = useTranslations("Recruitment");
  const mastery = useTranslations("components_pages_MasteryPlanner");
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  const [tags, setTags] = useState<number[]>([]);
  const [minutes, setMinutes] = useState("540");
  const [missingOnly, setMissingOnly] = useState(false);
  const [fourStarOnly, setFourStarOnly] = useState(false);
  const personalBox = pending ? null : operbox;
  const results = useMemo(() => calculateRecruitment(tags, Number(minutes), personalBox), [tags, minutes, personalBox]);
  const visibleResults = results.filter((result) => (!fourStarOnly || result.minimumRarity >= 4)
    && (!missingOnly || personalBox === null || (result.missingCount ?? 0) > 0));
  const tagName = (id: number) => {
    const tag = RECRUITMENT_TAGS.find((item) => item.id === id)!;
    return locale === "en" ? tag.en : tag.zh;
  };

  return <section className="grid min-w-0 gap-3 pt-2 pb-8 md:gap-5 md:pt-5" aria-labelledby="recruitment-heading" data-recruitment-page>
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <WorkbenchPageHeading page="recruitment" id="recruitment-heading">{t("title")}</WorkbenchPageHeading>
        <p className="mt-1 text-xs leading-5 text-muted-foreground md:mt-2 md:text-sm">{t("intro")}</p>
      </div>
      <SetupActionButton type="button" className="max-md:!h-11 max-md:w-11 max-md:!min-w-0 max-md:!px-0" variant="outline" onClick={onOpenSetup} disabled={pending} aria-label={mastery("configureBox")} title={mastery("configureBox")}>
        <Settings2 className="size-4 md:hidden" aria-hidden="true" /><span className="max-md:hidden">{mastery("configureBox")}</span>
      </SetupActionButton>
    </header>

    <div className="grid min-w-0 gap-3 rounded-[4px] border border-border bg-card p-3 md:gap-5 md:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0" aria-live="polite">
          <p className="text-xs text-muted-foreground">{mastery("currentBox")}</p>
          <p className="mt-1 break-words text-sm">{pending ? t("boxLoading") : personalBox === null ? t("boxUnavailable") : t("boxSource", { name: sourceName ?? t("personalBox"), count: personalBox.filter((operator) => operator.own).length })}</p>
          {!pending && personalBox === null ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{t("boxHint")}</p> : null}
        </div>
        <span className="shrink-0 text-xs leading-5 text-muted-foreground">{t("server")}</span>
      </div>

      <div className="grid min-w-0 gap-2 md:gap-4" aria-describedby="recruitment-tag-count">
        {RECRUITMENT_TAG_GROUPS.map((group) => <div key={group.label} className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] items-start gap-2">
          <span className="pt-3 text-xs text-muted-foreground md:pt-2">{t(group.label)}</span>
          <ToggleGroup multiple aria-label={t(group.label)} className={cn(tabsListVariants(), "max-w-full flex-wrap justify-start gap-1")}
            value={tags.filter((tag) => group.ids.some((id) => id === tag)).map(String)}
            onValueChange={(values) => setTags((current) => {
              const next = [...current.filter((tag) => !group.ids.some((id) => id === tag)), ...values.map(Number)];
              return next.length <= 5 ? next : current;
            })}>
            {group.ids.map((id) => <ToggleGroupItem key={id} value={String(id)} disabled={tags.length === 5 && !tags.includes(id)}
              className="h-auto min-h-8 rounded-md border border-transparent px-2 py-0.5 text-sm font-medium text-foreground/60 aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm dark:aria-pressed:border-input dark:aria-pressed:bg-input/30 max-md:min-h-11 max-md:px-2 max-md:text-xs">
              {tagName(id)}
            </ToggleGroupItem>)}
          </ToggleGroup>
        </div>)}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p id="recruitment-tag-count" className="text-xs leading-5 text-muted-foreground" aria-live="polite">{t(tags.length === 5 ? "tagLimit" : "tagCount", { count: tags.length })}</p>
        <SetupActionButton type="button" variant="outline" disabled={!tags.length} onClick={() => setTags([])}>{t("clear")}</SetupActionButton>
      </div>

      <div className="grid gap-3 border-t border-border pt-3 md:gap-4 md:pt-4">
        <div className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] items-center gap-2 md:w-fit md:grid-cols-1 max-md:[&_[data-slot=tabs-list]]:w-full max-md:[&_[data-slot=tabs-trigger]]:min-h-11 max-md:[&_[data-slot=tabs-trigger]]:min-w-0 max-md:[&_[data-slot=tabs-trigger]]:px-1 max-md:[&_[data-slot=tabs-trigger]]:text-xs">
          <span className="text-xs text-muted-foreground">{t("duration")}</span>
          <Tabs value={minutes} onValueChange={setMinutes}>
            <TabsList aria-label={t("duration")}>
              {(["230", "240", "460", "540"] as const).map((value) => <TabsTrigger key={value} value={value}>{t(`duration${value}`)}</TabsTrigger>)}
            </TabsList>
          </Tabs>
        </div>
        {tags.includes(28) && Number(minutes) >= 240 ? <p className="text-xs leading-5 text-muted-foreground" role="status">{t("robotHint")}</p> : null}
        {tags.includes(17) && Number(minutes) >= 460 ? <p className="text-xs leading-5 text-muted-foreground" role="status">{t("starterHint")}</p> : null}
        {(tags.includes(11) || tags.includes(14)) && minutes !== "540" ? <p className="text-xs leading-5 text-muted-foreground" role="status">{t("seniorHint")}</p> : null}
      </div>
    </div>
    <p className="text-xs leading-5 text-muted-foreground">{t("rules")}</p>

    <div className="grid min-w-0 gap-4" data-recruitment-results>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold" aria-live="polite">{t("results", { count: visibleResults.length })}</h2>
        <div className="flex max-w-full flex-wrap gap-2">
          <SetupActionButton type="button" className="max-md:!min-w-0 max-md:whitespace-normal max-md:!px-3" variant={fourStarOnly ? "default" : "outline"} aria-pressed={fourStarOnly} onClick={() => setFourStarOnly(!fourStarOnly)}>{t("fourStarOnly")}</SetupActionButton>
          <SetupActionButton type="button" className="max-md:!min-w-0 max-md:whitespace-normal max-md:!px-3" variant={missingOnly && personalBox !== null ? "default" : "outline"} aria-pressed={missingOnly && personalBox !== null} disabled={personalBox === null} onClick={() => setMissingOnly(!missingOnly)}>{t("missingOnly")}</SetupActionButton>
        </div>
      </div>
      {!visibleResults.length ? <div className="rounded-[4px] border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground" role="status">
        {t(!tags.length ? "empty" : results.length ? "filteredEmpty" : "noMatches")}
      </div> : visibleResults.map((result, index) => <InfraTechnicalCard key={result.tags.join("-")} group="hire" showEmblem={false} dataSlot="recruitment-combination-card">
        <details open={index < 3} className="group">
        <summary className="grid min-h-11 cursor-pointer list-none grid-cols-[minmax(0,1fr)_1rem] items-start gap-3 outline-none focus-visible:ring-2 focus-visible:ring-[#FFD800] focus-visible:ring-offset-2 focus-visible:ring-offset-[#272A2B] [&::-webkit-details-marker]:hidden">
          <span className="grid min-w-0 gap-2.5">
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base font-semibold leading-6 text-white/95">
              {result.tags.map((id, tagIndex) => <span key={id} className="inline-flex items-baseline gap-2">
                {tagIndex > 0 ? <span className="text-sm font-normal text-white/35">+</span> : null}
                <span>{tagName(id)}</span>
              </span>)}
            </span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
              <span className="inline-flex h-6 shrink-0 items-center whitespace-nowrap border border-white/15 bg-white/8 px-2 font-medium text-white/85">{t("minimum", { rarity: result.minimumRarity })}</span>
              <span className="inline-flex h-6 shrink-0 items-center whitespace-nowrap text-white/60">{t("candidates", { count: result.operators.length })}</span>
              {result.missingCount !== null ? <span className={cn("inline-block h-6 shrink-0 whitespace-nowrap border border-l-2 px-2 text-xs leading-[22px]", result.missingCount > 0 ? "border-amber-200/15 border-l-amber-300/70 bg-amber-200/5 text-amber-100/80" : "border-white/10 border-l-white/25 bg-white/5 text-white/50")}>
                {t.rich("missingCount", {
                  count: result.missingCount,
                  number: (chunks) => <span className={cn("font-number inline-block align-baseline text-sm font-semibold tabular-nums", result.missingCount! > 0 ? "text-amber-200" : "text-white/65")}>{chunks}</span>,
                })}
              </span> : null}
            </span>
          </span>
          <ChevronDown className="mt-1 size-4 text-white/60 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
        </summary>
        <ul className="mt-3 grid gap-2 border-t border-white/10 pt-3 sm:grid-cols-2 xl:grid-cols-3">
          {result.operators.map((operator) => {
            const meta = operatorsById.get(operator.id);
            const profession = meta ? (locale === "en" ? PROFESSION_LABELS_ENGLISH : PROFESSION_LABELS)[meta.profession] : null;
            return <li key={operator.id} className={cn("grid min-w-0 grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-2.5 border border-white/10 p-2", operator.ownership === "owned" ? "bg-white/10" : "bg-black/18")}>
              <span className="size-12 overflow-hidden border border-white/10 bg-[#272A2B]">
                {meta?.portrait ? <img src={meta.portrait} alt="" className="size-full object-cover" loading="lazy" decoding="async" /> : null}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm text-white/85">{localizedOperatorName(operator.name, locale, gameCatalog)}</span>
                <span className="font-number block truncate text-xs text-white/50">{operator.rarity}★{profession ? ` · ${profession}` : ""}</span>
              </span>
              <span className={cn("max-w-28 text-right text-xs", operator.ownership === "owned" ? "text-emerald-300" : operator.ownership === "missing" ? "text-red-300" : "text-white/60")}>{t(operator.ownership)}</span>
            </li>;
          })}
        </ul>
        </details>
      </InfraTechnicalCard>)}
    </div>
    <p className="text-xs leading-5 text-muted-foreground">
      {t("dataNote")}{" "}
      <a className="underline underline-offset-4" href={`${RECRUITMENT_SOURCE.repository}/tree/${RECRUITMENT_SOURCE.commit}`} target="_blank" rel="noreferrer">Arknights Toolbox ({RECRUITMENT_SOURCE.commit.slice(0, 7)})</a>
      {" · "}<a className="underline underline-offset-4" href="https://prts.wiki/w/公开招募" target="_blank" rel="noreferrer">{t("reference")}</a>
    </p>
  </section>;
}
