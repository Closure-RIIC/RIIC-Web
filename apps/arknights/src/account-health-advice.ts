import type { AppLocale } from "@riic/contracts/locale";
import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../messages/zh-CN/AK_account_health_advice.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_account_health_advice");
import { MODULE_LMD, type AccountHealthInput } from "./account-health-input.ts";
import type { HealthDemand } from "./account-health-demand.ts";
import { formatScaledAmount } from "./resource-scale-display.ts";
import { trainingCost } from "./inventory-estimates.ts";

export type AdviceLocale = AppLocale;

export interface AdviceStockSection {
  lmd: number;
  experience: number;
  goldUnits: number;
  /** 库存缺口按哪个需求比估算：含模组优先，缺模组数据时退回纯等级比。 */
  demandRatio: number | null;
  ratioKind: "modules" | "level" | null;
  lmdShort: number | null;
  expShort: number | null;
  goldSurplus: "large" | "clear" | null;
  /** 现有库存可培养的六星数（钱、书取短板）：按当前养成的六星人均消耗与拉满＋三级模组口径。 */
  sixStarCapacity: { byAverage: number | null; byMaxed: number } | null;
}

export interface AdviceProductionSection {
  capacityIndex: number | null;
  grade: "fail" | "pass" | "good" | "excellent" | null;
  /** 缺贵金属数据时按钱书和分档（skill-8 降级模式）。 */
  degraded: boolean;
  lmdExpSum: number | null;
  dailyLmdIn: number | null;
  dailyExpIn: number | null;
  netGain: { resource: "lmd" | "experience"; amount: number } | null;
  coverDays: number | null;
  baseRatio: number | null;
  combinedRatio: number | null;
  goldNetUnits: number | null;
  /** false 为净增下界口径，true 为含特殊订单等效赤金的估计口径。 */
  goldEstimated: boolean;
  goldTone: "surplus" | "deficit" | null;
  /** 赤金净亏空时，当前库存可支撑的天数。 */
  goldRunwayDays: number | null;
}

export interface AdviceRecommendation {
  layout: string;
  headline: string;
  lines: string[];
  shifts: string[];
}

export interface HealthAdviceReport {
  summary: string;
  stock: AdviceStockSection | null;
  production: AdviceProductionSection | null;
  recommendation: AdviceRecommendation | null;
  notes: string[];
}

/** 严重缺口阈值：差额达到百万级视为需要专门布局补足。 */
const SEVERE_SHORT = 1_000_000;
/** 赤金成百根积累视为盈余，上千根视为大量盈余。 */
const GOLD_SURPLUS_UNITS = 100;
const GOLD_LARGE_SURPLUS_UNITS = 1_000;
/** 基建外每日常驻获取（知识库《产出常数表》·跨资源换算）。 */
export const OFFLINE_DAILY_LMD = 30_000;
export const OFFLINE_DAILY_EXP = 30_000;

const DURIN_GROUP = new Set(["char_4055_bgsnow", "char_478_kirara", "char_402_tuye"]);
const DURIN_NAMES = new Set(["鸿雪", "绮良", "图耶"]);

/** 鸿雪杜林组需三人齐备（鸿雪＋绮良＋图耶）；示例池不代表真实持有。 */
export function holdsDurinGroup(operators: { id: string; name?: string; own?: boolean }[] | undefined, source: "skland" | "maa" | "sample" | undefined): boolean {
  if (!operators || source === "sample") return false;
  const held = new Set(operators.filter((operator) => operator.own !== false).map((operator) => operator.id));
  const heldNames = new Set(operators.filter((operator) => operator.own !== false).map((operator) => operator.name ?? ""));
  return [...DURIN_GROUP].every((id) => held.has(id)) || [...DURIN_NAMES].every((name) => heldNames.has(name));
}

function gradeFor(value: number, bands: readonly [number, number, number]): "fail" | "pass" | "good" | "excellent" {
  if (value < bands[0]) return "fail";
  if (value < bands[1]) return "pass";
  if (value < bands[2]) return "good";
  return "excellent";
}


