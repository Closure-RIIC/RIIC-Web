"use client";
import { useLocale as useRawLocale } from "use-intl";
import { createLocalizer as createRawLocalizer, richValue } from "@riic/arknights-domain/i18n/localize";
import type RawMessages from "../../../messages/zh-CN/AK_Raw_components_pages_InventoryPage.json";
const rawText = createRawLocalizer<typeof RawMessages>("AK_Raw_components_pages_InventoryPage");


import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../../messages/zh-CN/AK_components_pages_InventoryPage.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_components_pages_InventoryPage");

import { FilterSelect } from "@riic/ui-primitives/filter-select";
import { WorkbenchPageHeading } from "@/components/workbench/WorkbenchPageHeading";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Calculator, PackageOpen, RefreshCw, Search } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { useWorkbench } from "@/workbench-context";
import { trainingCost } from "@/inventory-estimates";
import { estimateHeadhuntPulls, HEADHUNTING_STEPS, yellowCertificateExchange } from "@/headhunt-estimate";
import { manualLevelFor, maxEliteForRarity } from "@riic/arknights-domain/manual-operbox";
import { getSklandInventory } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import itemCatalog from "@/generated/item-catalog.json";
import { useLocale, useTranslations } from "use-intl";
import { useGameCatalog } from "@/i18n/game-data-client";
import type { DisplayError, SklandInventoryData } from "@riic/arknights-domain/types";

const catalog: Record<string, { name?: string; icon?: string }> = {
  ...itemCatalog,
  classic_normal_ticket: { name: "通用凭证", icon: "/images/items/classic_normal_ticket.png" },
  classic_gacha: { name: "中坚寻访凭证", icon: "/images/items/classic_gacha.png" },
};
const BATTLE_RECORD_IDS = new Set(["2001", "2002", "2003", "2004"]);
const COMMON_IDS = ["4002", "4003", "4001", "4004", "4005", "7004", "7003", "7001", "3141", "3003", "classic_normal_ticket", "classic_gacha"];
const MANUAL_RESOURCE_IDS = ["4002", "4003", "4004", "4005", "7004", "7003", "7001", "classic_normal_ticket", "classic_gacha"];
const MANUAL_STORAGE_KEY = "aic-skland-inventory-manual-resources-v1";
const BATTLE_RECORD_EXP = { "2001": 200, "2002": 400, "2003": 1_000, "2004": 2_000 } as const;
// Categories from ArkMowers/arknights-mower arknights_mower/utils/depot.py; 液化/电极线材料为本地补充，上游暂未收录。
const MATERIAL_GROUPS: Record<string, string[]> = {"稀有度5":["烧结核凝晶","晶体电子单元","D32钢","双极纳米片","聚合剂","重相位对映体"],"稀有度4":["提纯源岩","改量装置","聚酸酯块","糖聚块","异铁块","酮阵列","转质盐聚块","切削原液","精炼溶剂","晶体电路","炽合金块","聚合凝胶","白马醇","三水锰矿","五水研磨石","RMA70-24","环烃预制体","固化纤维板","手性屈光体","液化醚吸聚体","聚能动力单元"],"稀有度3":["固源岩组","全新装置","聚酸酯组","糖组","异铁组","酮凝集组","转质盐组","化合切削液","半自然溶剂","晶体元件","炽合金","凝胶","扭转醇","轻锰矿","研磨石","RMA70-12","环烃聚质","褐素纤维","类凝结核","液化高能气体","电极单元"],"稀有度2":["固源岩","装置","聚酸酯","糖","异铁","酮凝集"],"稀有度1":["源岩","破损装置","酯原料","代糖","异铁碎片","双酮"],"模组":["模组数据块","数据增补仪","数据增补条"],"技能书":["技巧概要·卷3","技巧概要·卷2","技巧概要·卷1"],"芯片相关":["重装双芯片","重装芯片组","重装芯片","狙击双芯片","狙击芯片组","狙击芯片","医疗双芯片","医疗芯片组","医疗芯片","术师双芯片","术师芯片组","术师芯片","先锋双芯片","先锋芯片组","先锋芯片","近卫双芯片","近卫芯片组","近卫芯片","辅助双芯片","辅助芯片组","辅助芯片","特种双芯片","特种芯片组","特种芯片","采购凭证","芯片助剂"]};

