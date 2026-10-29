"use client";
import { useRef } from "react";


import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../../messages/zh-CN/AK_components_workbench_AccountHealthRoute.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_components_workbench_AccountHealthRoute");

import { WorkbenchPageHeading } from "@/components/workbench/WorkbenchPageHeading";
import { WorkbenchCard } from "@/components/workbench/WorkbenchCard";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, ArrowLeft, ClipboardCheck, PackageOpen, RefreshCw, Settings2, UsersRound } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useLocale, useTranslations } from "use-intl";

import { getSklandInventory } from "@/api";
import { extractAccountHealthInput } from "@/account-health-input";
import { loadHealthDemand, type HealthDemand } from "@/account-health-demand";
import { buildHealthAdvice, holdsDurinGroup } from "@/account-health-advice";
import { AccountHealthDemandSection } from "@/components/pages/AccountHealthDemandSection";
import { AccountHealthReportSection } from "@/components/pages/AccountHealthReportSection";
import { InfraTechnicalCard, InfraTechnicalHeading } from "@/components/InfraTechnicalCard";
import { SetupActionButton } from "@/components/setup/SetupActionButton";
import { Button } from "@/components/ui/button";
import { formatScaledAmount } from "@/resource-scale-display";
import type { SklandInventoryData } from "@riic/arknights-domain/types";
import type { GameReportRecord } from "@riic/arknights-domain/game-report";
import { useWorkbench } from "@/workbench-context";
import { buildAccountHealthContext } from "@/agent-page-context";
import { workbenchPageAccent } from "@/workbench-accent";

const fmt = (value: number) => value.toLocaleString("zh-CN");
const ratio = (value: number | null) => value === null ? "—" : `${value.toFixed(2)} : 1`;
const MANUAL_STORAGE_KEY = "aic-skland-inventory-manual-resources-v1";
const GOLD_BAR_VALUE = 500;

export function AccountHealthRoute() {
  const { inventory } = useWorkbench();
  if (inventory.pending) return null;
  return <AccountHealthContent key={inventory.identityKey} identityKey={inventory.identityKey} />;
}