function wan(amount: number, locale: AdviceLocale): string {
  const scaled = formatScaledAmount(amount, locale);
  if (scaled) return scaled;
  return new Intl.NumberFormat(locale).format(Math.round(amount));
}

function stockSection(health: AccountHealthInput): AdviceStockSection | null {
  const stock = health.inventory;
  if (!stock) return null;
  const training = health.training;
  const demandRatio = training?.representativeLmdToExperience ?? training?.levelOnlyLmdToExperience ?? null;
  const ratioKind = training?.representativeLmdToExperience != null ? "modules"
    : training?.levelOnlyLmdToExperience != null ? "level" : null;
  let lmdShort: number | null = null;
  let expShort: number | null = null;
  if (demandRatio !== null) {
    const lmd = stock.experience * demandRatio - stock.lmd;
    const exp = stock.lmd / demandRatio - stock.experience;
    lmdShort = lmd > 0 ? lmd : null;
    expShort = exp > 0 ? exp : null;
  }
  const goldSurplus = stock.goldUnits >= GOLD_LARGE_SURPLUS_UNITS ? "large" as const
    : stock.goldUnits >= GOLD_SURPLUS_UNITS ? "clear" as const : null;
  const sixStar = training?.byRarity.find((row) => row.rarity === 6);
  const capacityFor = (perLmd: number, perExp: number) => Math.min(stock.lmd / perLmd, stock.experience / perExp);
  let byAverage: number | null = null;
  if (demandRatio !== null && sixStar && sixStar.promotedE2 > 0) {
    byAverage = capacityFor(
      (sixStar.levelCost.lmd + (sixStar.moduleLmd ?? 0)) / sixStar.promotedE2,
      sixStar.levelCost.experience / sixStar.promotedE2,
    );
  }
  const maxed = trainingCost(6, 2, 90);
  const sixStarCapacity = {
    byAverage,
    byMaxed: capacityFor(maxed.lmd + (MODULE_LMD[6] ?? []).reduce((sum, value) => sum + value, 0), maxed.exp),
  };
  return { lmd: stock.lmd, experience: stock.experience, goldUnits: stock.goldUnits, demandRatio, ratioKind, lmdShort, expShort, goldSurplus, sixStarCapacity };
}

function productionSection(health: AccountHealthInput, demandRatio: number | null): AdviceProductionSection | null {
  const production = health.production;
  if (!production) return null;
  const degraded = production.capacityIndex === null && production.lmdExperienceSum !== null;
  const score = production.capacityIndex ?? production.lmdExperienceSum;
  const grade = score === null ? null : gradeFor(score, degraded ? [70_000, 80_000, 95_000] : [90_000, 100_000, 110_000]);
  const daily = production.daily;
  const dailyLmdIn = daily.lmd === null ? null : daily.lmd + OFFLINE_DAILY_LMD;
  const dailyExpIn = daily.experience === null ? null : daily.experience + OFFLINE_DAILY_EXP;
  const lmdShort = stockShortLmd(health);
  const expShort = stockShortExp(health);
  // 净流与库存缺口同侧展示：缺钱看钱侧日净（入账 − 书入×需求比），缺书看书侧，两侧互为镜像。
  let netGain: AdviceProductionSection["netGain"] = null;
  if (demandRatio !== null && dailyLmdIn !== null && dailyExpIn !== null) {
    const lmdFlow = dailyLmdIn - dailyExpIn * demandRatio;
    const resource = lmdShort !== null ? "lmd" : expShort !== null ? "experience" : lmdFlow < 0 ? "lmd" : "experience";
    netGain = { resource, amount: resource === "lmd" ? lmdFlow : -lmdFlow / demandRatio };
  }
  const shortAmount = netGain === null ? null
    : netGain.resource === "lmd" ? lmdShort : expShort;
  const coverDays = netGain !== null && netGain.amount > 0 && shortAmount !== null && shortAmount > 0
    ? shortAmount / netGain.amount : null;
  const goldNetUnits = production.goldBalance?.estimatedNetUnits ?? production.goldBalance?.minimumNetUnits ?? null;
  const goldStock = health.inventory?.goldUnits ?? null;
  const goldRunwayDays = goldNetUnits !== null && goldNetUnits < 0 && goldStock !== null && goldStock > 0
    ? goldStock / -goldNetUnits : null;
  return {
    capacityIndex: production.capacityIndex, grade, degraded, lmdExpSum: production.lmdExperienceSum,
    dailyLmdIn, dailyExpIn, netGain, coverDays,
    baseRatio: production.baseLmdToExperience, combinedRatio: production.combinedLmdToExperience,
    goldNetUnits, goldEstimated: production.goldBalance?.estimatedNetUnits != null,
    goldTone: goldNetUnits === null ? null : goldNetUnits >= 0 ? "surplus" : "deficit",
    goldRunwayDays,
  };
}