export default function InventoryPage() {
  const { inventory } = useWorkbench();
  if (inventory.pending) return null;
  return <InventoryContent key={inventory.identityKey} identityKey={inventory.identityKey} />;
}

function InventoryContent({ identityKey }: { identityKey: string }) {
  const rawLocale = useRawLocale();
  const storageKey = `${MANUAL_STORAGE_KEY}:${identityKey}`;
  const locale = useLocale();
  const inventoryText = useTranslations("InventoryLabels");
  const gameCatalog = useGameCatalog();
  const fmt = (value: number) => value.toLocaleString(locale);
  const itemName = (id: string) => gameCatalog.itemNames[id] ?? catalog[id]?.name ?? rawText.text(locale, "unknownItem");
  const [data, setData] = useState<SklandInventoryData | null>(null);
  const [query, setQuery] = useState("");
  const [estimateOpen, setEstimateOpen] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);
  const [loading, setLoading] = useState(true);
  const [manualCounts, setManualCounts] = useState<Record<string, string>>({});
  const [manualSaveState, setManualSaveState] = useState<"idle" | "saved" | "error">("idle");
  const [targetRarity, setTargetRarity] = useState(6);
  const [targetElite, setTargetElite] = useState(2);
  const [targetLevel, setTargetLevel] = useState(60);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const inventory = await getSklandInventory();
      if (inventory.identityKey !== identityKey) throw new Error("@inventory:identityChanged");
      setData(inventory);
      setError(null);
    } catch (value) {
      setData(null);
      setError(value as DisplayError);
    } finally {
      setLoading(false);
    }
  }, [identityKey]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}") as Record<string, unknown>;
      const next: Record<string, string> = {};
      for (const id of COMMON_IDS) {
        const value = parsed[id];
        if (typeof value === "string" && /^\d*$/.test(value)) next[id] = value;
      }
      setManualCounts(next);
      setManualSaveState(Object.keys(next).length > 0 ? "saved" : "idle");
    } catch {
      setManualCounts({});
    }
  }, [storageKey]);

  const setManualCount = (id: string, value: string) => {
    const normalized = value.replace(/\D/g, "").slice(0, 12);
    const next = { ...manualCounts, [id]: normalized };
    setManualCounts(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      setManualSaveState("saved");
    } catch {
      setManualSaveState("error");
    }
  };

  const items = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return (data?.items ?? [])
      .filter((item) => /^\d+$/.test(item.id))
      .filter((item) => !normalized || [catalog[item.id]?.name, gameCatalog.itemNames[item.id]].some(name => name?.toLocaleLowerCase().includes(normalized)));
  }, [data, query, gameCatalog]);
  const apiCountById = useMemo(() => new Map((data?.items ?? []).map((item) => [item.id, item.count])), [data]);
  const manualValue = useCallback((id: string) => {
    const raw = manualCounts[id]?.trim();
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
  }, [manualCounts]);
  const itemCount = useCallback((id: string) => manualValue(id) ?? apiCountById.get(id) ?? 0, [apiCountById, manualValue]);
  const commonItems = ["4002", "4003", "4004", "classic_normal_ticket", "7004", "7003", "classic_gacha", "3141"]
    .map((id) => ({ id, count: itemCount(id) }));
  const experienceItems = ["4001", ...BATTLE_RECORD_IDS, "3003"]
    .map((id) => ({ id, count: itemCount(id) }));
  const materialGroups = useMemo(() => {
    const excluded = new Set(["4002", "4003", "4004", "7004", "7003", "3141", "4001", ...BATTLE_RECORD_IDS, "3003"]);
    const candidates = new Map(items.filter((item) => !excluded.has(item.id)).map((item) => [item.id, item]));
    for (const id of ["4005", "7001"]) candidates.set(id, { id, count: itemCount(id) });
    const categories = [
      { id: "materials", title: inventoryText("materials"), names: Object.entries(MATERIAL_GROUPS).filter(([title]) => title.startsWith("稀有度")).flatMap(([, names]) => names) },
      { id: "upgrades", title: inventoryText("upgrades"), names: [...MATERIAL_GROUPS["模组"], ...MATERIAL_GROUPS["芯片相关"], ...MATERIAL_GROUPS["技能书"]] },
    ];
    const groups = categories.map(({ id, title, names }) => {
      const grouped = [...candidates.values()].filter((item) => names.includes(catalog[item.id]?.name ?? ""))
        .sort((a, b) => names.indexOf(catalog[a.id]?.name ?? "") - names.indexOf(catalog[b.id]?.name ?? ""));
      grouped.forEach((item) => candidates.delete(item.id));
      return { id, title, items: grouped };
    });
    groups.push({ id: "other", title: inventoryText("other"), items: [...candidates.values()] });
    return groups;
  }, [items, itemCount, inventoryText]);
  const yellowCerts = manualValue("4004") ?? apiCountById.get("4004") ?? 0;
  const exchange = useMemo(() => yellowCertificateExchange(yellowCerts), [yellowCerts]);
  const pullSummary = useMemo(() => estimateHeadhuntPulls({
    originium: itemCount("4002"),
    orundum: itemCount("4003"),
    singleTickets: itemCount("7003"),
    tenPullTickets: itemCount("7004"),
    yellowCertificates: yellowCerts,
  }), [itemCount, yellowCerts]);
  const sixStarSummary = useMemo(() => {
    const targetCost = trainingCost(targetRarity, targetElite, targetLevel);
    const lmdCount = targetCost.lmd === 0 ? 0 : itemCount("4001") / targetCost.lmd;
    const exp = (Object.entries(BATTLE_RECORD_EXP) as Array<[keyof typeof BATTLE_RECORD_EXP, number]>).reduce(
      (total, [id, value]) => total + itemCount(id) * value,
      0,
    );
    return {
      count: targetCost.exp === 0 ? 0 : Math.min(lmdCount, exp / targetCost.exp),
      exp,
      lmdCount,
      targetCost,
    };
  }, [itemCount, targetElite, targetLevel, targetRarity]);
  return (
    <main className="w-full min-w-0 bg-background text-foreground">
      <div className="flex w-full min-w-0 flex-col gap-5 pb-8 pt-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <WorkbenchPageHeading page="inventory">{uiText.text(locale, "inventory")}</WorkbenchPageHeading>
            <span className="whitespace-nowrap text-sm text-muted-foreground">{rawText.rich(rawLocale, "items", { part1: richValue((items.length)) })}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setEstimateOpen(true)} disabled={loading}>{rawText.rich(rawLocale, "resourceEstimate", { part1: richValue((<Calculator className="size-4" />)) })}</Button>
            <Button variant="outline" onClick={() => void load()} disabled={loading} aria-label={rawText.text(rawLocale, "refreshInventory")}>{rawText.rich(rawLocale, "refresh", { part1: richValue((<RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />)) })}</Button>
            <Button nativeButton={false} variant="outline" size="icon" render={<Link to="/" />} aria-label={rawText.text(rawLocale, "backToBaseTerminal")}><ArrowLeft /></Button>
          </div>
        </header>

        <section className="w-full min-w-0">
          <div className="relative max-w-md"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={rawText.text(rawLocale, "searchItemNames")} className="h-9 pl-9" aria-label={rawText.text(rawLocale, "searchInventory")} /></div>
          {error ? <div className="mt-5 border border-amber-400/40 bg-amber-50/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-200">{rawText.rich(rawLocale, "manualEntriesCanStillBeUsedForEstimatesUnavailable", { part1: richValue((error.message === "@inventory:identityChanged" ? rawText.text(rawLocale, "identityChanged") : error.message || inventoryText("loadFailed"))) })}</div> : null}
          {!error && loading ? <div className="py-16 text-center text-sm text-muted-foreground">{rawText.text(rawLocale, "loadingSklandInventory")}</div> : null}
          {!loading ? <>
            <div className="mt-5 grid gap-6">
              <div className="min-w-0">
              <h3 className="mb-3 border-b border-border pb-3 text-lg font-semibold">{rawText.text(rawLocale, "headhuntingResources")}</h3>
              <p role="status" className={`mb-3 text-xs leading-5 ${manualSaveState === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                {manualSaveState === "error"
                  ? (uiText.text(locale, "couldNotSaveToThisBrowserYourEdits"))
                  : manualSaveState === "saved"
                    ? (uiText.text(locale, "manualAmountsSavedToThisBrowserForThe"))
                    : (uiText.text(locale, "manualAmountsAreAutomaticallySavedToThisBrowser"))}
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {commonItems.map((item) => {
                  const catalogItem = catalog[item.id];
                  return <div key={item.id} className="flex min-h-[74px] items-center gap-2 rounded-md px-3 py-2 transition-colors hover:bg-muted/40">
                    <div className="grid size-10 shrink-0 place-items-center rounded-full bg-muted/30">
                      {catalogItem?.icon ? <img src={catalogItem.icon} alt="" width={44} height={44} className="size-10 object-contain" /> : <PackageOpen className="size-5 text-muted-foreground" aria-hidden="true" />}
                    </div>
                    <div className="min-w-0 flex-1 text-sm">
                      <span className="block break-words">{itemName(item.id)}</span>
                    {MANUAL_RESOURCE_IDS.includes(item.id) || !apiCountById.has(item.id) ? <Input
                      inputMode="numeric"
                      value={manualCounts[item.id] ?? ""}
                      onChange={(event) => setManualCount(item.id, event.target.value)}
                      placeholder={apiCountById.has(item.id) ? String(apiCountById.get(item.id)) : rawText.text(locale, "enterQuantity")}
                      aria-label={inventoryText("quantityFor", { name: itemName(item.id) })}
                      className="mt-1 h-9 w-full min-w-0 px-2 font-number text-xs"
                    /> : <span className="mt-1 block text-xs text-muted-foreground">{rawText.rich(rawLocale, "owned", { part1: richValue((fmt(item.count))) })}</span>}
                    </div>
                  </div>;
                })}
              </div>
              </div>
              <div className="min-w-0">
                <h3 className="mb-3 border-b border-border pb-3 text-lg font-semibold">{rawText.text(rawLocale, "lmdAndExpResources")}</h3>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                  {experienceItems.map((item) => {
                    const catalogItem = catalog[item.id];
                    return <div key={item.id} className="flex min-h-[74px] items-center gap-2 rounded-md px-3 py-2 transition-colors hover:bg-muted/40">
                      <div className="grid size-10 shrink-0 place-items-center rounded-full bg-muted/30">
                        {catalogItem?.icon ? <img src={catalogItem.icon} alt="" width={44} height={44} className="size-10 object-contain" /> : <PackageOpen className="size-5 text-muted-foreground" aria-hidden="true" />}
                      </div>
                      <div className="min-w-0 flex-1 text-sm">
                        <span className="block break-words">{itemName(item.id)}</span>
                        {item.id === "4001" && !apiCountById.has(item.id) ? <Input
                          inputMode="numeric"
                          value={manualCounts[item.id] ?? ""}
                          onChange={(event) => setManualCount(item.id, event.target.value)}
                          placeholder={rawText.text(rawLocale, "enterQuantity")}
                          aria-label={rawText.text(rawLocale, "enterLmdAmount")}
                          className="mt-1 h-9 w-full min-w-0 px-2 font-number text-xs"
                        /> : <span className="mt-1 block text-xs text-muted-foreground">{rawText.rich(rawLocale, "owned", { part1: richValue((fmt(item.count))) })}</span>}
                      </div>
                    </div>;
                  })}
                </div>
              </div>
            <Dialog open={estimateOpen} onOpenChange={setEstimateOpen}>
              <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-[min(800px,calc(100vw-2rem))]">
                <DialogHeader><DialogTitle>{rawText.text(rawLocale, "resourceEstimate2")}</DialogTitle></DialogHeader>
                <DialogBody className="min-h-0 overflow-y-auto pb-6">
            <section className="grid min-w-0 auto-rows-fr sm:grid-cols-2">
              <div className="grid min-w-0 grid-rows-[24px_44px_56px_1fr_36px] gap-3 pb-5 sm:pb-0 sm:pr-6">
                <h3 className="text-base font-semibold">{rawText.text(rawLocale, "headhuntingEstimate")}</h3>
                <p className="flex items-center text-sm text-muted-foreground">{rawText.text(rawLocale, "pullsAvailableFromCurrentResources")}</p>
                <p className="font-number text-4xl font-semibold leading-[56px]"><span className="text-[#FFD501]">{fmt(pullSummary.totalPulls)}</span> <span className="text-xl">{rawText.text(rawLocale, "pulls")}</span></p>
              <div className="grid content-start gap-3 border-t border-border/70 pt-3 text-xs text-muted-foreground">
                <p className="flex justify-between gap-3"><span>{rawText.text(rawLocale, "originitePrimeAndOrundum")}</span><strong className="font-number text-foreground">{rawText.rich(rawLocale, "pulls2", { part1: richValue((fmt(pullSummary.currencyPulls))) })}</strong></p>
                <p className="flex justify-between gap-3"><span>{rawText.text(rawLocale, "headhuntingPermits")}</span><strong className="font-number text-foreground">{rawText.rich(rawLocale, "pulls2", { part1: richValue((fmt(pullSummary.ticketPulls))) })}</strong></p>
                <Tooltip>
                  <TooltipTrigger
                    render={<p className="flex cursor-help justify-between gap-3 border-b border-dashed border-muted-foreground/50" />}
                  >
                    <span>{rawText.text(rawLocale, "distinctionExchangeTiers")}</span><strong className="font-number text-foreground">{rawText.rich(rawLocale, "pulls2", { part1: richValue((fmt(exchange.pulls))) })}</strong>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="w-72 p-3">
                    <p className="mb-2 text-xs font-semibold">{rawText.text(rawLocale, "distinctionExchangeRules")}</p>
                    <div className="grid gap-1 text-xs">
                      {HEADHUNTING_STEPS.map((step) => <p key={step.tier} className="flex justify-between gap-3">
                        <span>{inventoryText("permits", { count: step.pulls })}</span><span className="font-number">{rawText.rich(rawLocale, "totalDistinctionsPulls", { part1: richValue((step.cost)), part2: richValue((step.pulls)) })}</span>
                      </p>)}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </div>
                <p className="text-xs leading-[18px] text-muted-foreground">{rawText.rich(rawLocale, "orundumRemainingAssumesAllOriginitePrimeIsConvertedAnd", { part1: richValue((fmt(pullSummary.remainingOrundum))) })}</p>
              </div>
              <div className="grid min-w-0 grid-rows-[24px_44px_56px_1fr_36px] gap-3 border-t border-border/70 pt-5 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
                <h3 className="text-base font-semibold">{rawText.text(rawLocale, "trainingEstimate")}</h3>
                <div className="grid grid-cols-3 items-center gap-2">
                  <FilterSelect value={targetRarity} onValueChange={(value) => { const rarity = Number(value); setTargetRarity(rarity); const elite = Math.min(targetElite, maxEliteForRarity(rarity)); setTargetElite(elite); setTargetLevel(Math.min(targetLevel, manualLevelFor(rarity, elite))); }} className="h-11" aria-label={rawText.text(rawLocale, "targetRarity")}
                    options={[3, 4, 5, 6].map(rarity => ({ value: rarity, label: `${rarity}★` }))} />
                  <FilterSelect value={targetElite} onValueChange={(value) => { const elite = Number(value); setTargetElite(elite); setTargetLevel(Math.min(targetLevel, manualLevelFor(targetRarity, elite))); }} className="h-11" aria-label={rawText.text(rawLocale, "targetEliteStage")}
                    options={[0, 1, 2].filter(elite => targetRarity >= (elite === 2 ? 4 : 3)).map(elite => ({ value: elite, label: inventoryText("elite", { level: elite }) }))} />
                  <FilterSelect value={targetLevel} onValueChange={value => setTargetLevel(Number(value))} className="h-11" aria-label={rawText.text(rawLocale, "targetLevel")}
                    options={Array.from({ length: manualLevelFor(targetRarity, targetElite) }, (_, index) => ({ value: index + 1, label: inventoryText("level", { level: index + 1 }) }))} />
                </div>
                <p className="font-number text-4xl font-semibold leading-[56px]"><span className="text-[#FFD501]">{sixStarSummary.count.toFixed(2)}</span> <span className="text-xl">{rawText.text(rawLocale, "units")}</span></p>
                <div className="grid content-start gap-3 border-t border-border/70 pt-3 text-xs text-muted-foreground [&_p]:flex-wrap [&_strong]:break-all">
                  <p className="flex justify-between gap-3"><span>{rawText.text(rawLocale, "lmd")}</span><strong className="font-number text-foreground">{fmt(itemCount("4001"))} / {fmt(sixStarSummary.targetCost.lmd)}</strong></p>
                  <p className="flex justify-between gap-3"><span>{rawText.text(rawLocale, "exp")}</span><strong className="font-number text-foreground">{fmt(sixStarSummary.exp)} / {fmt(sixStarSummary.targetCost.exp)}</strong></p>
                </div>
                <p className="text-xs leading-[18px] text-muted-foreground">{rawText.text(rawLocale, "startsAtE0Lv1AndCountsOnlyLmd")}</p>
              </div>
            </section>
                </DialogBody>
              </DialogContent>
            </Dialog>
            </div>
            {materialGroups.map((group) => <section key={group.id} className="mt-6">
              <h3 className="mb-3 border-b border-border pb-3 text-lg font-semibold">{group.title}</h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                {group.items.map((item) => {
                  const catalogItem = catalog[item.id];
                  return <div key={item.id} className="flex min-h-[74px] items-center gap-2 rounded-md px-3 py-2 transition-colors hover:bg-muted/40">
                    <div className="grid size-10 shrink-0 place-items-center rounded-full bg-muted/30">
                      {catalogItem?.icon ? <img src={catalogItem.icon} alt="" width={44} height={44} className="size-10 object-contain" /> : <PackageOpen className="size-5 text-muted-foreground" aria-hidden="true" />}
                    </div>
                    <div className="min-w-0 flex-1 text-sm leading-5"><span className="block break-words">{itemName(item.id)}</span>
                      {MANUAL_RESOURCE_IDS.includes(item.id) ? <Input inputMode="numeric" value={manualCounts[item.id] ?? ""} onChange={(event) => setManualCount(item.id, event.target.value)} placeholder={String(apiCountById.get(item.id) ?? 0)} aria-label={inventoryText("quantityFor", { name: itemName(item.id) })} className="mt-1 h-9 w-full min-w-0 px-2 font-number text-xs" /> : <span className="mt-1 block text-xs text-muted-foreground">{rawText.rich(rawLocale, "owned", { part1: richValue((fmt(item.count))) })}</span>}
                    </div>
                  </div>;
                })}
              </div>
            </section>)}
            {items.length === 0 ? <div className="py-16 text-center text-sm text-muted-foreground">{rawText.text(rawLocale, "noMatchingInventoryItems")}</div> : null}
          </> : null}
          {data ? <p className="mt-5 text-xs text-muted-foreground">{rawText.rich(rawLocale, "retrieved", { part1: richValue((new Date(data.fetchedAt).toLocaleString(locale))) })}</p> : null}
        </section>
      </div>
    </main>
  );
}
