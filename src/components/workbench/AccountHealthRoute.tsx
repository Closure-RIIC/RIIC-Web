"use client";
import { WorkbenchPageHeading } from "@/components/workbench/WorkbenchPageHeading";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, ArrowLeft, ClipboardCheck, PackageOpen, RefreshCw, Settings2, UsersRound } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

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
import type { SklandInventoryData } from "@/types";
import type { GameReportRecord } from "@/game-report";
import { useWorkbench } from "@/workbench-context";

const fmt = (value: number) => value.toLocaleString("zh-CN");
const ratio = (value: number | null) => value === null ? "—" : `${value.toFixed(2)} : 1`;
const MANUAL_STORAGE_KEY = "aic-skland-inventory-manual-resources-v1";
const GOLD_BAR_VALUE = 500;
const MODULE_CARD = "min-w-0 rounded-[4px] border border-border bg-card p-3 md:p-6";

export function AccountHealthRoute() {
  const { inventory } = useWorkbench();
  if (inventory.pending) return null;
  return <AccountHealthContent key={inventory.identityKey} identityKey={inventory.identityKey} />;
}

function AccountHealthContent({ identityKey }: { identityKey: string }) {
  const { account, healthOperators, skland, mastery } = useWorkbench();
  const en = useLocale() === "en";
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
      if (data.identityKey !== identityKey) throw new Error(en ? "The account changed. Refresh the page." : "账号或角色已变化，请刷新页面。");
      setInventory(data);
      setError(null);
    } catch (cause) {
      setInventory(null);
      setError(cause instanceof Error ? cause.message : (en ? "Inventory is unavailable" : "库存暂不可用"));
    } finally { setLoading(false); }
  }, [en, hasSklandRole, identityKey]);

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
  const source = training?.source === "skland" ? (en ? "Skland" : "森空岛")
    : training?.source === "maa" ? "MAA Box" : (en ? "Sample Box" : "示例 Box");
  const scaled = useCallback((value: number) => formatScaledAmount(value, en ? "en" : "zh"), [en]);
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
    input, holdsDurinGroup(healthOperators?.items, healthOperators?.source), en ? "en" : "zh"
  ), [en, healthOperators, input]);
  const adviceWan = (amount: number) => scaled(amount) ?? fmt(Math.round(amount));

  return <section className="grid min-w-0 gap-3 pt-2 pb-8 md:gap-5 md:pt-5" aria-labelledby="account-health-heading" data-account-health-page>
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <WorkbenchPageHeading page="account-health" id="account-health-heading">{en ? "Account Health" : "账号体检"}</WorkbenchPageHeading>
        <p className="mt-1 text-xs leading-5 text-muted-foreground md:mt-2 md:text-sm">{en ? "Your resources and development profile" : "库存与培养习惯概览"}</p>
      </div>
      <SetupActionButton type="button" className="max-md:!h-11 max-md:w-11 max-md:!min-w-0 max-md:!px-0" variant="outline" onClick={mastery.onOpenSetup} disabled={mastery.pending} aria-label={plannerText("configureBox")} title={plannerText("configureBox")}>
        <Settings2 className="size-4 md:hidden" aria-hidden="true" /><span className="max-md:hidden">{plannerText("configureBox")}</span>
      </SetupActionButton>
    </header>

    <div className="grid min-w-0 gap-3 md:gap-5 lg:grid-cols-2" data-account-health-input-status>
      <section className={MODULE_CARD} aria-labelledby="health-stock-heading">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="health-stock-heading" className="flex items-center gap-2 text-sm font-semibold"><PackageOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{en ? "Resource snapshot" : "资源库存"}</h2>
            {stock ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{en ? "Skland" : "森空岛"} · {stock.fetchedAt ? new Date(stock.fetchedAt).toLocaleString(en ? "en-US" : "zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}{stock.manuallyOverriddenIds.length ? (en ? " · Manual entries" : " · 含手填") : ""}</p> : null}
          </div>
          <div className="shrink-0">
            <Button size="icon" variant="ghost" aria-label={en ? "Refresh inventory" : "刷新库存"} title={en ? "Refresh inventory" : "刷新库存"} disabled={!hasSklandRole || loading} onClick={() => void loadInventory()}><RefreshCw className={loading ? "animate-spin" : ""} /></Button>
          </div>
        </div>
        {stock ? <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 border-t border-border pt-4 text-sm sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
          <Metric label={en ? "LMD" : "龙门币"} value={fmt(stock.lmd)} note={approx(stock.lmd)} />
          <Metric label={en ? "EXP" : "作战记录经验"} value={fmt(stock.experience)} note={approx(stock.experience)} />
          <Metric label={en ? "Gold bars" : "赤金"} value={fmt(stock.goldUnits)} note={approx(stock.goldUnits * GOLD_BAR_VALUE)} />
          <Metric label={en ? "Available pulls" : "可用常规抽数"} value={fmt(stock.directPulls)}
            note={stock.directPulls === 0
              ? <Link href="/skland/inventory" className="underline decoration-dotted underline-offset-2 hover:text-foreground">{en ? "Fill in via Skland status · Backpack" : "到森空岛状态·背包补充填写"}</Link>
              : stock.yellowCertificatePulls > 0 ? (en ? `Includes ${fmt(stock.yellowCertificatePulls)} from yellow certificates` : `含黄票兑换 ${fmt(stock.yellowCertificatePulls)} 抽`) : undefined} />
          <Metric label={en ? "LMD / EXP in stock" : "库存钱书比"} value={ratio(stock.lmdToExperience)} emphasis={stock.lmdToExperience != null} />
          <Metric label={en ? "LMD / EXP gap (modules in)" : "钱书缺口（含模组比）"} value={gap
            ? gap.resource === "lmd"
              ? (en ? `LMD short ≈ ${gapText(gap.amount)}` : `缺龙门币 ≈ ${gapText(gap.amount)}`)
              : (en ? `EXP short ≈ ${gapText(gap.amount)}` : `缺经验 ≈ ${gapText(gap.amount)}`)
            : training?.representativeLmdToExperience != null ? (en ? "Balanced" : "钱书匹配") : "—"} emphasis={gap !== null} />
        </dl>
          : <div className="mt-4 border-t border-border pt-4 text-sm leading-6 text-muted-foreground"><p role={error ? "alert" : "status"}>{loading ? (en ? "Loading inventory…" : "正在读取库存…") : error ?? (en ? "Connect a Skland role to read inventory." : "绑定森空岛角色后可读取库存。")}</p></div>}
      </section>

      <section className={MODULE_CARD} aria-labelledby="health-training-heading">
        <h2 id="health-training-heading" className="flex items-center gap-2 text-sm font-semibold"><UsersRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{en ? "Development profile" : "培养画像"}</h2>
        {training ? <><p className="mt-2 text-xs leading-5 text-muted-foreground">{source} · {en ? `${e2} E2 operators, ${modules} modules opened` : `精二 ${e2} 人，已开启模组 ${modules} 个`}</p>
          <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-4 text-sm"><Metric label={en ? "Including modules" : "含模组钱书比"} value={ratio(training.representativeLmdToExperience)} emphasis={training.representativeLmdToExperience != null} /><Metric label={en ? "Level cost LMD / EXP" : "等级消耗钱书比"} value={ratio(training.levelOnlyLmdToExperience)} /></dl>
          <p className="mt-4 text-xs text-muted-foreground">{!training.usableForPersonalAssessment ? (en ? "Sample data is excluded from personal ratios." : "示例干员池不用于个人需求比。") : e2 < 3 ? (en ? "At least 3 E2 operators are needed for a ratio." : "需要至少 3 名精二干员才能估算需求比。") : !training.moduleDataComplete ? (en ? "Module data is incomplete; the module ratio is unavailable." : "模组数据不完整，暂不计算含模组比例。") : (en ? "Learned from every promoted operator's actual cost." : "按全部精二干员的实际消耗逐人累计。")}</p>
        </> : <p className="mt-4 text-sm text-muted-foreground">{en ? "Import an operator Box or sync Skland to view your development profile." : "导入干员 Box 或同步森空岛后可查看培养画像。"}</p>}
      </section>
    </div>

    <AccountHealthReportSection en={en} authenticated={account.authenticated} onRecordChange={setReport} />
    <AccountHealthDemandSection identityKey={identityKey} en={en} onChange={setDemand} />

    <section className="grid min-w-0 gap-3 md:gap-4" aria-labelledby="health-advice-heading" data-health-advice>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="health-advice-heading" className="text-base font-semibold">{en ? "Diagnosis and advice" : "诊断与建议"}</h2>
        <SetupActionButton nativeButton={false} variant="outline" className="max-md:!min-w-0 max-md:!px-3" render={<Link href="/" />}><ArrowLeft aria-hidden="true" />{en ? "Back to calculator" : "返回基建计算器"}</SetupActionButton>
      </div>
      <InfraTechnicalCard group="control" showEmblem={false} className="min-w-0 p-4 md:p-6" dataSlot="account-health-advice-card">
      {advice.summary ? <p className="text-base font-medium leading-7 text-white/95">{advice.summary}</p> : null}
      {advice.stock ? <div className="mt-4 border-t border-white/10 pt-4">
        <InfraTechnicalHeading icon={<PackageOpen className="size-4" aria-hidden="true" />}>{en ? "Stock" : "库存情况"}</InfraTechnicalHeading>
        <ul className="mt-3 grid gap-2 text-sm leading-6 text-white/70">
          <li>{en ? `LMD ${fmt(advice.stock.lmd)} · EXP ${fmt(advice.stock.experience)} · gold ${fmt(advice.stock.goldUnits)} bars` : `龙门币 ${fmt(advice.stock.lmd)} · 作战记录 ${fmt(advice.stock.experience)} · 赤金 ${fmt(advice.stock.goldUnits)} 根`}</li>
          {advice.stock.demandRatio !== null && (advice.stock.lmdShort !== null || advice.stock.expShort !== null)
            ? <li>{en
              ? `Inferred LMD/EXP demand ratio ${advice.stock.demandRatio.toFixed(2)}; ${advice.stock.lmdShort !== null ? `LMD short ${adviceWan(advice.stock.lmdShort)}` : `EXP short ${adviceWan(advice.stock.expShort!)}`}.`
              : `推测钱书需求比 ${advice.stock.demandRatio.toFixed(2)}，${advice.stock.lmdShort !== null ? `缺龙门币 ${adviceWan(advice.stock.lmdShort)}` : `缺经验 ${adviceWan(advice.stock.expShort!)}`}。`}</li>
            : null}
          {advice.stock.goldSurplus !== null
            ? <li>{en
              ? `${advice.stock.goldSurplus === "large" ? "A large gold surplus" : "A gold surplus"} is accumulating; ${advice.stock.lmdShort !== null ? "shift capacity toward LMD" : advice.stock.expShort !== null ? "shift capacity toward EXP" : "raise trade-post usage"}.`
              : `赤金库存存在${advice.stock.goldSurplus === "large" ? "大量" : "明显"}盈余；${advice.stock.lmdShort !== null ? "建议产能向龙门币侧倾斜" : advice.stock.expShort !== null ? "建议产能向作战记录侧倾斜" : "建议提高贸易用量"}。`}</li>
            : null}
          {advice.stock.sixStarCapacity
            ? <li>{(() => {
              const { byAverage, byMaxed } = advice.stock.sixStarCapacity;
              const num = (value: number) => value.toFixed(1);
              if (byAverage !== null && byMaxed < 1 && byAverage < 1) {
                return en
                  ? "Current stock cannot fully develop a single six-star operator, neither at the maxed benchmark (E2 Lv.90 + one Lv.3 module) nor at your own average development cost."
                  : "现有库存不论是按拉满口径（精二 90 级＋一个三级模组）还是按你当前养成状态的人均消耗，都不足以养成一名六星干员。";
              }
              if (byAverage === null) {
                return byMaxed >= 1
                  ? (en ? `Current stock trains about ${num(byMaxed)} six-star operators at the maxed benchmark (E2 Lv.90 + one Lv.3 module).` : `现有库存按拉满口径（精二 90 级＋一个三级模组）约可培养 ${num(byMaxed)} 名六星干员。`)
                  : (en ? "Current stock is not enough to fully develop one six-star operator at the maxed benchmark (E2 Lv.90 + one Lv.3 module)." : "现有库存按拉满口径（精二 90 级＋一个三级模组）不足以养成一名六星干员。");
              }
              const bothSufficient = byMaxed >= 1 && byAverage >= 1;
              const capText = (value: number) => value < 1
                ? (en ? "under 1" : "不足 1 名")
                : en ? `about ${num(value)}` : `约 ${num(value)} 名`;
              const explain = bothSufficient ? "" : (en ? "; under 1 means not enough for one operator" : "；不足 1 名表示按该口径尚不够养成一名");
              return en
                ? `Current stock trains ${capText(byMaxed)} six-star operators at the maxed benchmark (E2 Lv.90 + one Lv.3 module), ${capText(byAverage)} at your own average development cost${explain}.`
                : `现有库存可培养六星干员：拉满口径（精二 90 级＋一个三级模组）${capText(byMaxed)}，按你当前养成状态的人均消耗${capText(byAverage)}${explain}。`;
            })()}</li>
            : null}
        </ul>
      </div> : null}
      {advice.production ? <div className="mt-4 border-t border-white/10 pt-4">
        <InfraTechnicalHeading icon={<Activity className="size-4" aria-hidden="true" />}>{en ? "Daily output" : "日产出"}</InfraTechnicalHeading>
        <ul className="mt-3 grid gap-2 text-sm leading-6 text-white/70">
          {advice.production.grade && (advice.production.capacityIndex ?? advice.production.lmdExpSum) !== null
            ? <li>{en
              ? `${advice.production.degraded ? "LMD+EXP sum (degraded, no gold data)" : "Capacity index"} ${adviceWan(advice.production.capacityIndex ?? advice.production.lmdExpSum!)} — ${advice.production.grade === "fail" ? "below par" : advice.production.grade === "pass" ? "adequate" : advice.production.grade}.`
              : `${advice.production.degraded ? "钱书和（缺贵金属数据，降级判读）" : "产能指数"} ${adviceWan(advice.production.capacityIndex ?? advice.production.lmdExpSum!)}，${advice.production.grade === "fail" ? "不及格" : advice.production.grade === "pass" ? "合格" : advice.production.grade === "good" ? "良好" : "优秀"}。`}</li>
            : null}
          {advice.production.dailyLmdIn !== null && advice.production.dailyExpIn !== null
            ? <li>{en ? `Daily inflow: LMD ${adviceWan(advice.production.dailyLmdIn)} and EXP ${adviceWan(advice.production.dailyExpIn)} (each incl. ~30K offline).` : `每日入账：龙门币 ${adviceWan(advice.production.dailyLmdIn)}、作战记录 ${adviceWan(advice.production.dailyExpIn)}（各含基建外约 3 万）。`}</li>
            : null}
          {advice.production.netGain !== null
            ? <li>{(() => {
              const hasGap = advice.stock !== null && (advice.stock.lmdShort !== null || advice.stock.expShort !== null);
              const tail = advice.production.coverDays !== null
                ? (en ? `; current gap closes in ~${Math.max(1, Math.round(advice.production.coverDays))} days` : `，当前缺口约 ${Math.max(1, Math.round(advice.production.coverDays))} 天补平`)
                : advice.production.netGain.amount < 0 && hasGap
                  ? (en ? "; the gap keeps widening" : "，缺口仍在逐日扩大")
                  : "";
              return en
                ? `Net ${advice.production.netGain.resource === "lmd" ? "LMD" : "EXP"} ${advice.production.netGain.amount >= 0 ? `gain ${adviceWan(advice.production.netGain.amount)}/day` : `deficit ${adviceWan(-advice.production.netGain.amount)}/day`} at the demand ratio${tail}.`
                : `按需求比折算，每日${advice.production.netGain.resource === "lmd" ? "龙门币" : "作战记录"}净${advice.production.netGain.amount >= 0 ? `补 ${adviceWan(advice.production.netGain.amount)}` : `亏 ${adviceWan(-advice.production.netGain.amount)}`}${tail}。`;
            })()}</li>
            : null}
          {advice.production.combinedRatio !== null
            ? <li>{en ? `Base LMD/EXP ratio ${ratio(advice.production.baseRatio)}; combined with offline income ${ratio(advice.production.combinedRatio)}; six-star development needs roughly 1.20–1.80.` : `基建日产钱书比 ${ratio(advice.production.baseRatio)}，考虑基建外获取的综合钱书比 ${ratio(advice.production.combinedRatio)}；六星练度需求参考 1.20~1.80。`}</li>
            : null}
          {advice.production.goldNetUnits !== null
            ? <li>{en
              ? `Gold ${advice.production.goldTone === "surplus" ? `surplus ${fmt(advice.production.goldNetUnits)}` : `deficit ${fmt(-advice.production.goldNetUnits)}`} bars/day${advice.production.goldEstimated ? "" : " (lower-bound estimate)"}${advice.production.goldRunwayDays !== null ? `; current stock runs out in ~${Math.max(1, Math.round(advice.production.goldRunwayDays))} days` : ""}${advice.production.goldTone === "deficit" ? "; add gold capacity" : "; raise trade-post usage"}.`
              : `赤金每日净${advice.production.goldTone === "surplus" ? `盈余 ${fmt(advice.production.goldNetUnits)}` : `亏空 ${fmt(-advice.production.goldNetUnits)}`} 根${advice.production.goldEstimated ? "" : "（下界口径）"}${advice.production.goldRunwayDays !== null ? `，当前库存约 ${Math.max(1, Math.round(advice.production.goldRunwayDays))} 天后耗尽` : ""}，${advice.production.goldTone === "deficit" ? "建议补赤金产能" : "可提高贸易用量"}。`}</li>
            : null}
        </ul>
      </div> : null}
      {advice.recommendation ? <div className="mt-4 border-t border-white/10 pt-4">
        <InfraTechnicalHeading icon={<ClipboardCheck className="size-4" aria-hidden="true" />}>{en ? "Recommendation" : "推荐建议"}</InfraTechnicalHeading>
        <p className="mt-3 text-sm font-medium leading-6 text-white/95">{advice.recommendation.headline}</p>
        <ul className="mt-2 grid gap-2 text-sm leading-6 text-white/70">
          {advice.recommendation.lines.map((line) => <li key={line}>{line}</li>)}
          <li>{en ? "Shifts: " : "换班方式："}{advice.recommendation.shifts.join(en ? " " : "；")}</li>
        </ul>
      </div> : null}
      {advice.notes.length ? <ul className="mt-4 grid gap-2 text-xs leading-5 text-white/60">
        {advice.notes.map((note) => <li key={note}>{note}</li>)}
      </ul> : null}
      <details className="mt-4 border-t border-white/10 pt-1 text-xs leading-5 text-white/60 md:pt-4">
        <summary className="min-h-11 cursor-pointer content-center select-none outline-none focus-visible:ring-2 focus-visible:ring-[#FFD800] md:min-h-0">{en ? "Capacity calculation rules" : "产能计算规则"}</summary>
        <div className="mt-2 grid gap-2">
          <p>{en ? "Capacity index = trade × 0.5 + gold × 0.8 + EXP × 1 + orundum × 66.67 + 4000; graded below 90K / 90–100K / 100–110K / 110K+." : "产能指数 ＝ 贸易×0.5 ＋ 赤金×0.8 ＋ 经验×1 ＋ 合成玉×66.67 ＋ 4000；分档：低于 9 万不及格、9~10 万合格、10~11 万良好、11 万以上优秀。"}</p>
          <p>{en ? "Without gold data, degraded grading uses LMD+EXP sum: below 70K / 70–80K / 80–95K / 95K+." : "缺贵金属数据时按钱书和 ＝ 贸易＋经验 降级判读：低于 7 万不及格、7~8 万及格、8~9.5 万良好、9.5 万以上优秀。"}</p>
          <p>{en ? "Offline daily income ≈ 30K LMD + 30K EXP; six-star cost ratios run 1.20–1.29 level-only and 1.47–1.80 with modules." : "基建外每日常驻约 3 万龙门币＋3 万经验；六星练度钱书需求比纯等级约 1.20~1.29、带模组约 1.47~1.80。"}</p>
          <p>{en ? "Sources: knowledge base skill-8 output diagnosis, LMD/EXP value ratios, layout selection, orundum grinding." : "规则出处：知识库《skill-8 产出数值诊断》《钱书价值与价值比例》《布局选择》《搓玉》。"}</p>
        </div>
      </details>
      </InfraTechnicalCard>
    </section>
  </section>;
}

function Metric({ label, value, note, emphasis }: { label: string; value: string; note?: ReactNode; emphasis?: boolean }) {
  return <div className="min-w-0"><dt className="text-xs leading-5 text-muted-foreground">{label}</dt><dd className={`mt-1 flex flex-wrap items-baseline gap-x-1.5 font-number text-lg leading-7 tabular-nums md:text-xl${emphasis ? " font-semibold" : ""}`}><span className="break-words">{value}</span>{note ? <span className="text-xs font-normal text-muted-foreground">{note}</span> : null}</dd></div>;
}