function stockShortLmd(health: AccountHealthInput): number | null {
  const stock = health.inventory;
  const ratio = health.training?.representativeLmdToExperience ?? health.training?.levelOnlyLmdToExperience ?? null;
  if (!stock || ratio === null) return null;
  const short = stock.experience * ratio - stock.lmd;
  return short > 0 ? short : null;
}

function stockShortExp(health: AccountHealthInput): number | null {
  const stock = health.inventory;
  const ratio = health.training?.representativeLmdToExperience ?? health.training?.levelOnlyLmdToExperience ?? null;
  if (!stock || ratio === null) return null;
  const short = stock.lmd / ratio - stock.experience;
  return short > 0 ? short : null;
}

function shiftAdvice(demand: HealthDemand | null, orundum: boolean, locale: AdviceLocale): string[] {
  if (orundum) {
    return [uiText.text(locale, "12hShiftsOr1266HarvestBefore")];
  }
  const cadence = demand?.loginCadence;
  if (cadence === "twice-daily") {
    return [uiText.text(locale, "121212ThreeShifts36hCycleTwo")];
  }
  if (cadence === "daily") {
    return [uiText.text(locale, "inGameAutoRotationRedMoodTriggerFits")];
  }
  if (cadence === "irregular") {
    return [uiText.text(locale, "inGameAutoRotationRedMoodTriggerFits2")];
  }
  return [uiText.text(locale, "121212ThreeShiftsWorksForEvery")];
}

function recommend(health: AccountHealthInput, holdsGroup: boolean, locale: AdviceLocale): AdviceRecommendation | null {
  const demand = health.demand;
  const severeLmd = (stockShortLmd(health) ?? 0) >= SEVERE_SHORT;
  const severeExp = (stockShortExp(health) ?? 0) >= SEVERE_SHORT;
  const zh = locale;
  const shiftsBase = shiftAdvice(demand, demand?.orundumPlan === "planned", locale);

  if (demand?.orundumPlan === "planned") {
    if (demand.layoutChange === "keep") {
      return {
        layout: uiText.text(zh, "currentLayout"),
        headline: uiText.text(zh, "switchRecipesToGrindOrundumInTheCurrent"),
        lines: [uiText.text(zh, "oneTradePostSwitchesToMiningSupportOrders"), uiText.text(zh, "balancedLayoutsLike243StallLmdAndOverflow")],
        shifts: shiftsBase,
      };
    }
    if (demand.outputPriority === "low-maintenance") {
      return {
        layout: "333",
        headline: uiText.text(zh, "333OrundumLayoutLowMaintenance"),
        lines: [uiText.text(zh, "3Trade2Lmd1Orundum3Factories"), uiText.text(zh, "whenRockStockRunsDryFlipShardFactories")],
        shifts: shiftsBase,
      };
    }
    return {
      layout: "342",
      headline: uiText.text(zh, "342OrundumLayoutOutputOriented"),
      lines: [uiText.text(zh, "3Trade2Lmd1Orundum4Factories"), uiText.text(zh, "oneMoreFactoryThan333ExtraGoldOr")],
      shifts: shiftsBase,
    };
  }

  if (severeLmd) {
    if (holdsGroup) {
      return {
        layout: "342",
        headline: uiText.text(zh, "342PureLmdToRefillTheShortfallFirst"),
        lines: [uiText.text(zh, "3TradePostsForLmd4GoldFactories"), uiText.text(zh, "runTheHoOlheyakDurinGroupHoOlheyak")],
        shifts: shiftsBase,
      };
    }
    return {
      layout: "333",
      headline: uiText.text(zh, "333AllLmdToRefillTheShortfallFirst"),
      lines: [uiText.text(zh, "3TradePostsForLmd3GoldFactories"), uiText.text(zh, "withHoOlheyakKjeraAndTuya342Pure")],
      shifts: shiftsBase,
    };
  }
  if (severeExp) {
    return {
      layout: "153",
      headline: uiText.text(zh, "153ExpLayoutToRefillBattleRecordsFirst"),
      lines: [uiText.text(zh, "1TradeWithGold4ExpFactoriesDrones"), uiText.text(zh, "coverTheLmdSideWithCe6Runs")],
      shifts: shiftsBase,
    };
  }
  if (demand?.twoPowerPlants === "avoid") {
    return {
      layout: "243",
      headline: uiText.text(zh, "243SteadyStateThreePowerPlants"),
      lines: [uiText.text(zh, "4FactoriesAs2Gold2ExpFor")],
      shifts: shiftsBase,
    };
  }
  return {
    layout: uiText.text(zh, "252342Alternating"),
    headline: uiText.text(zh, "gapManageableAlternate252342OrStayOn"),
    lines: [uiText.text(zh, "25223GoldLeansExp3423"), uiText.text(zh, "stayingOn243FullTimeAlsoWorks")],
    shifts: shiftsBase,
  };
}

