import { MODULE_LMD, type AccountHealthInput } from "./account-health-input.ts";
import type { HealthDemand } from "./account-health-demand.ts";
import { formatScaledAmount } from "./resource-scale-display.ts";
import { trainingCost } from "./inventory-estimates.ts";

export type AdviceLocale = "zh" | "en";

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

const GRADE_TEXT: Record<"fail" | "pass" | "good" | "excellent", [string, string]> = {
  fail: ["不及格", "below par"],
  pass: ["合格", "adequate"],
  good: ["良好", "good"],
  excellent: ["优秀", "excellent"],
};

function wan(amount: number, locale: AdviceLocale): string {
  const scaled = formatScaledAmount(amount, locale);
  if (scaled) return scaled;
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "zh-CN").format(Math.round(amount));
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
    return locale === "en"
      ? ["12h shifts or 12/6/6; harvest before storage fills up."]
      : ["搓玉期 12 小时一换或 12/6/6 班制均可，以收菜不爆仓为准。"];
  }
  const cadence = demand?.loginCadence;
  if (cadence === "twice-daily") {
    return locale === "en"
      ? ["12/12/12 three shifts (36h cycle, two swaps a day) — the most recommended manual pattern."]
      : ["12/12/12 三班（36h 周期、一天两换），手动玩家最推荐的班制。"];
  }
  if (cadence === "daily") {
    return locale === "en"
      ? ["In-game auto rotation (red-mood trigger) fits a once-a-day rhythm; switch to 12/12/12 when chasing output."]
      : ["每天上线一次适合游戏内置自动轮换（红脸触发）；追求产出时改用 12/12/12。"];
  }
  if (cadence === "irregular") {
    return locale === "en"
      ? ["In-game auto rotation (red-mood trigger) fits an irregular rhythm, or pick a shift pattern that matches your own schedule."]
      : ["上线不规律适合游戏内置自动轮换（红脸触发），或按自己的实际作息自行选择换班模式。"];
  }
  return locale === "en"
    ? ["12/12/12 three shifts works for every layout by default."]
    : ["默认推荐 12/12/12 三班，各布局通用。"];
}

function recommend(health: AccountHealthInput, holdsGroup: boolean, locale: AdviceLocale): AdviceRecommendation | null {
  const demand = health.demand;
  const severeLmd = (stockShortLmd(health) ?? 0) >= SEVERE_SHORT;
  const severeExp = (stockShortExp(health) ?? 0) >= SEVERE_SHORT;
  const zh = locale === "zh";
  const shiftsBase = shiftAdvice(demand, demand?.orundumPlan === "planned", locale);

  if (demand?.orundumPlan === "planned") {
    if (demand.layoutChange === "keep") {
      return {
        layout: zh ? "当前布局" : "current layout",
        headline: zh ? "在现有布局内切产物搓玉" : "Switch recipes to grind orundum in the current layout",
        lines: zh ? [
          "一组贸易站切开采协力（合成玉订单），一组制造站切源石碎片。",
          "243 一类均衡布局搓玉期间龙门币不涨、经验溢出，长期搓玉建议换 333/342。",
        ] : [
          "One trade post switches to mining support orders (orundum), one factory to originium shards.",
          "Balanced layouts like 243 stall LMD and overflow EXP while grinding; switch to 333/342 for the long run.",
        ],
        shifts: shiftsBase,
      };
    }
    if (demand.outputPriority === "low-maintenance") {
      return {
        layout: "333",
        headline: zh ? "333 搓玉期布局（省心向）" : "333 orundum layout (low maintenance)",
        lines: zh ? [
          "3 贸易 = 2 龙门币 + 1 合成玉；3 制造 = 2 赤金 + 1 源石碎片。",
          "土库存耗尽后就地转纯产钱（碎片站改赤金、合成玉贸易改回龙门币），或切回 243。",
        ] : [
          "3 trade = 2 LMD + 1 orundum; 3 factories = 2 gold + 1 originium shard.",
          "When rock stock runs dry, flip shard factories to gold and orundum posts back to LMD, or return to 243.",
        ],
        shifts: shiftsBase,
      };
    }
    return {
      layout: "342",
      headline: zh ? "342 搓玉期布局（产出向）" : "342 orundum layout (output oriented)",
      lines: zh ? [
        "3 贸易 = 2 龙门币 + 1 合成玉；4 制造 = 1 源石碎片 + 2 赤金 + 1 经验（或 1 碎片 + 3 赤金）。",
        "比 333 多一间制造站，搓玉同时多产赤金或经验，可在搓玉、补经验、纯产钱之间切换。",
      ] : [
        "3 trade = 2 LMD + 1 orundum; 4 factories = 1 shard + 2 gold + 1 EXP (or 1 shard + 3 gold).",
        "One more factory than 333 — extra gold or EXP while grinding, flexible to switch lines.",
      ],
      shifts: shiftsBase,
    };
  }

  if (severeLmd) {
    if (holdsGroup) {
      return {
        layout: "342",
        headline: zh ? "342 纯钱表，优先补龙门币" : "342 pure LMD to refill the shortfall first",
        lines: zh ? [
          "3 贸易产龙门币 + 4 制造产赤金。",
          "启用鸿雪杜林组（鸿雪＋绮良＋图耶）快速补龙门币。",
        ] : [
          "3 trade posts for LMD + 4 gold factories.",
          "Run the Ho'olheyak-Durin group (Ho'olheyak + Kjera + Tuya) to refill LMD fast.",
        ],
        shifts: shiftsBase,
      };
    }
    return {
      layout: "333",
      headline: zh ? "333 全产钱，优先补龙门币" : "333 all-LMD to refill the shortfall first",
      lines: zh ? [
        "3 贸易产龙门币 + 3 制造产赤金。",
        "持有鸿雪、绮良、图耶时可改用 342 纯钱表，回钱更快。",
      ] : [
        "3 trade posts for LMD + 3 gold factories.",
        "With Ho'olheyak, Kjera and Tuya, 342 pure LMD recovers faster.",
      ],
      shifts: shiftsBase,
    };
  }
  if (severeExp) {
    return {
      layout: "153",
      headline: zh ? "153 经验布局，优先补作战记录" : "153 EXP layout to refill battle records first",
      lines: zh ? [
        "1 贸易配赤金 + 4 制造产经验，无人机加速经验线。",
        "龙门币缺口靠刷 CE-6 或与 243 切换补回。",
      ] : [
        "1 trade with gold + 4 EXP factories; drones assist the EXP line.",
        "Cover the LMD side with CE-6 runs or alternating with 243.",
      ],
      shifts: shiftsBase,
    };
  }
  if (demand?.twoPowerPlants === "avoid") {
    return {
      layout: "243",
      headline: zh ? "243 常驻自足（三发电）" : "243 steady-state (three power plants)",
      lines: zh ? ["4 制造配 2 赤金 2 经验，钱书产出均衡。"] : ["4 factories as 2 gold + 2 EXP for balanced output."],
      shifts: shiftsBase,
    };
  }
  return {
    layout: zh ? "252＋342 切换" : "252 + 342 alternating",
    headline: zh ? "钱书缺口可控：252＋342 切换或 243 常驻" : "Gap manageable: alternate 252 + 342, or stay on 243",
    lines: zh ? [
      "252（2~3 赤金）偏经验，342（3~4 赤金）偏龙门币，互切配平钱书。",
      "不想切换时 243 常驻自足即可。",
    ] : [
      "252 (2–3 gold) leans EXP, 342 (3–4 gold) leans LMD; alternate to balance.",
      "Staying on 243 full-time also works.",
    ],
    shifts: shiftsBase,
  };
}

