import { localize as localizeEfficiency } from "./i18n/helpers/efficiency.ts";
import type { AppLocale } from "./i18n/config.ts";
import type { RoomEfficiency, RotationRoomLine, UserProfileComboSnapshot, UserProfileSummary } from "./types";

export interface EfficiencyDetail {
  label: string;
  value: string;
  kind?: "cross-station" | "default";
  operator?: "=" | "+" | "−" | "×";
}

export interface RoomEfficiencyPresentation {
  primaryLabel?: string;
  primaryValue: string;
  formula?: boolean;
  details: EfficiencyDetail[];
}

function formatNumber(value: number, digits = 1): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(digits).replace(/\.0$/, "");
}

function percent(value: number): string {
  return `${formatNumber(value)}%`;
}

function different(left: number | undefined, right: number | undefined): boolean {
  return left !== undefined && right !== undefined && Math.abs(left - right) >= 0.05;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function normalizeServeRoomEfficiency(line: Record<string, unknown>): RotationRoomLine {
  const explicitFinal = finiteNumber(line.final_efficiency);
  const trade = finiteNumber(line.trade_efficiency);
  const tradeSkill = finiteNumber(line.trade_skill_efficiency);
  const tradeDisplay = finiteNumber(line.trade_display_efficiency);
  const manufacture = finiteNumber(line.manufacture_efficiency);
  const manufactureSkill = finiteNumber(line.manufacture_skill_efficiency);
  const manufactureDisplay = finiteNumber(line.manufacture_display_efficiency);
  const power = finiteNumber(line.power_efficiency);
  const powerSkill = finiteNumber(line.power_skill_efficiency);
  const powerDisplay = finiteNumber(line.power_display_efficiency);
  const final = explicitFinal ?? trade ?? manufacture ?? power;
  const totalEfficiency = finiteNumber(line.total_efficiency);
  const orderMultiplier = finiteNumber(line.order_multiplier);
  const baseEfficiency = finiteNumber(line.base_efficiency);
  const equivalentEfficiency = finiteNumber(line.equivalent_efficiency);
  const globalEfficiency = finiteNumber(line.global_efficiency);
  const tradeEquivalent = finiteNumber(line.trade_equivalent_efficiency);

  return {
    room_id: typeof line.room_id === "string" ? line.room_id : "",
    ...(final !== undefined ? { final_efficiency: final } : {}),
    ...(totalEfficiency !== undefined ? { total_efficiency: totalEfficiency } : {}),
    ...(orderMultiplier !== undefined ? { order_multiplier: orderMultiplier } : {}),
    ...(baseEfficiency !== undefined ? { base_efficiency: baseEfficiency } : {}),
    ...(equivalentEfficiency !== undefined ? { equivalent_efficiency: equivalentEfficiency } : {}),
    ...(globalEfficiency !== undefined ? { global_efficiency: globalEfficiency } : {}),
    ...(tradeEquivalent !== undefined ? { trade_equivalent_efficiency: tradeEquivalent } : {}),
    ...(trade !== undefined ? { trade_score: trade } : {}),
    ...(tradeSkill !== undefined ? { trade_skill_pct: tradeSkill * 100 } : {}),
    ...(tradeDisplay !== undefined ? { trade_display_pct: tradeDisplay * 100 } : {}),
    ...(manufacture !== undefined ? { manu_score: manufacture * 100 } : {}),
    ...(manufactureSkill !== undefined ? { manu_prod_skill: manufactureSkill * 100 } : {}),
    ...(manufactureDisplay !== undefined ? { manu_display_pct: manufactureDisplay * 100 } : {}),
    ...(power !== undefined ? { power_score: power * 100 } : {}),
    ...(powerSkill !== undefined ? { power_skill_pct: powerSkill * 100 } : {}),
    ...(powerDisplay !== undefined ? { power_display_pct: powerDisplay * 100 } : {}),
  };
}

function formulaTerm(label: string, value: number, kind?: EfficiencyDetail["kind"]): EfficiencyDetail {
  return {
    label,
    value: percent(Math.abs(value)),
    operator: value < 0 ? "−" : "+",
    ...(kind ? { kind } : {}),
  };
}

function structuredEfficiency(
  efficiency: RoomEfficiency,
  includeTradeEquivalent: boolean,
  locale: AppLocale,
): RoomEfficiencyPresentation | null {
  const base = efficiency.base_efficiency;
  const equivalent = efficiency.equivalent_efficiency;
  if (base === undefined || equivalent === undefined) return null;
  const global = efficiency.global_efficiency;
  const includesCrossStation = Math.abs(global ?? 0) >= 0.000_5;
  const details: EfficiencyDetail[] = [
    { label: "", value: percent(base * 100), operator: "=" },
    formulaTerm(localizeEfficiency.text(locale, "skillEfficiency"), equivalent * 100),
    ...(includesCrossStation ? [formulaTerm(localizeEfficiency.text(locale, "crossFacility"), global! * 100, "cross-station")] : []),
  ];
  const tradeEquivalent = efficiency.trade_equivalent_efficiency;
  if (includeTradeEquivalent && Math.abs((tradeEquivalent ?? 1) - 1) >= 0.000_5) {
    details.push({ label: "", value: localizeEfficiency.text(locale, "equivalentSkillEfficiency", { value: formatNumber(tradeEquivalent! * 100, 0) }) });
  }
  return {
    primaryValue: percent((base + equivalent + (global ?? 0)) * 100),
    formula: true,
    details,
  };
}

export function presentRoomEfficiency(
  group: string,
  efficiency: RoomEfficiency | undefined,
  locale: AppLocale = "zh",
): RoomEfficiencyPresentation | null {
  if (!efficiency) return null;

  if (group === "trading") {
    // 新 serve 输出优先：总效率 = 基础 + 等效 + 全局；有等效倍率时标注"等效 × 倍率"。
    const structured = structuredEfficiency(efficiency, true, locale);
    if (structured) return structured;
    const skill = efficiency.trade_skill_pct;
    const display = efficiency.trade_display_pct;
    const additive = display ?? efficiency.trade_pct ?? skill;
    const final = efficiency.final_efficiency ?? efficiency.trade_score;
    if (additive === undefined) {
      return final === undefined
        ? null
        : {
            primaryValue: percent(final * 100),
            details: [],
          };
    }
    const ordinary = 100 + additive;
    const crossStation = display !== undefined && skill !== undefined && different(display, skill)
      ? display - skill
      : undefined;
    const residentAndGlobal = crossStation === undefined ? additive : (skill ?? additive);
    const details: EfficiencyDetail[] = [
      { label: "", value: "100%", operator: "=" },
      formulaTerm(localizeEfficiency.text(locale, "combinedBonus"), residentAndGlobal),
      ...(crossStation === undefined ? [] : [formulaTerm(localizeEfficiency.text(locale, "crossFacility"), crossStation, "cross-station")]),
    ];
    const mechanic = final !== undefined && ordinary > 0
      ? final / (ordinary / 100)
      : efficiency.trade_gold_pct !== undefined
        ? 1 + efficiency.trade_gold_pct / 100
        : undefined;
    if (mechanic !== undefined && Math.abs(mechanic - 1) >= 0.000_5) {
      details.push({ label: localizeEfficiency.text(locale, "orderMechanic"), value: formatNumber(mechanic, 2), operator: "×" });
    }
    return {
      primaryValue: percent((final ?? ordinary / 100) * 100),
      formula: true,
      details,
    };
  }

  if (group === "manufacture") {
    const structured = structuredEfficiency(efficiency, false, locale);
    if (structured) return structured;
    const skill = efficiency.manu_prod_skill;
    const display = efficiency.manu_display_pct;
    const final = efficiency.final_efficiency !== undefined
      ? efficiency.final_efficiency * 100
      : efficiency.total_efficiency !== undefined
        ? efficiency.total_efficiency * 100
        : efficiency.manu_score !== undefined
          ? efficiency.manu_score
          : efficiency.manu_prod_total !== undefined
            ? 100 + efficiency.manu_prod_total
            : display !== undefined
              ? 100 + display
              : skill !== undefined
                ? 100 + skill
                : undefined;
    if (final === undefined) return null;
    const base = efficiency.base_efficiency;
    const baseBonus = base === undefined ? undefined : (base - 1) * 100;
    const totalBonus = final - 100;
    const crossStation = display !== undefined && skill !== undefined && different(display, skill)
      ? display - skill
      : undefined;
    const provenSkill = skill ?? (crossStation === undefined || display === undefined ? undefined : display - crossStation);
    const knownBonus = (baseBonus ?? 0) + (provenSkill ?? 0) + (crossStation ?? 0);
    const remainder = totalBonus - knownBonus;
    const details: EfficiencyDetail[] = [
      { label: "", value: "100%", operator: "=" },
      ...(baseBonus === undefined || !different(baseBonus, 0) ? [] : [formulaTerm(localizeEfficiency.text(locale, "combinedBonus"), baseBonus)]),
      ...(provenSkill === undefined ? [] : [formulaTerm(localizeEfficiency.text(locale, "skill"), provenSkill)]),
      ...(crossStation === undefined ? [] : [formulaTerm(localizeEfficiency.text(locale, "crossFacility"), crossStation, "cross-station")]),
      ...(different(remainder, 0) ? [formulaTerm(localizeEfficiency.text(locale, "combinedBonus"), remainder)] : []),
    ];
    if (details.length === 1 && different(totalBonus, 0)) details.push(formulaTerm(localizeEfficiency.text(locale, "combinedBonus"), totalBonus));
    if (efficiency.manu_storage_limit !== undefined) {
      details.push({ label: localizeEfficiency.text(locale, "capacity"), value: formatNumber(efficiency.manu_storage_limit) });
    }
    return {
      primaryValue: percent(final),
      formula: true,
      details,
    };
  }

  if (group === "power") {
    const scoreFallback = efficiency.power_score !== undefined
      ? (efficiency.power_score > 1 ? efficiency.power_score - 1 : efficiency.power_score) * 100
      : undefined;
    const skill = efficiency.power_skill_pct
      ?? efficiency.power_charge_speed_pct
      ?? (efficiency.equivalent_efficiency === undefined ? undefined : efficiency.equivalent_efficiency * 100)
      ?? scoreFallback;
    if (skill === undefined) return null;
    return {
      primaryLabel: localizeEfficiency.text(locale, "skillEfficiency"),
      primaryValue: percent(skill),
      details: [],
    };
  }

  return null;
}

export function profileEfficiency(snapshot: UserProfileComboSnapshot): number | undefined {
  return snapshot.final_efficiency ?? snapshot.score ?? snapshot.trade_pct;
}

export function manufacturePoolReady(summary: UserProfileSummary): number | undefined {
  return summary.manufacture_pool_ready ?? summary.manu_pool_ready;
}
