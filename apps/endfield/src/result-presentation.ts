import type { AppLocale } from "@riic/contracts/locale";
import type { MessageTranslator } from "./i18n/types";
import { gameLabel } from "./i18n/game-labels";
import { operatorName } from "./i18n/game-data";

type Values = Record<string, string>;
type Rule = { pattern: RegExp; translate: (t: MessageTranslator, values: Values) => string };

// The pinned solver exports Chinese diagnostics. Translate at the display boundary
// so cached results and exported diagnostic data retain their original contract.
const fixed: Readonly<Record<string, (t: MessageTranslator) => string>> = {
  "同类双设施缺少稳定实例，按上界估计": t => t("ReportMessages.pairedUpperBound"),
  "同类双设施存在无法确证的衰减候选": t => t("ReportMessages.pairedDecayUncertain"),
  "同类双设施的衰减修正未收敛": t => t("ReportMessages.pairedDecayNotConverged"),
  "同类双设施的相关干员过多，联合搜索退化为成对扫描": t => t("ReportMessages.pairedScan"),
  "同类双舱类别在仍有剩余助力时按无助力估值": t => t("ReportMessages.pairedWithoutAssistance"),
  "单类别人选实现过多，已截断": t => t("ReportMessages.truncatedCandidates"),
  "按上游 8,800,000 点进度和 100 点/秒基础速率换算；具体线索类型仍由概率技能决定。": t => t("ReportMessages.clueNote"),
  "干员经验按作战记录等效口径；认知载体按 2.5 倍折算。经验副本 A/B 任一奖励包均折合 17 万等效经验 / 80 理智，未假定两包叠加。": t => t("ReportMessages.operatorNote"),
  "武器经验按解包 WeaponExpItemTable 的 itemExp 统一口径；最高级武器经验副本折合 17 万等效经验 / 80 理智。": t => t("ReportMessages.weaponNote"),
  "按当前培养位类别和培养舱等级对应的最高级素材换算。": t => t("ReportMessages.growthNote"),
  "人手不足": t => t("ReportMessages.notEnoughCrew"),
  "该组排不出稳定/可行方案": t => t("ReportMessages.noFeasibleCrew"),
  "可用 0 人，每舱至少需要 1 人": t => t("ReportMessages.noCrew"),
  "无方案": t => t("ReportMessages.noPlan"),
  "中枢换班时刻必须是 1–23 的整点": t => t("ReportMessages.centerHour"),
  "中枢要么两班都有人，要么两班都空（一队空、一队有人不是合法排班）": t => t("ReportMessages.centerEmpty"),
  "中枢恢复强度与名单不一致": t => t("ReportMessages.centerRecovery"),
  "中枢时间轴与名单/换班时刻不一致": t => t("ReportMessages.centerTimeline"),
  "中枢 C/R 与独立重算不一致": t => t("ReportMessages.centerRecalculation"),
  "usedMask 与中枢/设施实际人员并集不一致": t => t("ReportMessages.usedMask"),
  "占用人数超过名单人数": t => t("ReportMessages.tooManyCrew"),
};
const rules: Rule[] = [
  { pattern: new RegExp("^可用 (?<available>\\d+) 人，满工位最少需要 (?<required>\\d+) 人$"), translate: (t, values) => t("ReportMessages.availableCrew", values) },
  { pattern: new RegExp("^金色(?<kind>晶植|菌类|矿物)$"), translate: (t, values) => t("ReportMessages.goldGrowth", values) },
  { pattern: new RegExp("^(?<grade>\\d+)级(?<kind>晶植|菌类|矿物)$"), translate: (t, values) => t("ReportMessages.gradeGrowth", values) },
  { pattern: new RegExp("^(?<room>[^ /]+)/(?<shift>[AB]) 技能人员$"), translate: (t, values) => t("ReportMessages.skillAssignment", values) },
  { pattern: new RegExp("^(?<room>[^ /]+)/(?<shift>[AB]) 补位人员$"), translate: (t, values) => t("ReportMessages.fillAssignment", values) },
  { pattern: new RegExp("^(?<room>[^ /]+)/(?<shift>[AB])$"), translate: (t, values) => t("ReportMessages.assignment", values) },
  { pattern: new RegExp("^(?<where>.+) 含名单范围外的索引 (?<index>\\d+)$"), translate: (t, values) => t("ReportMessages.outOfRoster", values) },
  { pattern: new RegExp("^干员「(?<name>.+)」同时在 (?<previous>.+) 与 (?<where>.+)$"), translate: (t, values) => t("ReportMessages.duplicateAssignment", values) },
  { pattern: new RegExp("^中枢每班最多 (?<slots>\\d+) 个工位$"), translate: (t, values) => t("ReportMessages.centerCapacity", values) },
  { pattern: new RegExp("^中枢 (?<shift>[AB]) 段不满足 R ≥ C（R=(?<recovery>[\\d.]+) C=(?<consumption>[\\d.]+)）$"), translate: (t, values) => t("ReportMessages.centerBalance", values) },
  { pattern: new RegExp("^(?<room>.+) 补位人数与补位名单不一致$"), translate: (t, values) => t("ReportMessages.fillCount", values) },
  { pattern: new RegExp("^(?<room>.+) (?<shift>[AB]) 班人数不合法（技能 (?<skilled>\\d+) \\+ 补位 (?<fill>\\d+)，记录 (?<recorded>\\d+)，工位 (?<slots>\\d+)）$"), translate: (t, values) => t("ReportMessages.crewCount", values) },
  { pattern: new RegExp("^(?<room>.+) 单班方案包含 B 班人员$"), translate: (t, values) => t("ReportMessages.singleHasB", values) },
  { pattern: new RegExp("^(?<room>.+) 将该设施的技能人员当作白板补位$"), translate: (t, values) => t("ReportMessages.skilledFiller", values) },
  { pattern: new RegExp("^(?<room>.+) 同一人在 A/B 两班$"), translate: (t, values) => t("ReportMessages.bothShifts", values) },
  { pattern: new RegExp("^(?<room>.+) 出现助力方案，但本次运行没有开启助力$"), translate: (t, values) => t("ReportMessages.assistDisabled", values) },
  { pattern: new RegExp("^(?<room>.+) 助力周期为空$"), translate: (t, values) => t("ReportMessages.emptyCycle", values) },
  { pattern: new RegExp("^(?<room>.+) 助力周期里有空日$"), translate: (t, values) => t("ReportMessages.emptyDay", values) },
  { pattern: new RegExp("^(?<room>.+) 同一天的助力目标有重复$"), translate: (t, values) => t("ReportMessages.duplicateAssist", values) },
  { pattern: new RegExp("^(?<room>.+) 助力目标「(?<name>.+)」不属于受助班次$"), translate: (t, values) => t("ReportMessages.assistOutsideShift", values) },
  { pattern: new RegExp("^(?<room>.+) 模拟未收敛，不能作为精确产出$"), translate: (t, values) => t("ReportMessages.notConverged", values) },
  { pattern: new RegExp("^(?<room>.+) 助力注入对象不在当天轮转名单里$"), translate: (t, values) => t("ReportMessages.assistOutsideCycle", values) },
  { pattern: new RegExp("^(?<room>.+) 助力注入时目标心情 (?<mood>[\\d.]+)% > 70%，属溢出作废$"), translate: (t, values) => t("ReportMessages.assistOverflow", values) },
  { pattern: new RegExp("^(?<room>.+) 当天应受助的「(?<name>.+)」没有记录到注入$"), translate: (t, values) => t("ReportMessages.assistMissing", values) },
  { pattern: new RegExp("^(?<room>.+) 助力注入时刻不在受助班次内$"), translate: (t, values) => t("ReportMessages.assistTime", values) },
  { pattern: new RegExp("^(?<room>.+) 独立重算 (?<actual>[\\d.-]+) 与记录 (?<recorded>[\\d.-]+) 不一致$"), translate: (t, values) => t("ReportMessages.roomRecalculation", values) },
  { pattern: new RegExp("^类别「(?<category>.+)」独立重算 (?<actual>[\\d.-]+) 与记录 (?<recorded>[\\d.-]+) 不一致$"), translate: (t, values) => t("ReportMessages.categoryRecalculation", values) },
  { pattern: new RegExp("^缺少必需设施方案「(?<room>.+)」$"), translate: (t, values) => t("ReportMessages.missingFacility", values) },
  { pattern: new RegExp("^助力周期第 (?<day>\\d+) 天重复目标「(?<name>.+)」$"), translate: (t, values) => t("ReportMessages.cycleDuplicate", values) },
  { pattern: new RegExp("^助力周期第 (?<day>\\d+) 天使用 (?<points>\\d+) 点，超过每日 (?<limit>\\d+) 点$"), translate: (t, values) => t("ReportMessages.cycleBudget", values) },
  { pattern: new RegExp("^目标向量「(?<category>.+)」与类别产出不一致$"), translate: (t, values) => t("ReportMessages.categoryVector", values) },
];

export function solverMessage(text: string, locale: AppLocale, t: MessageTranslator): string {
  if (Object.hasOwn(fixed, text)) return fixed[text](t);
  for (const rule of rules) {
    const match = rule.pattern.exec(text);
    if (!match) continue;
    const values = { ...match.groups };
    for (const key of Object.keys(values)) {
      if (["room", "category", "kind"].includes(key)) values[key] = gameLabel(t, values[key]);
      else if (key === "name") values[key] = operatorName(values[key], locale);
      else if (key === "where" || key === "previous") values[key] = solverMessage(values[key], locale, t);
    }
    return rule.translate(t, values);
  }
  return gameLabel(t, text);
}