function buildSummary(health: AccountHealthInput, stock: AdviceStockSection | null, production: AdviceProductionSection | null, recommendation: AdviceRecommendation | null, locale: AdviceLocale): string {
  const zh = locale;
  const parts: string[] = [];
  if (stock) {
    parts.push(uiText.text(locale, "summaryStock", { lmd: wan(stock.lmd, locale), exp: wan(stock.experience, locale) }));
    if (stock.demandRatio !== null) {
      if (stock.lmdShort !== null) parts.push(uiText.text(zh, "inferredDemandRatioLmdShort", { value1: stock.demandRatio.toFixed(2), value2: wan(stock.lmdShort, locale) }));
      else if (stock.expShort !== null) parts.push(uiText.text(zh, "inferredDemandRatioExpShort", { value1: stock.demandRatio.toFixed(2), value2: wan(stock.expShort, locale) }));
      else parts.push(uiText.text(zh, "inferredDemandRatioBalanced", { value1: stock.demandRatio.toFixed(2) }));
    }
    if (stock.goldSurplus !== null) parts.push(uiText.text(locale, "summaryGold", { amount: stock.goldSurplus }));
  }
  if (production?.grade) {
    const score = production.capacityIndex ?? production.lmdExpSum;
    if (score !== null) parts.push(uiText.text(locale, "summaryProduction", { metric: production.degraded ? "sum" : "capacity", value: wan(score, locale), grade: production.grade }));
  }
  if (recommendation) parts.push(uiText.text(zh, "recommended", { value1: recommendation.layout }));
  return parts.join(zh !== "en" ? "；" : "; ") + (parts.length ? (zh !== "en" ? "。" : ".") : "");
}

export function buildHealthAdvice(health: AccountHealthInput, holdsGroup: boolean, locale: AdviceLocale): HealthAdviceReport {
  const stock = stockSection(health);
  const production = productionSection(health, stock?.demandRatio ?? null);
  const recommendation = recommend(health, holdsGroup, locale);
  const notes: string[] = [];
  const zh = locale;
  if (!health.inventory) notes.push(uiText.text(zh, "connectSklandOrFillInventoryManuallyToAssess"));
  if (!health.training?.usableForPersonalAssessment || stock?.demandRatio == null) {
    notes.push(uiText.text(zh, "importARealOperatorBox3E2To"));
  }
  if (!health.production) notes.push(uiText.text(zh, "saveAThreeDayReportToGradeCapacity"));
  return {
    summary: buildSummary(health, stock, production, recommendation, locale),
    stock, production, recommendation, notes,
  };
}