function buildSummary(health: AccountHealthInput, stock: AdviceStockSection | null, production: AdviceProductionSection | null, recommendation: AdviceRecommendation | null, locale: AdviceLocale): string {
  const zh = locale === "zh";
  const parts: string[] = [];
  if (stock) {
    parts.push(zh
      ? `库存龙门币 ${wan(stock.lmd, locale)}、作战记录 ${wan(stock.experience, locale)}`
      : `Stock: LMD ${wan(stock.lmd, locale)}, EXP ${wan(stock.experience, locale)}`);
    if (stock.demandRatio !== null) {
      if (stock.lmdShort !== null) parts.push(zh ? `推测钱书需求比为 ${stock.demandRatio.toFixed(2)}，缺龙门币 ${wan(stock.lmdShort, locale)}` : `inferred demand ratio ${stock.demandRatio.toFixed(2)}, LMD short ${wan(stock.lmdShort, locale)}`);
      else if (stock.expShort !== null) parts.push(zh ? `推测钱书需求比为 ${stock.demandRatio.toFixed(2)}，缺经验 ${wan(stock.expShort, locale)}` : `inferred demand ratio ${stock.demandRatio.toFixed(2)}, EXP short ${wan(stock.expShort, locale)}`);
      else parts.push(zh ? `推测钱书需求比为 ${stock.demandRatio.toFixed(2)}，钱书匹配` : `inferred demand ratio ${stock.demandRatio.toFixed(2)}, balanced`);
    }
    if (stock.goldSurplus !== null) parts.push(zh
      ? (stock.goldSurplus === "large" ? "存在大量赤金盈余" : "存在赤金盈余")
      : (stock.goldSurplus === "large" ? "large gold surplus" : "gold surplus"));
  }
  if (production?.grade) {
    const score = production.capacityIndex ?? production.lmdExpSum;
    if (score !== null) parts.push(zh
      ? `${production.degraded ? "钱书和" : "产能指数"} ${wan(score, locale)}（${GRADE_TEXT[production.grade][0]}）`
      : `${production.degraded ? "LMD+EXP sum" : "capacity index"} ${wan(score, locale)} (${GRADE_TEXT[production.grade][1]})`);
  }
  if (recommendation) parts.push(zh ? `推荐 ${recommendation.layout}` : `recommended: ${recommendation.layout}`);
  return parts.join(zh ? "；" : "; ") + (parts.length ? (zh ? "。" : ".") : "");
}

export function buildHealthAdvice(health: AccountHealthInput, holdsGroup: boolean, locale: AdviceLocale): HealthAdviceReport {
  const stock = stockSection(health);
  const production = productionSection(health, stock?.demandRatio ?? null);
  const recommendation = recommend(health, holdsGroup, locale);
  const notes: string[] = [];
  const zh = locale === "zh";
  if (!health.inventory) notes.push(zh ? "绑定森空岛或手填库存后可评估库存缺口。" : "Connect Skland or fill inventory manually to assess the stock gap.");
  if (!health.training?.usableForPersonalAssessment || stock?.demandRatio == null) {
    notes.push(zh ? "导入真实干员池（至少 3 名精二）后可按培养习惯估算需求比。" : "Import a real operator box (3+ E2) to estimate your demand ratio.");
  }
  if (!health.production) notes.push(zh ? "保存三日报表后可评估产能档位与赤金盈亏。" : "Save a three-day report to grade capacity and gold balance.");
  return {
    summary: buildSummary(health, stock, production, recommendation, locale),
    stock, production, recommendation, notes,
  };
}
