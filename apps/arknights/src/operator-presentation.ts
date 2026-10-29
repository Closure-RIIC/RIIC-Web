import type { AppLocale } from "@riic/contracts/locale";
import { messageRecord } from "./i18n/translate.ts";
import { localize } from "./i18n/helpers/OperatorPresentation.ts";
export const BUILDING_SKILL_ENHANCED_WORD = "提升";

export function buildingSkillUnlockPrefix(elite: number, level: number, locale: AppLocale = "zh-CN"): string {
  return unlockPrefix(elite, level, locale);
}

function unlockPrefix(elite: number, level: number, en: AppLocale): string {
  const key = elite === 0 && level === 1 ? "initialPrefix"
    : elite === 0 ? "levelPrefix" : level === 1 ? "elitePrefix" : "eliteLevelPrefix";
  return localize.text(en, key, { elite, level });
}

export function buildingSkillUnlockSuffix(enhanced: boolean, locale: AppLocale): string {
  return localize.text(locale, enhanced ? "enhanced" : "unlock");
}

export function buildingSkillUnlockLabel(elite: number, level: number, enhanced = false, locale: AppLocale = "zh-CN"): string {
  return `${buildingSkillUnlockPrefix(elite, level, locale)}${buildingSkillUnlockSuffix(enhanced, locale)}`;
}

export function buildingSkillUnlockLabelEnglish(elite: number, level: number, enhanced = false): string {
  return `${unlockPrefix(elite, level, "en")}${localize.text("en", enhanced ? "enhanced" : "unlock")}`;
}

// These identifiers also select existing image files; they are not localized paths.
export const PROFESSION_LABELS: Readonly<Record<number, string>> = { 1: "近卫", 2: "狙击", 3: "重装", 4: "医疗", 5: "辅助", 6: "术师", 7: "特种", 8: "先锋" };

export const PROFESSION_LABELS_ENGLISH: Readonly<Record<number, string>> = { 1: "Guard", 2: "Sniper", 3: "Defender", 4: "Medic", 5: "Supporter", 6: "Caster", 7: "Specialist", 8: "Vanguard" };

export function operatorProfessionLabel(profession: number | undefined, locale: AppLocale): string | undefined {
  return profession === undefined ? undefined : messageRecord(locale, "operator_presentation_professions")[profession];
}

export function operatorProfessionLabelEnglishForCode(profession: number | undefined): string | undefined {
  return profession === undefined ? undefined : PROFESSION_LABELS_ENGLISH[profession];
}

export function operatorProfessionPresentationForCode(
  profession: number | undefined,
): { label: string; icon: string } | undefined {
  const label = profession === undefined ? undefined : PROFESSION_LABELS[profession];
  return label ? { label, icon: `/images/profession/${label}.webp` } : undefined;
}
