import { messageRecord } from "./i18n/translate.ts";
import { localize } from "./i18n/helpers/OperatorPresentation.ts";
export const BUILDING_SKILL_ENHANCED_WORD = "提升";

export function buildingSkillUnlockPrefix(elite: number, level: number): string {
  return unlockPrefix(elite, level, false);
}

function unlockPrefix(elite: number, level: number, en: boolean): string {
  const key = elite === 0 && level === 1 ? "initialPrefix"
    : elite === 0 ? "levelPrefix" : level === 1 ? "elitePrefix" : "eliteLevelPrefix";
  return localize.text(en, key, { elite, level });
}

export function buildingSkillUnlockLabel(elite: number, level: number, enhanced = false): string {
  return `${buildingSkillUnlockPrefix(elite, level)}${localize.text(false, enhanced ? "enhanced" : "unlock")}`;
}

export function buildingSkillUnlockLabelEnglish(elite: number, level: number, enhanced = false): string {
  return `${unlockPrefix(elite, level, true)}${localize.text(true, enhanced ? "enhanced" : "unlock")}`;
}

export const PROFESSION_LABELS: Readonly<Record<number, string>> = messageRecord("zh", "operator_presentation_professions");

export const PROFESSION_LABELS_ENGLISH: Readonly<Record<number, string>> = messageRecord("en", "operator_presentation_professions");

export function operatorProfessionLabelEnglishForCode(profession: number | undefined): string | undefined {
  return profession === undefined ? undefined : PROFESSION_LABELS_ENGLISH[profession];
}

export function operatorProfessionPresentationForCode(
  profession: number | undefined,
): { label: string; icon: string } | undefined {
  const label = profession === undefined ? undefined : PROFESSION_LABELS[profession];
  return label ? { label, icon: `/images/profession/${label}.webp` } : undefined;
}
