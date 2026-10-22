"use client";
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
import { useLocale } from "use-intl";
import type { DisplayError, SklandInventoryData } from "@riic/arknights-domain/types";

const catalog: Record<string, { name?: string; icon?: string }> = {
  ...itemCatalog,
  classic_normal_ticket: { name: "通用凭证", icon: "/images/items/classic_normal_ticket.png" },
  classic_gacha: { name: "中坚寻访凭证", icon: "/images/items/classic_gacha.png" },
};
const fmt = (value: number) => value.toLocaleString("zh-CN");
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
  const storageKey = `${MANUAL_STORAGE_KEY}:${identityKey}`;
  const locale = useLocale();
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
      if (inventory.identityKey !== identityKey) throw new Error("账号或角色已变化，请刷新页面后重试。");
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
      .filter((item) => !normalized || (catalog[item.id]?.name ?? "").toLocaleLowerCase().includes(normalized));
  }, [data, query]);
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
      { title: "养成材料", names: Object.entries(MATERIAL_GROUPS).filter(([title]) => title.startsWith("稀有度")).flatMap(([, names]) => names) },
      { title: "模组芯片和技能书", names: [...MATERIAL_GROUPS["模组"], ...MATERIAL_GROUPS["芯片相关"], ...MATERIAL_GROUPS["技能书"]] },
    ];
    const groups = categories.map(({ title, names }) => {
      const grouped = [...candidates.values()].filter((item) => names.includes(catalog[item.id]?.name ?? ""))
        .sort((a, b) => names.indexOf(catalog[a.id]?.name ?? "") - names.indexOf(catalog[b.id]?.name ?? ""));
      grouped.forEach((item) => candidates.delete(item.id));
      return { title, items: grouped };
    });
    groups.push({ title: "其他", items: [...candidates.values()] });
    return groups;
  }, [items, itemCount]);
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
            <WorkbenchPageHeading page="inventory">{locale === "en" ? "Inventory" : "查看库存"}</WorkbenchPageHeading>
            <span className="whitespace-nowrap text-sm text-muted-foreground">共 {items.length} 项</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setEstimateOpen(true)} disabled={loading}><Calculator className="size-4" />资源估算</Button>
            <Button variant="outline" onClick={() => void load()} disabled={loading} aria-label="刷新库存"><RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />刷新</Button>
            <Button nativeButton={false} variant="outline" size="icon" render={<Link to="/" />} aria-label="返回基建终端"><ArrowLeft /></Button>
          </div>
        </header>

        <section className="w-full min-w-0">
          <div className="relative max-w-md"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索物品名称" className="h-9 pl-9" aria-label="搜索库存" /></div>
          {error ? <div className="mt-5 border border-amber-400/40 bg-amber-50/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-200">{error.message || "库存读取失败，请稍后重试。"} 手工填写仍可用于估算；未读取的数量按 0 处理。</div> : null}
          {!error && loading ? <div className="py-16 text-center text-sm text-muted-foreground">正在读取森空岛库存...</div> : null}
          {!loading ? <>
            <div className="mt-5 grid gap-6">
              <div className="min-w-0">
              <h3 className="mb-3 border-b border-border pb-3 text-lg font-semibold">抽卡资源</h3>
              <p role="status" className={`mb-3 text-xs leading-5 ${manualSaveState === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                {manualSaveState === "error"
                  ? (locale === "en" ? "Could not save to this browser. Your edits are available on this page only; allow browser storage and edit again to retry." : "浏览器保存失败，修改仅在当前页面有效；请允许浏览器存储后重新填写。")
                  : manualSaveState === "saved"
                    ? (locale === "en" ? "Manual amounts saved to this browser for the current account and character. They remain after a refresh." : "手填数量已保存到此浏览器，按当前账号和角色分别保留，刷新后仍有效。")
                    : (locale === "en" ? "Manual amounts are automatically saved to this browser for each account and character." : "手填数量会自动保存到此浏览器，按账号和角色分别保留。")}
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {commonItems.map((item) => {
                  const catalogItem = catalog[item.id];
                  return <div key={item.id} className="flex min-h-[74px] items-center gap-2 rounded-md px-3 py-2 transition-colors hover:bg-muted/40">
                    <div className="grid size-10 shrink-0 place-items-center rounded-full bg-muted/30">
                      {catalogItem?.icon ? <img src={catalogItem.icon} alt="" width={44} height={44} className="size-10 object-contain" /> : <PackageOpen className="size-5 text-muted-foreground" aria-hidden="true" />}
                    </div>
                    <div className="min-w-0 flex-1 text-sm">
                      <span className="block break-words">{catalogItem?.name ?? "未知物品"}</span>
                    {MANUAL_RESOURCE_IDS.includes(item.id) || !apiCountById.has(item.id) ? <Input
                      inputMode="numeric"
                      value={manualCounts[item.id] ?? ""}
                      onChange={(event) => setManualCount(item.id, event.target.value)}
                      placeholder={apiCountById.has(item.id) ? String(apiCountById.get(item.id)) : "填写数量"}
                      aria-label={`填写${catalogItem?.name ?? "资源"}数量`}
                      className="mt-1 h-9 w-full min-w-0 px-2 font-number text-xs"
                    /> : <span className="mt-1 block text-xs text-muted-foreground">拥有：{fmt(item.count)}</span>}
                    </div>
                  </div>;
                })}
              </div>
              </div>
              <div className="min-w-0">
                <h3 className="mb-3 border-b border-border pb-3 text-lg font-semibold">钱书资源</h3>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                  {experienceItems.map((item) => {
                    const catalogItem = catalog[item.id];
                    return <div key={item.id} className="flex min-h-[74px] items-center gap-2 rounded-md px-3 py-2 transition-colors hover:bg-muted/40">
                      <div className="grid size-10 shrink-0 place-items-center rounded-full bg-muted/30">
                        {catalogItem?.icon ? <img src={catalogItem.icon} alt="" width={44} height={44} className="size-10 object-contain" /> : <PackageOpen className="size-5 text-muted-foreground" aria-hidden="true" />}
                      </div>
                      <div className="min-w-0 flex-1 text-sm">
                        <span className="block break-words">{catalogItem?.name ?? "未知物品"}</span>
                        {item.id === "4001" && !apiCountById.has(item.id) ? <Input
                          inputMode="numeric"
                          value={manualCounts[item.id] ?? ""}
                          onChange={(event) => setManualCount(item.id, event.target.value)}
                          placeholder="填写数量"
                          aria-label="填写龙门币数量"
                          className="mt-1 h-9 w-full min-w-0 px-2 font-number text-xs"
                        /> : <span className="mt-1 block text-xs text-muted-foreground">拥有：{fmt(item.count)}</span>}
                      </div>
                    </div>;
                  })}
                </div>
              </div>
            <Dialog open={estimateOpen} onOpenChange={setEstimateOpen}>
              <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-[min(800px,calc(100vw-2rem))]">
                <DialogHeader><DialogTitle>资源估算</DialogTitle></DialogHeader>
                <DialogBody className="min-h-0 overflow-y-auto pb-6">
            <section className="grid min-w-0 auto-rows-fr sm:grid-cols-2">
              <div className="grid min-w-0 grid-rows-[24px_44px_56px_1fr_36px] gap-3 pb-5 sm:pb-0 sm:pr-6">
                <h3 className="text-base font-semibold">寻访估算</h3>
                <p className="flex items-center text-sm text-muted-foreground">当前资源可用寻访</p>
                <p className="font-number text-4xl font-semibold leading-[56px]"><span className="text-[#FFD501]">{fmt(pullSummary.totalPulls)}</span> <span className="text-xl">抽</span></p>
              <div className="grid content-start gap-3 border-t border-border/70 pt-3 text-xs text-muted-foreground">
                <p className="flex justify-between gap-3"><span>源石与合成玉</span><strong className="font-number text-foreground">{fmt(pullSummary.currencyPulls)} 抽</strong></p>
                <p className="flex justify-between gap-3"><span>寻访凭证</span><strong className="font-number text-foreground">{fmt(pullSummary.ticketPulls)} 抽</strong></p>
                <Tooltip>
                  <TooltipTrigger
                    render={<p className="flex cursor-help justify-between gap-3 border-b border-dashed border-muted-foreground/50" />}
                  >
                    <span>黄票阶梯兑换</span><strong className="font-number text-foreground">{fmt(exchange.pulls)} 抽</strong>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="w-72 p-3">
                    <p className="mb-2 text-xs font-semibold">黄票兑换规则</p>
                    <div className="grid gap-1 text-xs">
                      {HEADHUNTING_STEPS.map((step) => <p key={step.tier} className="flex justify-between gap-3">
                        <span>{step.content}</span><span className="font-number">累计 {step.cost} 黄票 · {step.pulls} 抽</span>
                      </p>)}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </div>
                <p className="text-xs leading-[18px] text-muted-foreground">另余 {fmt(pullSummary.remainingOrundum)} 合成玉。假设源石全部兑换、当月黄票兑换尚未购买；不含中坚票。</p>
              </div>
              <div className="grid min-w-0 grid-rows-[24px_44px_56px_1fr_36px] gap-3 border-t border-border/70 pt-5 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
                <h3 className="text-base font-semibold">养成估算</h3>
                <div className="grid grid-cols-3 items-center gap-2">
                  <FilterSelect value={targetRarity} onValueChange={(value) => { const rarity = Number(value); setTargetRarity(rarity); const elite = Math.min(targetElite, maxEliteForRarity(rarity)); setTargetElite(elite); setTargetLevel(Math.min(targetLevel, manualLevelFor(rarity, elite))); }} className="h-11" aria-label="目标星级"
                    options={[3, 4, 5, 6].map(rarity => ({ value: rarity, label: `${rarity}★` }))} />
                  <FilterSelect value={targetElite} onValueChange={(value) => { const elite = Number(value); setTargetElite(elite); setTargetLevel(Math.min(targetLevel, manualLevelFor(targetRarity, elite))); }} className="h-11" aria-label="目标精英阶段"
                    options={[0, 1, 2].filter(elite => targetRarity >= (elite === 2 ? 4 : 3)).map(elite => ({ value: elite, label: `精${elite}` }))} />
                  <FilterSelect value={targetLevel} onValueChange={value => setTargetLevel(Number(value))} className="h-11" aria-label="目标等级"
                    options={Array.from({ length: manualLevelFor(targetRarity, targetElite) }, (_, index) => ({ value: index + 1, label: `${index + 1}级` }))} />
                </div>
                <p className="font-number text-4xl font-semibold leading-[56px]"><span className="text-[#FFD501]">{sixStarSummary.count.toFixed(2)}</span> <span className="text-xl">个</span></p>
                <div className="grid content-start gap-3 border-t border-border/70 pt-3 text-xs text-muted-foreground [&_p]:flex-wrap [&_strong]:break-all">
                  <p className="flex justify-between gap-3"><span>龙门币</span><strong className="font-number text-foreground">{fmt(itemCount("4001"))} / {fmt(sixStarSummary.targetCost.lmd)}</strong></p>
                  <p className="flex justify-between gap-3"><span>作战记录经验</span><strong className="font-number text-foreground">{fmt(sixStarSummary.exp)} / {fmt(sixStarSummary.targetCost.exp)}</strong></p>
                </div>
                <p className="text-xs leading-[18px] text-muted-foreground">从精0 1级开始，仅计算升级与精英化的钱书；不包含材料、技能、模组。</p>
              </div>
            </section>
                </DialogBody>
              </DialogContent>
            </Dialog>
            </div>
            {materialGroups.map((group) => <section key={group.title} className="mt-6">
              <h3 className="mb-3 border-b border-border pb-3 text-lg font-semibold">{group.title}</h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                {group.items.map((item) => {
                  const catalogItem = catalog[item.id];
                  return <div key={item.id} className="flex min-h-[74px] items-center gap-2 rounded-md px-3 py-2 transition-colors hover:bg-muted/40">
                    <div className="grid size-10 shrink-0 place-items-center rounded-full bg-muted/30">
                      {catalogItem?.icon ? <img src={catalogItem.icon} alt="" width={44} height={44} className="size-10 object-contain" /> : <PackageOpen className="size-5 text-muted-foreground" aria-hidden="true" />}
                    </div>
                    <div className="min-w-0 flex-1 text-sm leading-5"><span className="block break-words">{catalogItem?.name ?? "未知物品"}</span>
                      {MANUAL_RESOURCE_IDS.includes(item.id) ? <Input inputMode="numeric" value={manualCounts[item.id] ?? ""} onChange={(event) => setManualCount(item.id, event.target.value)} placeholder={String(apiCountById.get(item.id) ?? 0)} aria-label={`填写${catalogItem?.name ?? "资源"}数量`} className="mt-1 h-9 w-full min-w-0 px-2 font-number text-xs" /> : <span className="mt-1 block text-xs text-muted-foreground">拥有：{fmt(item.count)}</span>}
                    </div>
                  </div>;
                })}
              </div>
            </section>)}
            {items.length === 0 ? <div className="py-16 text-center text-sm text-muted-foreground">没有匹配的库存物品。</div> : null}
          </> : null}
          {data ? <p className="mt-5 text-xs text-muted-foreground">读取时间：{new Date(data.fetchedAt).toLocaleString()}</p> : null}
        </section>
      </div>
    </main>
  );
}