function AccountHealthContent({ identityKey }: { identityKey: string }) {
  const { account, healthOperators, skland, mastery, agent } = useWorkbench();
  const onAgentPageContextChange = agent.onPageContextChange;
  const en = useLocale();
  // Language changes update copy without reloading or overwriting in-progress work.
  const languageEffectRef = useRef({ en });
  useEffect(() => { languageEffectRef.current = { en }; }, [en]);
  const plannerText = useTranslations("components_pages_MasteryPlanner");
  const [inventory, setInventory] = useState<SklandInventoryData | null>(null);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [demand, setDemand] = useState<HealthDemand>();
  const [report, setReport] = useState<GameReportRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasSklandRole = Boolean(skland?.websiteAuthenticated && skland.skland.activeAccountId
    && skland.skland.accounts.some((account) => account.accountId === skland.skland.activeAccountId && account.selectedUid));

  const loadInventory = useCallback(async () => {
    if (!hasSklandRole) return;
    setLoading(true);
    try {
      const data = await getSklandInventory();
      if (data.identityKey !== identityKey) throw new Error(uiText.text(languageEffectRef.current.en, "theAccountChangedRefreshThePage"));
      setInventory(data);
      setError(null);
    } catch (cause) {
      setInventory(null);
      setError(cause instanceof Error ? cause.message : (uiText.text(languageEffectRef.current.en, "inventoryIsUnavailable")));
    } finally { setLoading(false); }
  }, [hasSklandRole, identityKey]);

  useEffect(() => {
    setDemand(loadHealthDemand(window.localStorage, identityKey) ?? {});
    try {
      const saved = JSON.parse(window.localStorage.getItem(`${MANUAL_STORAGE_KEY}:${identityKey}`) ?? "{}") as Record<string, unknown>;
      const counts: Record<string, number> = {};
      for (const [id, value] of Object.entries(saved)) {
        if (typeof value === "string" && /^\d+$/.test(value)) counts[id] = Number(value);
      }
      setOverrides(counts);
    } catch { setOverrides({}); }
  }, [identityKey]);
  useEffect(() => { void loadInventory(); }, [loadInventory]);

  const input = useMemo(() => extractAccountHealthInput({
    inventory: inventory ? { items: inventory.items, fetchedAt: inventory.fetchedAt, overrides } : undefined,
    operators: healthOperators,
    report: report ? { source: "game-report", days: report.days } : undefined,
    demand,
  }), [demand, healthOperators, inventory, overrides, report]);
  const stock = input.inventory;
  const training = input.training;
  const e2 = training?.byRarity.reduce((sum, row) => sum + row.promotedE2, 0) ?? 0;
  const modules = training?.byRarity.reduce((sum, row) => sum + row.modulesOpened, 0) ?? 0;
  const source = training?.source === "skland" ? (uiText.text(en, "skland"))
    : training?.source === "maa" ? "MAA Box" : (uiText.text(en, "sampleBox"));
  const scaled = useCallback((value: number) => formatScaledAmount(value, en), [en]);
  // 钱书缺口按含模组消耗比估算：经验×比与龙门币÷比互相推算需求，两侧只可能缺一边。
  const gap = stock && training?.representativeLmdToExperience != null
    ? (() => {
      const demandRatio = training.representativeLmdToExperience;
      const lmdShort = stock.experience * demandRatio - stock.lmd;
      const expShort = stock.lmd / demandRatio - stock.experience;
      if (lmdShort > 0) return { resource: "lmd" as const, amount: lmdShort };
      if (expShort > 0) return { resource: "experience" as const, amount: expShort };
      return null;
    })()
    : null;
  const gapText = (amount: number) => scaled(amount) ?? fmt(Math.round(amount));
  const approx = (value: number) => { const text = scaled(value); return text ? `≈ ${text}` : undefined; };
  const advice = useMemo(() => buildHealthAdvice(
    input, holdsDurinGroup(healthOperators?.items, healthOperators?.source), en
  ), [en, healthOperators, input]);
  useEffect(() => {
    onAgentPageContextChange("account-health", buildAccountHealthContext({ health: input, advice }));
  }, [advice, input, onAgentPageContextChange]);
  useEffect(() => () => onAgentPageContextChange("account-health", null), [onAgentPageContextChange]);
  const adviceWan = (amount: number) => scaled(amount) ?? fmt(Math.round(amount));

  return <section className="grid min-w-0 gap-3 pt-2 pb-8 md:gap-5 md:pt-5" aria-labelledby="account-health-heading" data-account-health-page>
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <WorkbenchPageHeading page="account-health" id="account-health-heading">{uiText.text(en, "accountHealth")}</WorkbenchPageHeading>
        <p className="mt-1 text-xs leading-5 text-muted-foreground md:mt-2 md:text-sm">{uiText.text(en, "yourResourcesAndDevelopmentProfile")}</p>
      </div>
      <SetupActionButton type="button" className="max-md:!h-11 max-md:w-11 max-md:!min-w-0 max-md:!px-0" variant="outline" onClick={mastery.onOpenSetup} disabled={mastery.pending} aria-label={plannerText("configureBox")} title={plannerText("configureBox")}>
        <Settings2 className="size-4 md:hidden" aria-hidden="true" /><span className="max-md:hidden">{plannerText("configureBox")}</span>
      </SetupActionButton>
    </header>

    <div className="grid min-w-0 gap-3 md:gap-5 lg:grid-cols-2" data-account-health-input-status>
      <WorkbenchCard glass accent={workbenchPageAccent("account-health")} aria-labelledby="health-stock-heading">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="health-stock-heading" className="flex items-center gap-2 text-sm font-semibold"><PackageOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{uiText.text(en, "resourceSnapshot")}</h2>
            {stock ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{uiText.text(en, "skland")} · {stock.fetchedAt ? new Date(stock.fetchedAt).toLocaleString(en === "en" ? "en-US" : "zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}{stock.manuallyOverriddenIds.length ? (uiText.text(en, "manualEntries")) : ""}</p> : null}
          </div>
          <div className="shrink-0">
            <Button size="icon" variant="ghost" aria-label={uiText.text(en, "refreshInventory")} title={uiText.text(en, "refreshInventory")} disabled={!hasSklandRole || loading} onClick={() => void loadInventory()}><RefreshCw className={loading ? "animate-spin" : ""} /></Button>
          </div>
        </div>
        {stock ? <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 border-t border-border pt-4 text-sm sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
          <Metric label={uiText.text(en, "lmd")} value={fmt(stock.lmd)} note={approx(stock.lmd)} />
          <Metric label={uiText.text(en, "exp")} value={fmt(stock.experience)} note={approx(stock.experience)} />
          <Metric label={uiText.text(en, "goldBars")} value={fmt(stock.goldUnits)} note={approx(stock.goldUnits * GOLD_BAR_VALUE)} />
          <Metric label={uiText.text(en, "availablePulls")} value={fmt(stock.directPulls)}
            note={stock.directPulls === 0
              ? <Link to="/skland/$tab" params={{ tab: "inventory" }} className="underline decoration-dotted underline-offset-2 hover:text-foreground">{uiText.text(en, "fillInViaSklandStatusBackpack")}</Link>
              : stock.yellowCertificatePulls > 0 ? (uiText.text(en, "includesFromYellowCertificates", { value1: fmt(stock.yellowCertificatePulls) })) : undefined} />
          <Metric label={uiText.text(en, "lmdExpInStock")} value={ratio(stock.lmdToExperience)} emphasis={stock.lmdToExperience != null} />
          <Metric label={uiText.text(en, "lmdExpGapModulesIn")} value={gap
            ? gap.resource === "lmd"
              ? (uiText.text(en, "lmdShort", { value1: gapText(gap.amount) }))
              : (uiText.text(en, "expShort", { value1: gapText(gap.amount) }))
            : training?.representativeLmdToExperience != null ? (uiText.text(en, "balanced")) : "—"} emphasis={gap !== null} />
        </dl>
          : <div className="mt-4 border-t border-border pt-4 text-sm leading-6 text-muted-foreground"><p role={error ? "alert" : "status"}>{loading ? (uiText.text(en, "loadingInventory")) : error ?? (uiText.text(en, "connectASklandRoleToReadInventory"))}</p></div>}
      </WorkbenchCard>

      <WorkbenchCard glass accent={workbenchPageAccent("account-health")} aria-labelledby="health-training-heading">
        <h2 id="health-training-heading" className="flex items-center gap-2 text-sm font-semibold"><UsersRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{uiText.text(en, "developmentProfile")}</h2>
        {training ? <><p className="mt-2 text-xs leading-5 text-muted-foreground">{source} · {uiText.text(en, "e2OperatorsModulesOpened", { value1: e2, value2: modules })}</p>
          <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-4 text-sm"><Metric label={uiText.text(en, "includingModules")} value={ratio(training.representativeLmdToExperience)} emphasis={training.representativeLmdToExperience != null} /><Metric label={uiText.text(en, "levelCostLmdExp")} value={ratio(training.levelOnlyLmdToExperience)} /></dl>
          <p className="mt-4 text-xs text-muted-foreground">{!training.usableForPersonalAssessment ? (uiText.text(en, "sampleDataIsExcludedFromPersonalRatios")) : e2 < 3 ? (uiText.text(en, "atLeast3E2OperatorsAreNeededFor")) : !training.moduleDataComplete ? (uiText.text(en, "moduleDataIsIncompleteTheModuleRatioIs")) : (uiText.text(en, "learnedFromEveryPromotedOperatorSActualCost"))}</p>
        </> : <p className="mt-4 text-sm text-muted-foreground">{uiText.text(en, "importAnOperatorBoxOrSyncSklandTo")}</p>}
      </WorkbenchCard>
    </div>

    <AccountHealthReportSection en={en} authenticated={account.authenticated} onRecordChange={setReport} />
    <AccountHealthDemandSection identityKey={identityKey} en={en} onChange={setDemand} />

    <section className="grid min-w-0 gap-3 md:gap-4" aria-labelledby="health-advice-heading" data-health-advice>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="health-advice-heading" className="text-base font-semibold">{uiText.text(en, "diagnosisAndAdvice")}</h2>
        <SetupActionButton nativeButton={false} variant="outline" className="max-md:!min-w-0 max-md:!px-3" render={<Link to="/" />}><ArrowLeft aria-hidden="true" />{uiText.text(en, "backToCalculator")}</SetupActionButton>
      </div>
      <InfraTechnicalCard group="control" showEmblem={false} className="min-w-0 p-4 md:p-6" dataSlot="account-health-advice-card">
      {advice.summary ? <p className="text-base font-medium leading-7 text-white/95">{advice.summary}</p> : null}
      {advice.stock ? <div className="mt-4 border-t border-white/10 pt-4">
        <InfraTechnicalHeading icon={<PackageOpen className="size-4" aria-hidden="true" />}>{uiText.text(en, "stock")}</InfraTechnicalHeading>
        <ul className="mt-3 grid gap-2 text-sm leading-6 text-white/70">
          <li>{uiText.text(en, "lmdExpGoldBars", { value1: fmt(advice.stock.lmd), value2: fmt(advice.stock.experience), value3: fmt(advice.stock.goldUnits) })}</li>
          {advice.stock.demandRatio !== null && (advice.stock.lmdShort !== null || advice.stock.expShort !== null)
            ? <li>{uiText.text(en, "inferredDemandDetails", { ratio: advice.stock.demandRatio.toFixed(2), resource: advice.stock.lmdShort !== null ? "lmd" : "exp", count: adviceWan(advice.stock.lmdShort ?? advice.stock.expShort!) })}</li>
            : null}
          {advice.stock.goldSurplus !== null
            ? <li>{uiText.text(en, "goldStockAdvice", { size: advice.stock.goldSurplus, target: advice.stock.lmdShort !== null ? "lmd" : advice.stock.expShort !== null ? "exp" : "trade" })}</li>
            : null}
          {advice.stock.sixStarCapacity
            ? <li>{(() => {
              const { byAverage, byMaxed } = advice.stock.sixStarCapacity;
              const num = (value: number) => value.toFixed(1);
              if (byAverage !== null && byMaxed < 1 && byAverage < 1) {
                return uiText.text(en, "currentStockCannotFullyDevelopASingleSix");
              }
              if (byAverage === null) {
                return byMaxed >= 1
                  ? (uiText.text(en, "currentStockTrainsAboutSixStarOperatorsAt", { value1: num(byMaxed) }))
                  : (uiText.text(en, "currentStockIsNotEnoughToFullyDevelop"));
              }
              const bothSufficient = byMaxed >= 1 && byAverage >= 1;
              const capText = (value: number) => value < 1
                ? (uiText.text(en, "under1"))
                : uiText.text(en, "about", { value1: num(value) });
              const explain = bothSufficient ? "" : (uiText.text(en, "under1MeansNotEnoughForOneOperator"));
              return uiText.text(en, "currentStockTrainsSixStarOperatorsAtThe", { value1: capText(byMaxed), value2: capText(byAverage), value3: explain });
            })()}</li>
            : null}
        </ul>
      </div> : null}
      {advice.production ? <div className="mt-4 border-t border-white/10 pt-4">
        <InfraTechnicalHeading icon={<Activity className="size-4" aria-hidden="true" />}>{uiText.text(en, "dailyOutput")}</InfraTechnicalHeading>
        <ul className="mt-3 grid gap-2 text-sm leading-6 text-white/70">
          {advice.production.grade && (advice.production.capacityIndex ?? advice.production.lmdExpSum) !== null
            ? <li>{uiText.text(en, "productionGrade", { degraded: advice.production.degraded ? "yes" : "no", count: adviceWan(advice.production.capacityIndex ?? advice.production.lmdExpSum!), grade: advice.production.grade })}</li>
            : null}
          {advice.production.dailyLmdIn !== null && advice.production.dailyExpIn !== null
            ? <li>{uiText.text(en, "dailyInflowLmdAndExpEachIncl30k", { value1: adviceWan(advice.production.dailyLmdIn), value2: adviceWan(advice.production.dailyExpIn) })}</li>
            : null}
          {advice.production.netGain !== null
            ? <li>{(() => {
              const hasGap = advice.stock !== null && (advice.stock.lmdShort !== null || advice.stock.expShort !== null);
              const tail = advice.production.coverDays !== null
                ? (uiText.text(en, "currentGapClosesInDays", { value1: Math.max(1, Math.round(advice.production.coverDays)) }))
                : advice.production.netGain.amount < 0 && hasGap
                  ? (uiText.text(en, "theGapKeepsWidening"))
                  : "";
              return uiText.text(en, "netResourceDetails", { resource: advice.production.netGain.resource, direction: advice.production.netGain.amount >= 0 ? "gain" : "loss", count: adviceWan(Math.abs(advice.production.netGain.amount)), tail });
            })()}</li>
            : null}
          {advice.production.combinedRatio !== null
            ? <li>{uiText.text(en, "baseLmdExpRatioCombinedWithOfflineIncome", { value1: ratio(advice.production.baseRatio), value2: ratio(advice.production.combinedRatio) })}</li>
            : null}
          {advice.production.goldNetUnits !== null
            ? <li>{uiText.text(en, "goldNetDetails", { tone: advice.production.goldTone ?? "unknown", count: fmt(Math.abs(advice.production.goldNetUnits)), estimate: advice.production.goldEstimated ? "normal" : "lower", runway: advice.production.goldRunwayDays !== null ? "known" : "unknown", days: Math.max(1, Math.round(advice.production.goldRunwayDays ?? 0)) })}</li>
            : null}
        </ul>
      </div> : null}
      {advice.recommendation ? <div className="mt-4 border-t border-white/10 pt-4">
        <InfraTechnicalHeading icon={<ClipboardCheck className="size-4" aria-hidden="true" />}>{uiText.text(en, "recommendation")}</InfraTechnicalHeading>
        <p className="mt-3 text-sm font-medium leading-6 text-white/95">{advice.recommendation.headline}</p>
        <ul className="mt-2 grid gap-2 text-sm leading-6 text-white/70">
          {advice.recommendation.lines.map((line) => <li key={line}>{line}</li>)}
          <li>{uiText.text(en, "shifts")}{advice.recommendation.shifts.join(en === "en" ? " " : "；")}</li>
        </ul>
      </div> : null}
      {advice.notes.length ? <ul className="mt-4 grid gap-2 text-xs leading-5 text-white/60">
        {advice.notes.map((note) => <li key={note}>{note}</li>)}
      </ul> : null}
      <details className="mt-4 border-t border-white/10 pt-1 text-xs leading-5 text-white/60 md:pt-4">
        <summary className="min-h-11 cursor-pointer content-center select-none outline-none focus-visible:ring-2 focus-visible:ring-[#FFD800] md:min-h-0">{uiText.text(en, "capacityCalculationRules")}</summary>
        <div className="mt-2 grid gap-2">
          <p>{uiText.text(en, "capacityIndexTrade05Gold08")}</p>
          <p>{uiText.text(en, "withoutGoldDataDegradedGradingUsesLmdExp")}</p>
          <p>{uiText.text(en, "offlineDailyIncome30kLmd30kExpSix")}</p>
          <p>{uiText.text(en, "sourcesKnowledgeBaseSkill8OutputDiagnosisLmd")}</p>
        </div>
      </details>
      </InfraTechnicalCard>
    </section>
  </section>;
}

function Metric({ label, value, note, emphasis }: { label: string; value: string; note?: ReactNode; emphasis?: boolean }) {
  return <div className="min-w-0"><dt className="text-xs leading-5 text-muted-foreground">{label}</dt><dd className={`mt-1 flex flex-wrap items-baseline gap-x-1.5 font-number text-lg leading-7 tabular-nums md:text-xl${emphasis ? " font-semibold" : ""}`}><span className="break-words">{value}</span>{note ? <span className="text-xs font-normal text-muted-foreground">{note}</span> : null}</dd></div>;
}
